import { readJsonStore, writeJsonStore } from './dialog-utils.js';

/**
 * Storage surface the target map reads and writes.
 * A full `Storage` works. Tests pass an in-memory stand-in, and `undefined` keeps
 * {@link readJsonStore} / {@link writeJsonStore} on their default (`window.localStorage`).
 */
export interface SessionTargetStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

/** One persisted per-agent target. Entries without a string id are dropped on read. */
export interface SessionTarget {
    id: string;
    title: string;
}

/**
 * Catalog JSON the menu paints. Only the fields the menu reads are named; the server may send more,
 * and callers that still hold the raw object pass it through unchanged.
 */
export interface SessionCatalog {
    sessions?: unknown[];
    delivery?: string;
    notice?: string;
}

/** Fetch state for one paint. `overlay` keeps `res.sessions` on screen under a loading cover. */
export interface SessionMenuView {
    loading?: boolean;
    overlay?: boolean;
    error?: string;
    res?: SessionCatalog;
}

/**
 * Row the menu renders. `disabled` rows must not be selectable. `id` stays `unknown` because the catalog
 * is untrusted JSON; selection still compares it with `===`.
 */
export interface SessionMenuRow {
    id: unknown;
    title: string;
    untitled: boolean;
    marker: string;
    disabled: boolean;
    statusKey: string;
    reasonKey: string;
    locationKey: string;
    locationText: string;
    relativeTime: string;
}

/**
 * Keyboard state for the open menu. Index 0 is "new session"; session rows follow. `action` is set by
 * {@link applySessionMenuKey} and absent on the state the controller stores between keypresses.
 */
export interface SessionMenuState {
    open: boolean;
    index: number;
    sessions: Array<{ id?: unknown; disabled?: boolean; title?: unknown }>;
    action?: 'move' | 'close-menu' | 'select' | 'select-new' | 'blocked' | null;
    sessionId?: string;
}

/** localStorage key for per-agent session targets. One origin, one map. */
export const SESSION_TARGET_PREF_KEY = 'code-intent-inspector:session-targets';

/**
 * Copy keys the session menu, the Send button's session label, and send errors read.
 *
 * Boundary: every key must exist in both `zh` and `en`. The test walks this list. Adding a key here without a
 * translation makes that test fail.
 *
 * @type {string[]}
 */
export const SESSION_COPY_KEYS = [
    'session.menu.title',
    'session.delivery.prefill',
    'session.delivery.resumeSubmit',
    'session.delivery.submit',
    'session.menu.new',
    'session.menu.loading',
    'session.menu.empty',
    'session.menu.error',
    'session.menu.retry',
    'session.menu.refresh',
    'session.menu.back',
    'session.status.working',
    'session.status.waiting',
    'session.status.idle',
    'session.status.closed',
    'session.reason.openInTerminal',
    'session.reason.liveUnknown',
    'session.reason.cwdMissing',
    'session.location.repoRoot',
    'session.untitled',
    'session.target.label',
    'session.error.targetMissing',
    'session.error.targetBusy',
    'session.notice.ideNotRunning',
    'session.notice.unsupportedFormat',
];

/** Known catalog `delivery` codes. Any other string falls through to the prefill hint. */
const DELIVERY_KEYS: Record<string, string> = {
    prefill: 'session.delivery.prefill',
    'resume-submit': 'session.delivery.resumeSubmit',
    submit: 'session.delivery.submit',
};

/**
 * i18n key for a catalog `delivery` code.
 *
 * @param {string} delivery `prefill`, `resume-submit`, or `submit`. Any other string uses the prefill hint.
 * @returns {string} Translation key. Unknown codes fall back to the prefill hint.
 */
export function deliveryCopyKey(delivery: string): string {
    return DELIVERY_KEYS[delivery] ?? DELIVERY_KEYS.prefill;
}

/**
 * Whether `location` should be labeled as the repo root.
 *
 * Boundary: `'.'` and ordinary child paths are not the repo root. `'..'` and `'../…'` are.
 *
 * @param {unknown} location Catalog `location` (`'.'`, `'src'`, `'..'`, `'../..'`). Non-strings are stringified,
 * so a missing location is not the repo root.
 * @returns {boolean} True when the menu should say "repo root" instead of the directory name.
 */
export function isRepoRootLocation(location: unknown): boolean {
    return location === '..' || String(location ?? '').startsWith('../');
}

/**
 * Relative time for a session row.
 *
 * Boundary: `now` is injectable so tests do not depend on the clock. Under a minute is "just now"; under an hour is
 * minutes; under a day is hours; under 7 days is days; older dates are `MM-DD` in the local calendar. An unparseable
 * timestamp returns `''`.
 *
 * @param {string} updatedAt ISO timestamp from the catalog. Non-strings still reach `Date.parse` unchanged when the
 * caller passes them through; an unparseable value returns `''`.
 * @param {number} [now=Date.now()] Epoch ms to measure from.
 * @param {string} [locale='zh'] `'en'` selects English units; anything else uses Chinese.
 * @returns {string} Short relative time.
 */
