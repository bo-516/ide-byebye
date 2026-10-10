import type { IncomingMessage, ServerResponse } from 'node:http';
import { TOKEN_HEADER } from '../shared/constants.js';
import { readToken, tokenMatches } from './security.js';

/**
 * HTTP helpers for the inspector routes: JSON I/O, URL parsing, and token-gated CORS.
 *
 * Boundary: pure request/response primitives; no route matching or business logic lives here.
 */

/** JSON response. `body` is `unknown` so route object literals stay assignable. */
export function sendJson(res: ServerResponse, status: number, body: unknown) {
    const text = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(text);
}

/**
 * Read a JSON body. Node emits `Buffer` chunks when no encoding is set.
 *
 * @param {IncomingMessage} req Request stream. `destroy` aborts an oversized body.
 * @param {number} [limitBytes=15000000] Max accepted bytes.
 * @returns {Promise<Record<string, unknown>>} Parsed JSON object, or `{}` when the body is empty.
 */
export function readJsonBody<T = Record<string, unknown>>(req: IncomingMessage, limitBytes = 15_000_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limitBytes) {
                reject(new Error('Request body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                const text = Buffer.concat(chunks).toString('utf8');
                resolve(text ? JSON.parse(text) : {});
            }
            catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

/** Pathname of `req.url`, or the raw url when it is not a URL. */
export function pathname(req: { url?: string }) {
    try {
        return new URL(req.url ?? '', 'http://localhost').pathname;
    }
    catch {
        return req.url ?? '';
    }
}

/** One query parameter, or null when the url cannot be parsed. `name` is the parameter key. */
export function searchParam(req: { url?: string }, name: string) {
    try {
        return new URL(req.url ?? '', 'http://localhost').searchParams.get(name);
    }
    catch {
        return null;
    }
}

/**
 * Reads the request Origin header.
 *
 * Boundary: only a single string origin is accepted. Missing or malformed origin values return null and therefore do
 * not receive inspector CORS headers; callers must still perform token validation before trusting cross-origin access.
 *
 * @param {import('node:http').IncomingMessage} req Incoming dev-server request.
 * @returns {string | null} Request origin suitable for echoing into CORS headers, or null.
 */
export function readOrigin(req: IncomingMessage) {
    const origin = req.headers.origin;
    return typeof origin === 'string' && origin ? origin : null;
}

/**
 * Appends `Origin` to the Vary response header without dropping existing values.
 *
 * Boundary: callers should use this only on inspector responses where CORS can vary by request origin. Passing a
 * response with a non-string Vary header leaves array handling to Node's normal header serialization.
 *
 * @param {import('node:http').ServerResponse} res Dev-server response.
 * @returns {void}
 */
export function appendOriginVary(res: ServerResponse) {
    const current = res.getHeader('Vary');
    if (!current) {
        res.setHeader('Vary', 'Origin');
        return;
    }

    const text = Array.isArray(current) ? current.join(', ') : String(current);
    if (!text.toLowerCase().split(',').map((value) => value.trim()).includes('origin')) {
        res.setHeader('Vary', `${text}, Origin`);
    }
}

/**
 * Adds CORS headers for token-authenticated inspector requests.
 *
 * Boundary: cross-origin inspector access is allowed only when the per-process token is present in the query or header.
 * Without this, pages opened through a custom business dev domain cannot call the local `ip:port/__intent-inspector`
 * server; with a wrong token, no CORS headers are emitted and the request is rejected by the route guard.
 *
 * @param {import('node:http').IncomingMessage} req Incoming dev-server request.
 * @param {import('node:http').ServerResponse} res Dev-server response.
 * @param {string} token Per-process dev token.
 * @returns {boolean} True when CORS headers were emitted for a valid token-bearing origin request.
 */
export function setTokenCorsHeaders(req: IncomingMessage, res: ServerResponse, token: string) {
    const origin = readOrigin(req);
    if (!origin || !tokenMatches(token, readToken(req))) {
        return false;
    }

    appendOriginVary(res);
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', `${TOKEN_HEADER}, Content-Type`);
    res.setHeader('Access-Control-Max-Age', '600');

    return true;
}
