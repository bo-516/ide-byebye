import { sessionLoadingView, type SessionCatalog, type SessionMenuView } from './dialog-session-model.js';

/**
 * How long a fetched catalog opens as is, with no loading state and no second request. ⟳ in the menu always refetches.
 *
 * Boundary: long enough to cover "open the dialog, then pick ›" with the prefetched answer; short enough that session
 * status (working / idle) and relative times are not shown stale.
 */
export const SESSION_CATALOG_FRESH_MS = 30000;

/**
 * With nothing cached, how long an opening menu waits for its catalog before it paints the loading note.
 *
 * Boundary: the local server usually answers well inside this, so the menu opens once, at its final size. A slower
 * answer still gets the note, and the menu grows when the list lands.
 */
export const SESSION_FIRST_PAINT_WAIT_MS = 250;

/** One catalog answer and when it arrived, in `now()` milliseconds. */
interface CachedCatalog {
    res: SessionCatalog;
    at: number;
}

/** Paint hooks for {@link loadSessionCatalog}. */
interface CatalogPaintHooks {
    /** ⟳: refetch even when the cached catalog is fresh. */
    refresh?: boolean;
    /** Render one view of the menu. */
    paint: (view: SessionMenuView) => void;
    /** Whether the menu is still open for this agent; checked after every wait. */
    isCurrent: () => boolean;
    /** Overrides {@link SESSION_FIRST_PAINT_WAIT_MS} (tests). */
    waitMs?: number;
}

/**
 * Per-agent session catalogs: the last answer for each agent plus the requests still in flight.
 *
 * Purpose: the dialog prefetches catalogs as soon as `GET /agents` says which agents list sessions, so the session menu
 * opens at full size instead of growing out of a one-line loading note (which also moved it on screen). A prefetch and
 * an opening menu share one request.
 * Boundary: no DOM. A failed fetch is not cached and keeps the previous answer.
 */
export class SessionCatalogCache {
    load: (agent: string) => Promise<SessionCatalog>;
    now: () => number;
    entries = new Map<string, CachedCatalog>();
    inflight = new Map<string, Promise<SessionCatalog>>();

    /**
     * @param {(agent: string) => Promise<SessionCatalog>} load Fetches one agent's catalog (`api.sessions`).
     * @param {() => number} [now=Date.now] Clock for freshness, injected in tests.
     */
    constructor(load: (agent: string) => Promise<SessionCatalog>, now: () => number = Date.now) {
        this.load = load;
        this.now = now;
    }

    /** @param {string} agent Agent name. @returns {SessionCatalog | undefined} Last successful catalog, if any. */
    latest(agent: string): SessionCatalog | undefined {
        return this.entries.get(agent)?.res;
    }

    /** @param {string} agent Agent name. @returns {boolean} Whether the last answer is within {@link SESSION_CATALOG_FRESH_MS}. */
    isFresh(agent: string): boolean {
        const entry = this.entries.get(agent);
        return entry !== undefined && this.now() - entry.at < SESSION_CATALOG_FRESH_MS;
    }

    /**
     * Fetch `agent`'s catalog, joining a request already in flight.
     *
     * @param {string} agent Agent name.
     * @returns {Promise<SessionCatalog>} The answer, also cached on success; rejects when the fetch fails.
     */
    fetch(agent: string): Promise<SessionCatalog> {
        const pending = this.inflight.get(agent);
        if (pending)
            return pending;
        const request = this.load(agent)
            .then((res) => {
                this.entries.set(agent, { res, at: this.now() });
                return res;
            })
            .finally(() => this.inflight.delete(agent));
        this.inflight.set(agent, request);
        return request;
    }

    /**
     * Start fetching every listed agent whose answer is missing or stale.
     *
     * Boundary: best effort — a failure is swallowed here, and the menu reports its own error if it is opened.
     *
     * @param {Iterable<string>} agents Agents that list sessions.
     * @returns {void}
     */
    prefetch(agents: Iterable<string>): void {
        for (const agent of agents) {
            if (!this.isFresh(agent) && !this.inflight.has(agent))
                this.fetch(agent).catch(() => {});
        }
    }
}

/**
 * Whether `promise` settles (either way) within `ms`.
 *
 * @param {Promise<unknown>} promise Request to watch; its outcome is not returned.
 * @param {number} ms Time limit.
 * @returns {Promise<boolean>} True when it settled in time.
 */
function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), ms);
        const settled = () => {
            clearTimeout(timer);
            resolve(true);
        };
        promise.then(settled, settled);
    });
}

/**
 * Paint one agent's session menu from the cache, fetching only a missing or stale catalog.
 *
 * Boundary: a fresh catalog paints once with no request. With nothing cached, the first paint waits up to
 * `waitMs` for the answer, so it usually is the final list rather than a loading note. A stale catalog stays on screen
 * under the loading cover while it refreshes. Nothing paints once `isCurrent()` turns false (menu closed or switched).
 *
 * @param {SessionCatalogCache} cache Catalog cache.
 * @param {string} agent Agent whose menu is open.
 * @param {CatalogPaintHooks} hooks Paint and staleness hooks.
 * @returns {Promise<void>} Resolves after the final paint (or after giving up on a closed menu).
 */
export async function loadSessionCatalog(cache: SessionCatalogCache, agent: string, hooks: CatalogPaintHooks): Promise<void> {
    const cached = cache.latest(agent);
    if (!hooks.refresh && cached && cache.isFresh(agent)) {
        hooks.paint({ res: cached });
        return;
    }
    const request = cache.fetch(agent);
    const landed = cached ? false : await settlesWithin(request, hooks.waitMs ?? SESSION_FIRST_PAINT_WAIT_MS);
    if (!landed) {
        if (!hooks.isCurrent())
            return;
        hooks.paint(sessionLoadingView(cached));
    }
    try {
        const res = await request;
        if (hooks.isCurrent())
            hooks.paint({ res });
    }
    catch (err) {
        if (!hooks.isCurrent())
            return;
        const error = err instanceof Error ? err.message : String(err);
        hooks.paint(cached ? { error, res: cached } : { error });
    }
}