export function formatSessionAge(updatedAt: string, now = Date.now(), locale = 'zh'): string {
    const then = Date.parse(updatedAt);
    if (!Number.isFinite(then))
        return '';
    const delta = Math.max(0, now - then);
    const en = locale === 'en';
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (delta < minute)
        return en ? 'just now' : '刚刚';
    if (delta < hour) {
        const n = Math.floor(delta / minute);
        return en ? `${n} min ago` : `${n} 分钟前`;
    }
    if (delta < day) {
        const n = Math.floor(delta / hour);
        return en ? `${n} hr ago` : `${n} 小时前`;
    }
    if (delta < 7 * day) {
        const n = Math.floor(delta / day);
        return en ? `${n} day ago` : `${n} 天前`;
    }
    const date = new Date(then);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const dayOfMonth = String(date.getDate()).padStart(2, '0');
    return `${month}-${dayOfMonth}`;
}

/**
 * View model for one menu row.
 *
 * Boundary: a non-targetable row is disabled and uses the `◌` marker plus its reason key. A targetable session that
 * is not live is "closed" (`○`), even when the server status is `idle`. `working` / `waiting` markers are `●` / `◐`.
 * Ancestor locations expose `locationKey` instead of the basename.
 *
 * @param {Record<string, unknown> | null | undefined} session Public catalog row. A missing row renders as a closed,
 * untitled session. Non-objects are read the same way (missing fields), so the menu does not throw on a bad element.
 * @param {number} [now=Date.now()] Clock for the relative time.
 * @param {string} [locale='zh'] Locale for the relative time.
 * @returns {SessionMenuRow} Row the menu renders. `disabled` rows must not be selectable.
 */
export function sessionMenuRow(session: Record<string, unknown> | null | undefined, now = Date.now(), locale = 'zh'): SessionMenuRow {
    const repoRoot = isRepoRootLocation(session?.location);
    let marker = '○';
    let statusKey = 'session.status.idle';
    let reasonKey = '';
    let disabled = false;
    // `targetable === false` already implies a row; the `&&` only lets strict null checks see `session.reason`.
    if (session && session.targetable === false) {
        marker = '◌';
        disabled = true;
        if (session.reason === 'open-in-terminal')
            reasonKey = 'session.reason.openInTerminal';
        else if (session.reason === 'live-unknown')
            reasonKey = 'session.reason.liveUnknown';
        else if (session.reason === 'cwd-missing')
            reasonKey = 'session.reason.cwdMissing';
        statusKey = reasonKey || 'session.status.closed';
    }
    else if (session?.live !== true) {
        marker = '○';
        statusKey = 'session.status.closed';
    }
    else if (session?.status === 'working') {
        marker = '●';
        statusKey = 'session.status.working';
    }
    else if (session?.status === 'waiting') {
        marker = '◐';
        statusKey = 'session.status.waiting';
    }
    return {
        id: session?.id,
        title: typeof session?.title === 'string' ? session.title : '',
        untitled: !session?.title,
        marker,
        disabled,
        statusKey,
        reasonKey,
        locationKey: repoRoot ? 'session.location.repoRoot' : '',
        locationText: repoRoot ? '' : (session?.projectName ?? '') as string,
        // The cast erases. A missing timestamp still reaches `Date.parse` as null or undefined, both of which return ''.
        relativeTime: formatSessionAge(session?.updatedAt as string, now, locale),
    };
}

/**
 * Read the per-agent target map.
 *
 * Boundary: malformed storage, a non-object, and entries without a string id are dropped. The returned object is a
 * copy. `store` defaults to `localStorage` inside {@link readJsonStore}; tests pass an in-memory store.
 *
 * @param {SessionTargetStore} [store] Storage area. Omitted uses `localStorage` inside {@link readJsonStore}.
 * @returns {Record<string, SessionTarget>} Targets keyed by agent name.
 */
export function readSessionTargets(store?: SessionTargetStore): Record<string, SessionTarget> {
    // `readJsonStore` types its third argument as `Storage` because that parameter defaults to `localStorage`.
    // Only `getItem` is called, so a partial store (tests) is still valid.
    const value: unknown = readJsonStore(SESSION_TARGET_PREF_KEY, {}, store as Storage | undefined);
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    const targets: Record<string, SessionTarget> = {};
    // The stored map is untrusted JSON; `id` / `title` are checked before an entry is kept.
    for (const [agent, raw] of Object.entries(value as Record<string, unknown>)) {
        const entry = raw as { id?: unknown; title?: unknown } | null;
        if (entry && typeof entry.id === 'string' && entry.id)
            targets[agent] = { id: entry.id, title: typeof entry.title === 'string' ? entry.title : '' };
    }
    return targets;
}

