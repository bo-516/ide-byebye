import path from 'node:path';
import { TOKEN_HEADER } from '../shared/constants.js';
/**
 * Ensure `file` lives inside `root`. Throws otherwise. This is the core guard
 * that prevents a malicious page payload from pointing the server at arbitrary
 * files on disk.
 */
export function assertPathInsideRoot(file, root) {
    const resolvedRoot = path.resolve(root);
    const resolvedFile = path.resolve(root, file);
    const relative = path.relative(resolvedRoot, resolvedFile);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Selected file is outside the Vite project root');
    }
    return resolvedFile;
}
/** True when the file resolves inside root (non-throwing variant). */
export function isInsideRoot(file, root) {
    try {
        assertPathInsideRoot(file, root);
        return true;
    }
    catch {
        return false;
    }
}
/** Constant-time-ish token comparison. */
export function tokenMatches(expected, received) {
    if (!received || received.length !== expected.length)
        return false;
    let mismatch = 0;
    for (let i = 0; i < expected.length; i += 1) {
        mismatch |= expected.charCodeAt(i) ^ received.charCodeAt(i);
    }
    return mismatch === 0;
}
/** Read the dev token from header or query string. */
export function readToken(req) {
    const headerValue = req.headers[TOKEN_HEADER];
    if (typeof headerValue === 'string' && headerValue)
        return headerValue;
    if (Array.isArray(headerValue) && headerValue[0])
        return headerValue[0];
    try {
        const url = new URL(req.url ?? '', 'http://localhost');
        const fromQuery = url.searchParams.get('token');
        if (fromQuery)
            return fromQuery;
    }
    catch {
        // ignore malformed URL
    }
    return undefined;
}
const LOCAL_HOSTNAMES = new Set([
    'localhost',
    '127.0.0.1',
    '::1',
    '0.0.0.0',
    '[::1]',
]);
/**
 * Only accept requests that originate from a localhost page. We check Origin /
 * Referer when present; absence (e.g. same-origin fetch without Origin) is
 * allowed because the token already gates access.
 */
export function isLocalRequest(req) {
    const candidates = [req.headers.origin, req.headers.referer].filter((v) => typeof v === 'string' && v.length > 0);
    if (candidates.length === 0)
        return true;
    return candidates.every((value) => {
        try {
            const url = new URL(value);
            const host = url.hostname;
            return LOCAL_HOSTNAMES.has(host) || host.endsWith('.localhost');
        }
        catch {
            return false;
        }
    });
}

/**
 * Whether a request's `Host` names a local interface.
 *
 * Purpose: DNS-rebinding defense for routes that hand out the token (`/session`): a rebound attacker page is
 * same-origin with *its own* host name, so the `Host` header still carries the attacker's domain.
 *
 * @param {import('node:http').IncomingMessage} req Incoming request.
 * @returns {boolean} `true` for `localhost`, `*.localhost`, `127.0.0.1` and `[::1]` (any port).
 */
export function isLocalHostHeader(req) {
    const host = typeof req.headers.host === 'string' ? req.headers.host : '';
    try {
        const { hostname } = new URL(`http://${host}`);
        return LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost');
    }
    catch {
        return false;
    }
}

/**
 * Whether a request comes from a same-origin page fetch (Fetch Metadata), falling back to Origin / Referer checks for
 * clients that send no `Sec-Fetch-Site`.
 *
 * Boundary: used only by the token-issuing `/session` route together with {@link isLocalHostHeader}; a cross-site or
 * same-site-but-other-port page (`Sec-Fetch-Site: same-site`) is refused.
 *
 * @param {import('node:http').IncomingMessage} req Incoming request.
 * @returns {boolean} `true` when the request may receive the session.
 */
export function isSameOriginPageRequest(req) {
    const site = req.headers['sec-fetch-site'];
    if (typeof site === 'string' && site)
        return site === 'same-origin';
    return isLocalRequest(req);
}
