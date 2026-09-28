import { readJsonStore, writeJsonStore } from './dialog-utils.js';

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

const DELIVERY_KEYS = {
    prefill: 'session.delivery.prefill',
    'resume-submit': 'session.delivery.resumeSubmit',
    submit: 'session.delivery.submit',
};

/**
 * i18n key for a catalog `delivery` code.
 *
 * @param {string} delivery `prefill`, `resume-submit`, or `submit`.
 * @returns {string} Translation key. Unknown codes fall back to the prefill hint.
 */
export function deliveryCopyKey(delivery) {
    return DELIVERY_KEYS[delivery] ?? DELIVERY_KEYS.prefill;
}

/**
 * Whether `location` should be labeled as the repo root.
 *
 * Boundary: `'.'` and ordinary child paths are not the repo root. `'..'` and `'../…'` are.
 *
 * @param {string} location Catalog `location` (`'.'`, `'src'`, `'..'`, `'../..'`).
 * @returns {boolean} True when the menu should say "repo root" instead of the directory name.
 */
export function isRepoRootLocation(location) {
    return location === '..' || String(location ?? '').startsWith('../');
}

/**
 * Relative time for a session row.
 *
 * Boundary: `now` is injectable so tests do not depend on the clock. Under a minute is "just now"; under an hour is
 * minutes; under a day is hours; under 7 days is days; older dates are `MM-DD` in the local calendar. An unparseable
 * timestamp returns `''`.
 *
 * @param {string} updatedAt ISO timestamp from the catalog.
 * @param {number} [now=Date.now()] Epoch ms to measure from.
 * @param {string} [locale='zh'] `'en'` selects English units; anything else uses Chinese.
 * @returns {string} Short relative time.
 */
export function formatSessionAge(updatedAt, now = Date.now(), locale = 'zh') {
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
 * @param {Record<string, unknown>} session Public catalog row.
 * @param {number} [now=Date.now()] Clock for the relative time.
 * @param {string} [locale='zh'] Locale for the relative time.
 * @returns {Record<string, unknown>} Row the menu renders. `disabled` rows must not be selectable.
 */
export function sessionMenuRow(session, now = Date.now(), locale = 'zh') {
    const repoRoot = isRepoRootLocation(session?.location);
    let marker = '○';
    let statusKey = 'session.status.idle';
    let reasonKey = '';
    let disabled = false;
    if (session?.targetable === false) {
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
        locationText: repoRoot ? '' : (session?.projectName ?? ''),
        relativeTime: formatSessionAge(session?.updatedAt, now, locale),
    };
}

/**
 * Read the per-agent target map.
 *
 * Boundary: malformed storage, a non-object, and entries without a string id are dropped. The returned object is a
 * copy. `store` defaults to `localStorage` inside {@link readJsonStore}; tests pass an in-memory store.
 *
 * @param {Storage} [store] Storage area.
 * @returns {Record<string, { id: string, title: string }>} Targets keyed by agent name.
 */
export function readSessionTargets(store) {
    const value = readJsonStore(SESSION_TARGET_PREF_KEY, {}, store);
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    const targets = {};
    for (const [agent, entry] of Object.entries(value)) {
        if (entry && typeof entry.id === 'string' && entry.id)
            targets[agent] = { id: entry.id, title: typeof entry.title === 'string' ? entry.title : '' };
    }
    return targets;
}

/**
 * Persist the whole target map.
 *
 * @param {Storage} store Storage area.
 * @param {Record<string, { id: string, title: string }>} targets Next map.
 * @returns {void}
 */
export function writeSessionTargets(store, targets) {
    writeJsonStore(SESSION_TARGET_PREF_KEY, targets, store);
}

/**
 * Copy of `targets` with one agent's target set or removed.
 *
 * Boundary: `null` removes only that agent. Other agents are kept. The input map is not mutated.
 *
 * @param {Record<string, { id: string, title: string }>} targets Current map.
 * @param {string} agent Agent name.
 * @param {{ id: string, title?: string } | null} target Next target, or null to clear.
 * @returns {Record<string, { id: string, title: string }>} Next map.
 */
export function withSessionTarget(targets, agent, target) {
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
 * @param {Record<string, { id: string }>} targets Stored targets.
 * @param {string} agent Agent about to be sent.
 * @returns {string | undefined} Session id to attach, if any.
 */
export function payloadTargetId(targets, agent) {
    const id = targets?.[agent]?.id;
    return typeof id === 'string' && id ? id : undefined;
}

/**
 * Apply a send result to the stored targets.
 *
 * Boundary: `target-missing` clears only that agent (the dialog stays open and the menu returns to a new session).
 * `target-busy` keeps the target. Other codes leave the map unchanged.
 *
 * @param {Record<string, { id: string, title: string }>} targets Current map.
 * @param {string} agent Agent that was sent.
 * @param {{ code?: string }} result Send response.
 * @returns {Record<string, { id: string, title: string }>} Next map.
 */
export function applySessionSendResult(targets, agent, result) {
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
 * @param {Record<string, unknown> | null | undefined} previous Last successful catalog for this agent.
 * @returns {{ loading: true, res?: Record<string, unknown>, overlay?: boolean }} Paint input for the menu.
 */
export function sessionLoadingView(previous) {
    const sessions = previous?.sessions;
    if (Array.isArray(sessions) && sessions.length > 0)
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
 * @param {{ open: boolean, index: number, sessions: Array<{ id: string, disabled?: boolean }> }} state Menu state.
 * @param {string} key `KeyboardEvent.key`.
 * @returns {Record<string, unknown>} Next state plus `action` (`move`, `close-menu`, `select`, `select-new`, `blocked`, or null).
 */
export function applySessionMenuKey(state, key) {
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
        return { ...state, open: false, action: 'select', sessionId: session.id };
    }
    return { ...state, action: null };
}