/**
 * Persist the whole target map.
 *
 * @param {SessionTargetStore | undefined} store Storage area. `undefined` uses the default inside {@link writeJsonStore}.
 * @param {Record<string, SessionTarget>} targets Next map.
 * @returns {void}
 */
export function writeSessionTargets(store: SessionTargetStore | undefined, targets: Record<string, SessionTarget>): void {
    // Same `Storage` default inference as {@link readSessionTargets}; only `setItem` runs.
    writeJsonStore(SESSION_TARGET_PREF_KEY, targets, store as Storage | undefined);
}

/**
 * Copy of `targets` with one agent's target set or removed.
 *
 * Boundary: `null` removes only that agent. Other agents are kept. The input map is not mutated.
 *
 * @param {Record<string, SessionTarget>} targets Current map.
 * @param {string} agent Agent name.
 * @param {{ id: string, title?: string } | null} target Next target, or null to clear.
 * @returns {Record<string, SessionTarget>} Next map.
 */
export function withSessionTarget(targets: Record<string, SessionTarget>, agent: string, target: { id: string; title?: string } | null): Record<string, SessionTarget> {
    const next = { ...targets };
    if (!target)
        delete next[agent];
    else
        next[agent] = { id: target.id, title: target.title ?? '' };
    return next;
}

/**
 * `targetSessionId` for a send, or `undefined` when that agent has no target.
 *
 * Boundary: another agent's target is not returned. An empty id is treated as no target so the payload omits the field.
 *
 * @param {Record<string, { id?: string } | null | undefined> | null | undefined} targets Stored targets.
 * @param {string} agent Agent about to be sent.
 * @returns {string | undefined} Session id to attach, if any.
 */
export function payloadTargetId(targets: Record<string, { id?: string } | null | undefined> | null | undefined, agent: string): string | undefined {
    const id = targets?.[agent]?.id;
    return typeof id === 'string' && id ? id : undefined;
}

/**
 * Apply a send result to the stored targets.
 *
 * Boundary: `target-missing` clears only that agent (the dialog stays open and the menu returns to a new session).
 * `target-busy` keeps the target. Other codes leave the map unchanged.
 *
 * @param {Record<string, SessionTarget>} targets Current map.
 * @param {string} agent Agent that was sent.
 * @param {{ code?: string } | null | undefined} result Send response. A missing result leaves the map unchanged.
 * @returns {Record<string, SessionTarget>} Next map.
 */
export function applySessionSendResult(targets: Record<string, SessionTarget>, agent: string, result: { code?: string } | null | undefined): Record<string, SessionTarget> {
    if (result?.code === 'target-missing' || result?.code === 'target-invalid')
        return withSessionTarget(targets, agent, null);
    return targets;
}

/**
 * Catalog view to paint while a fetch is in flight.
 *
 * Boundary: a previous list is kept so the menu does not collapse to a one-line loading note and jump. The first
 * fetch has nothing to keep, so the caller shows the loading note alone. A missing or empty `sessions` array is
 * treated as no list.
 *
 * @param {SessionCatalog | null | undefined} previous Last successful catalog for this agent.
 * @returns {SessionMenuView & { loading: true }} Paint input for the menu.
 */
export function sessionLoadingView(previous: SessionCatalog | null | undefined): SessionMenuView & { loading: true } {
    if (previous && Array.isArray(previous.sessions) && previous.sessions.length > 0)
        return { loading: true, res: previous, overlay: true };
    return { loading: true };
}

/**
 * Move or close the open session menu from a key.
 *
 * Boundary: index 0 is "new session". ArrowDown from 0 lands on the first session; a second ArrowDown lands on the
 * second session. Enter on a disabled row does not select. Escape closes the menu and does not select. The dialog
 * itself stays open — this function only describes the menu.
 *
 * @param {SessionMenuState} state Menu state. `sessions` is empty when the catalog has no rows.
 * @param {string} key `KeyboardEvent.key`.
 * @returns {SessionMenuState} Next state plus `action` (`move`, `close-menu`, `select`, `select-new`, `blocked`, or null).
 */
export function applySessionMenuKey(state: SessionMenuState, key: string): SessionMenuState {
    const sessions = state.sessions ?? [];
    const count = 1 + sessions.length;
    if (key === 'ArrowDown')
        return { ...state, index: Math.min(count - 1, state.index + 1), action: 'move' };
    if (key === 'ArrowUp')
        return { ...state, index: Math.max(0, state.index - 1), action: 'move' };
    if (key === 'Escape')
        return { ...state, open: false, action: 'close-menu' };
    if (key === 'Enter') {
        if (state.index <= 0)
            return { ...state, open: false, action: 'select-new' };
        const session = sessions[state.index - 1];
        if (!session || session.disabled)
            return { ...state, action: 'blocked' };
        // Catalog ids are strings; the cast keeps a non-string id on the same `===` path instead of dropping it.
        return { ...state, open: false, action: 'select', sessionId: session.id as string };
    }
    return { ...state, action: null };
}
