import { spawn } from 'node:child_process';
import https from 'node:https';
import {
    discoveryCommand,
    parseProcessTable,
    parseWindowsProcessJson,
} from './antigravity-ls-parse.js';
import type { LanguageServerProcess } from './antigravity-ls-parse.js';

export {
    certPathForLanguageServer,
    discoveryCommand,
    parseLanguageServerCommand,
    parseProcessTable,
    parseWindowsProcessJson,
} from './antigravity-ls-parse.js';
export type { LanguageServerProcess } from './antigravity-ls-parse.js';

/** Both discovery and each language-server call stop after this long. */
export const LS_TIMEOUT_MS = 2000;

/**
 * HTTPS request descriptor for one language-server RPC.
 *
 * Boundary: the CA is pinned and certificate verification is left on, so a bad cert fails closed (`ls-tls`).
 * The CSRF header is the only auth material, taken from the process args. `body` is JSON. Callers must not add
 * `metadata` or `api_key`.
 *
 * @param {{ port: number, csrfToken: string }} ls Language server from discovery.
 * @param {string} method RPC name (`GetAllCascadeTrajectories`, `SendUserCascadeMessage`, …).
 * @param {unknown} body JSON body. `null` and `undefined` are sent as `{}`. Callers must not put `metadata` or `api_key` here.
 * @param {string | Buffer} cert Bundled CA contents.
 * @returns {{ options: Record<string, unknown>, timeoutMs: number, body: string }} Request passed to the transport.
 */
export function buildLanguageServerRequest(ls: { port: number; csrfToken: string }, method: string, body: unknown, cert: string | Buffer) {
    return {
        options: {
            host: '127.0.0.1',
            port: ls.port,
            servername: 'localhost',
            method: 'POST',
            path: `/exa.language_server_pb.LanguageServerService/${method}`,
            ca: cert,
            headers: {
                'Content-Type': 'application/json',
                'Connect-Protocol-Version': '1',
                'X-Codeium-Csrf-Token': ls.csrfToken,
            },
        },
        timeoutMs: LS_TIMEOUT_MS,
        body: JSON.stringify(body ?? {}),
    };
}

/**
 * True when an HTTPS error is a certificate failure.
 *
 * @param {{ code?: string } | null | undefined} err HTTPS error. `code` is the Node errno; a missing object is not a TLS failure.
 * @returns {boolean} True for Node TLS verification failures.
 */
function isTlsError(err: { code?: string } | null | undefined) {
    const code = err?.code ?? '';
    return code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
        || code === 'CERT_HAS_EXPIRED'
        || code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
        || code === 'SELF_SIGNED_CERT_IN_CHAIN'
        || code === 'ERR_TLS_CERT_ALTNAME_INVALID';
}

/** Connect / HTTP auth codes. A title that merely mentions "oauth" is not one of these. */
const AUTH_ERROR_CODES = new Set(['unauthenticated', 'permission_denied', 'unauthorized']);

/**
 * Whether the JSON is an auth failure, not a successful payload that happens to contain those words.
 *
 * Boundary: only a top-level `code` or `error.code` is inspected. Scanning the whole body would treat a session
 * titled "oauth login", or a 200 send body that mentions `api_key`, as `ls-requires-credentials`.
 *
 * @param {Record<string, unknown> | null | undefined} json Response JSON. Arrays and non-objects are not auth errors.
 * @returns {boolean} True for an explicit auth error object.
 */
function explicitAuthError(json: Record<string, unknown> | null | undefined) {
    if (!json || typeof json !== 'object' || Array.isArray(json))
        return false;
    const nested = json.error;
    const code = typeof json.code === 'string'
        ? json.code
        : (nested && typeof nested === 'object' && 'code' in nested && typeof nested.code === 'string' ? nested.code : '');
    return AUTH_ERROR_CODES.has(code.toLowerCase());
}

/** One language-server request envelope built by {@link buildLanguageServerRequest}. */
export type LanguageServerRequest = ReturnType<typeof buildLanguageServerRequest>;

/** Response a transport returns for one RPC. `json` is the parsed Connect/JSON body. */
export type LanguageServerResponse = { status?: number; json?: Record<string, unknown> | null };

/**
 * Cert loader + optional transport injected into {@link callLanguageServer}.
 * Boundary: declared with method syntax so test doubles that take a narrower `ls` (e.g. only `{ exe: string }`)
 * still assign under strict function types.
 */
export interface LanguageServerIo {
    readCert(ls: { port: number; csrfToken: string; exe?: string }): Promise<string | Buffer> | string | Buffer;
    exchange?(request: LanguageServerRequest): Promise<LanguageServerResponse | null | undefined>;
}

