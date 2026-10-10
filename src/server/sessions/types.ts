import { SESSION_TITLE_MAX } from '../../shared/constants.js';

/**
 * Language-neutral id check shared by Codex, Grok, and Antigravity.
 *
 * Boundary: a value that fails this pattern is `target-invalid` and is never joined onto a filesystem path,
 * deeplink, or launcher argument. The pattern matches the UUID shape those apps already use.
 *
 * @type {RegExp}
 */
export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Devin CLI session id shape: the slug `devin list` returns (e.g. `alluring-calendula`).
 *
 * Boundary: only letters, digits, and hyphens are accepted — a page-supplied id cannot become a flag, a path, or a
 * shell token before it is embedded as a single-quoted `-r` argument.
 *
 * @type {RegExp}
 */
export const DEVIN_SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{1,79}$/;

/**
 * Per-agent id patterns. All three shipped session agents use {@link SESSION_ID_PATTERN}.
 *
 * Boundary: an agent missing from this map cannot accept `targetSessionId` (`target-invalid`).
 *
 * @type {Record<string, RegExp>}
 */
export const SESSION_ID_PATTERNS = {
    'codex-app': SESSION_ID_PATTERN,
    'grok-build': SESSION_ID_PATTERN,
    'antigravity-ide': SESSION_ID_PATTERN,
    'devin-cli': DEVIN_SESSION_ID_PATTERN,
};

/**
 * First line of a session title, capped at {@link SESSION_TITLE_MAX} characters.
 *
 * Boundary: newlines in the source title are dropped rather than shown as extra menu rows. Over-long lines keep
 * 119 characters plus an ellipsis so the stored value itself stays within the cap. A non-string becomes `''`
 * (the client shows "untitled").
 *
 * @param {unknown} value Raw title from an index, summary, or IDE trajectory. Objects are stringified.
 * @returns {string} Single-line title, possibly empty, never longer than 120 characters.
 */
export function sessionTitle(value: unknown) {
    const first = String(value ?? '').split(/\r?\n/, 1)[0] ?? '';
    if (first.length <= SESSION_TITLE_MAX)
        return first;
    return `${first.slice(0, SESSION_TITLE_MAX - 1)}…`;
}

/**
 * True when `value` is an absolute POSIX or Windows path.
 *
 * Boundary: used to keep catalog JSON free of filesystem paths. A title that is itself an absolute path is blanked;
 * a title that merely mentions a slash is kept.
 *
 * @param {unknown} value Candidate string. Non-strings are coerced before the prefix check.
 * @returns {boolean} True when the string starts with `/` or a drive prefix.
 */
export function isAbsolutePathText(value: unknown) {
    const text = String(value ?? '');
    return text.startsWith('/') || /^[A-Za-z]:[\\/]/.test(text);
}

/**
 * Fields of one session the page is allowed to see.
 *
 * Boundary: `cwd`, `route`, pids, and tokens stay on the server object and are omitted here. A missing `reason`
 * is omitted rather than sent as null. An absolute title is replaced with `''` so the JSON body cannot carry a path.
 *
 * @param {{ id?: unknown, title?: unknown, projectName?: unknown, location?: unknown, status?: unknown, live?: unknown, targetable?: unknown, updatedAt?: unknown, reason?: unknown } | null | undefined} session
 *        Server session, including private fields. A missing object becomes an empty public row. Only these fields are read.
 * @returns {Record<string, unknown>} Catalog row.
 */
export function toPublicSession(session: {
    id?: unknown;
    title?: unknown;
    projectName?: unknown;
    location?: unknown;
    status?: unknown;
    live?: unknown;
    targetable?: unknown;
    updatedAt?: unknown;
    reason?: unknown;
} | null | undefined) {
    const title = sessionTitle(session?.title);
    const row: Record<string, unknown> = {
        id: String(session?.id ?? ''),
        title: isAbsolutePathText(title) ? '' : title,
        projectName: String(session?.projectName ?? ''),
        location: String(session?.location ?? '.'),
        status: session?.status === 'working' || session?.status === 'waiting' ? session.status : 'idle',
        live: session?.live === true,
        targetable: session?.targetable === true,
        updatedAt: String(session?.updatedAt ?? ''),
    };
    if (typeof session?.reason === 'string' && session.reason)
        row.reason = session.reason;
    return row;
}

/**
 * Fixed, language-neutral error strings for session send/list failures.
 *
 * Boundary: these sentences are for logs and the `error` field. The dialog shows its own translated copy from `code`.
 * None of the strings include a path, id, or token.
 *
 * @param {string} code Session error code.
 * @returns {string} Stable English error.
 */
export function sessionErrorText(code: string) {
    switch (code) {
        case 'target-invalid':
            return 'Target session id is invalid';
        case 'target-missing':
            return 'Target session is no longer available';
        case 'target-busy':
            return 'Target session is open in a terminal';
        case 'sessions-unsupported':
            return 'This agent does not support sending to an existing session';
        case 'ls-tls':
            return 'Language server TLS verification failed';
        case 'ls-requires-credentials':
            return 'Language server refused the message without credential material';
        case 'ls-unreachable':
            return 'Language server did not respond';
        default:
            return 'Session request failed';
    }
}
