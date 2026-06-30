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