/**
 * Perform one language-server RPC.
 *
 * Boundary: tests pass `io.exchange` and never open a socket. Production uses loopback HTTPS with the bundled CA.
 * TLS failure becomes `ls-tls`. HTTP 401/403 or an explicit auth `code` becomes `ls-requires-credentials` and does
 * not trigger a read of any credential file. A 200 body is returned even when its text mentions oauth or api_key.
 * Other failures become `ls-unreachable`. The CSRF token is not copied into the thrown error.
 *
 * @param {{ port: number, csrfToken: string }} ls Language server descriptor. `readCert` receives the same object, so an
 *        `exe` field is still present at runtime when the default loader is used.
 * @param {string} method RPC name.
 * @param {unknown} body JSON body forwarded to {@link buildLanguageServerRequest}.
 * @param {LanguageServerIo} io Cert loader and optional transport.
 * @returns {Promise<Record<string, unknown>>} Parsed JSON body.
 */
export async function callLanguageServer(ls: { port: number; csrfToken: string }, method: string, body: unknown, io: LanguageServerIo) {
    const cert = await io.readCert(ls);
    const request = buildLanguageServerRequest(ls, method, body, cert);
    let response: LanguageServerResponse | null | undefined;
    try {
        response = await (io.exchange ?? exchangeHttps)(request);
    }
    catch (err) {
        const tls = isTlsError(err as { code?: string } | null);
        throw Object.assign(new Error(tls ? 'Language server TLS verification failed' : 'Language server did not respond'), {
            code: tls ? 'ls-tls' : 'ls-unreachable',
        });
    }
    if (response?.status === 401 || response?.status === 403 || explicitAuthError(response?.json)) {
        throw Object.assign(new Error('Language server requires credentials'), { code: 'ls-requires-credentials' });
    }
    if (response?.status && response.status >= 400) {
        throw Object.assign(new Error('Language server did not respond'), { code: 'ls-unreachable' });
    }
    return response?.json ?? {};
}

/**
 * Loopback HTTPS exchange used when no test transport is injected.
 *
 * Boundary: options come from {@link buildLanguageServerRequest} and therefore pin `ca` without disabling
 * verification. The timer aborts the request at {@link LS_TIMEOUT_MS}. Response bodies are capped at 2 MB.
 *
 * @param {{ options: import('https').RequestOptions, timeoutMs: number, body: string }} request Built request.
 * @returns {Promise<{ status: number, json: Record<string, unknown> }>} Status and parsed JSON (empty when blank).
 */
function exchangeHttps(request: { options: import('https').RequestOptions, timeoutMs: number, body: string }) {
    return new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
        const req = https.request(request.options, (res) => {
            const chunks: Buffer[] = [];
            let size = 0;
            res.on('data', (chunk) => {
                size += chunk.length;
                if (size > 2_000_000) {
                    req.destroy(new Error('Language server response too large'));
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let json: Record<string, unknown> = {};
                if (text) {
                    try {
                        json = JSON.parse(text);
                    }
                    catch {
                        json = {};
                    }
                }
                resolve({ status: res.statusCode ?? 0, json });
            });
        });
        req.setTimeout(request.timeoutMs ?? LS_TIMEOUT_MS, () => {
            req.destroy(Object.assign(new Error('Language server timed out'), { code: 'ls-unreachable' }));
        });
        req.on('error', reject);
        req.end(request.body);
    });
}

/**
 * Run the platform process list and return IDE language servers.
 *
 * Boundary: `io.processText` skips the spawn (tests). Otherwise the child is killed at {@link LS_TIMEOUT_MS}.
 * A spawn failure resolves to an empty list so the menu can still offer a new session.
 *
 * @param {{ processText?: string, uid?: number | null, platform?: string }} [io] Test fixture or live defaults.
 * @returns {Promise<LanguageServerProcess[]>} Discovered servers. CSRF tokens stay on these objects.
 */
export function discoverLanguageServers(io: { processText?: unknown; platform?: string; uid?: number | null } = {}) {
    if (typeof io.processText === 'string') {
        const platform = io.platform ?? process.platform;
        if (platform === 'win32')
            return Promise.resolve(parseWindowsProcessJson(io.processText));
        return Promise.resolve(parseProcessTable(io.processText, io.uid ?? null));
    }
    const platform = (io.platform ?? process.platform) as NodeJS.Platform;
    const spec = discoveryCommand(platform);
    const ownUid = io.uid === undefined ? process.getuid?.() ?? null : io.uid;
    return new Promise<LanguageServerProcess[]>((resolve) => {
        let settled = false;
        const finish = (servers: LanguageServerProcess[]) => {
            if (settled)
                return;
            settled = true;
            resolve(servers);
        };
        let child;
        try {
            child = spawn(spec.command, spec.args, { stdio: ['ignore', 'pipe', 'ignore'] });
        }
        catch {
            finish([]);
            return;
        }
        const chunks: Buffer[] = [];
        child.stdout?.on('data', (chunk) => chunks.push(chunk));
        const timer = setTimeout(() => {
            child.kill();
            finish([]);
        }, LS_TIMEOUT_MS);
        child.once('error', () => {
            clearTimeout(timer);
            finish([]);
        });
        child.once('close', () => {
            clearTimeout(timer);
            const text = Buffer.concat(chunks).toString('utf8');
            finish(platform === 'win32' ? parseWindowsProcessJson(text) : parseProcessTable(text, ownUid));
        });
    });
}
