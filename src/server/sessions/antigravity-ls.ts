import { spawn } from 'node:child_process';
import https from 'node:https';
import path from 'node:path';

/** Both discovery and each language-server call stop after this long. */
export const LS_TIMEOUT_MS = 2000;

/** IDE language server from discovery. `csrfToken` must not be logged or copied onto a catalog row. `uid` is null on Windows. */
interface LanguageServerProcess {
    pid: number;
    uid: number | null;
    port: number;
    csrfToken: string;
    workspaceId: string;
    exe: string;
}

/** CIM JSON row. Only the command line and pid are read; anything else fails {@link parseLanguageServerCommand}. */
interface WindowsProcessRow {
    CommandLine?: string;
    commandLine?: string;
    ProcessId?: unknown;
    processId?: unknown;
}

/** Connect error JSON. Only top-level `code` or `error.code` counts; a body that merely mentions oauth is not an auth failure. */
interface AuthErrorJson {
    code?: unknown;
    error?: { code?: unknown } | null;
}

const SERVER_MARKER = /[/\\]extensions[/\\]antigravity[/\\]bin[/\\]language_server_/;

/**
 * Process-list command for the current platform.
 *
 * Boundary: macOS and Linux use `ps`. Windows asks CIM for `language_server*` processes. The command is fixed;
 * nothing from the page is interpolated into it.
 *
 * @param {string} [platform=process.platform] Node platform id.
 * @returns {{ command: string, args: string[] }} Spawn argv.
 */
export function discoveryCommand(platform = process.platform) {
    if (platform === 'win32') {
        return {
            command: 'powershell',
            args: [
                '-NoProfile',
                '-Command',
                "Get-CimInstance Win32_Process -Filter \"Name LIKE 'language_server%'\" | Select ProcessId,CommandLine | ConvertTo-Json",
            ],
        };
    }
    return { command: 'ps', args: ['-axww', '-o', 'pid=,uid=,args='] };
}

/**
 * Read one `--flag value` or `--flag=value` from a command line.
 *
 * Boundary: the value is the following non-space token. Paths that contain spaces are not read with this helper —
 * the executable path has its own scan. A missing flag returns `''`.
 *
 * @param {string} command Raw command line.
 * @param {string} name Flag name without the leading dashes.
 * @returns {string} Flag value, or `''`.
 */
function readFlag(command: string, name: string) {
    const match = String(command).match(new RegExp(`--${name}(?:=|\\s+)(\\S+)`));
    return match ? match[1] : '';
}

/**
 * Executable path of an Antigravity language server, including spaces in the app name.
 *
 * Boundary: the scan starts at the beginning of `command` (pid and uid already stripped) and ends at the first
 * whitespace after `language_server_…`. A command that does not contain the marker returns `''`.
 *
 * @param {string} command Raw command line.
 * @returns {string} Executable path, or `''`.
 */
function languageServerExecutable(command: string) {
    const text = String(command);
    const marker = text.search(SERVER_MARKER);
    if (marker < 0)
        return '';
    // `String.match` always sets `index`. The lib type marks it optional, so the match is narrowed here.
    const tail = text.slice(marker).match(/language_server_\S*/) as (RegExpMatchArray & { index: number }) | null;
    if (!tail)
        return '';
    return text.slice(0, marker + tail.index + tail[0].length).trim();
}

/**
 * Bundled CA next to a language-server binary.
 *
 * Boundary: the cert is `../dist/languageServer/cert.pem` relative to the `bin` directory. `platform` selects
 * `path.win32` or `path.posix` so a Windows layout can be checked on macOS. This is the IDE CA, not a credential store.
 *
 * @param {string} exe Absolute language-server path.
 * @param {string} [platform=process.platform] Platform used to join the path.
 * @returns {string} Absolute `cert.pem` path.
 */
export function certPathForLanguageServer(exe: string, platform: string = process.platform) {
    const api = platform === 'win32' ? path.win32 : path.posix;
    return api.normalize(api.join(api.dirname(exe), '..', 'dist', 'languageServer', 'cert.pem'));
}

/**
 * Parse one IDE language-server command into the fields the catalog needs.
 *
 * Boundary: requires the antigravity language-server path, `--app_data_dir` ending in `antigravity-ide`, and a
 * numeric `--https_server_port`. `--subclient_type hub` (the standalone Antigravity app) is rejected. When `ownUid`
 * is a number, a different uid is rejected; Windows discovery passes `null` because the CIM query has no uid.
 * The CSRF token is returned on the object and must not be logged or copied onto a catalog row.
 *
 * @param {string} command Raw command line.
 * @param {number} pid Process id.
 * @param {number | null} uid Owner uid, or null when the source has none.
 * @param {number | null} ownUid Uid that may see the process. Null skips the check.
 * @returns {LanguageServerProcess | null} Server descriptor, or null when the line is not an IDE language server.
 */
export function parseLanguageServerCommand(command: string, pid: number, uid: number | null, ownUid: number | null) {
    if (ownUid != null && uid != null && Number(ownUid) !== Number(uid))
        return null;
    if (!SERVER_MARKER.test(command) || /--subclient_type(?:=|\s+)hub\b/.test(command))
        return null;
    const appData = readFlag(command, 'app_data_dir').replace(/\\/g, '/');
    if (!appData || appData.split('/').pop() !== 'antigravity-ide')
        return null;
    const port = Number(readFlag(command, 'https_server_port'));
    const csrfToken = readFlag(command, 'csrf_token');
    const exe = languageServerExecutable(command);
    if (!Number.isInteger(port) || port <= 0 || !csrfToken || !exe)
        return null;
    return {
        pid,
        uid,
        port,
        csrfToken,
        workspaceId: readFlag(command, 'workspace_id'),
        exe,
    };
}

/**
 * Parse a `ps -o pid=,uid=,args=` table.
 *
 * Boundary: non-matching lines are dropped. `ownUid` filters out other users. The returned objects still hold the
 * CSRF token in memory for the subsequent loopback call.
 *
 * @param {string} text Full `ps` stdout.
 * @param {number | null | undefined} ownUid Current user id. `undefined` is treated as null (no uid filter).
 * @returns {LanguageServerProcess[]} IDE language servers.
 */
export function parseProcessTable(text: string, ownUid: number | null | undefined) {
    const servers: LanguageServerProcess[] = [];
    for (const line of String(text ?? '').split(/\r?\n/)) {
        const match = line.match(/^\s*(\d+)\s+(\d+)\s+([\s\S]+)$/);
        if (!match)
            continue;
        const parsed = parseLanguageServerCommand(match[3], Number(match[1]), Number(match[2]), ownUid ?? null);
        if (parsed)
            servers.push(parsed);
    }
    return servers;
}

/**
 * Parse Windows CIM JSON (`ProcessId`, `CommandLine`) into the same descriptor shape.
 *
 * Boundary: a single object or an array are both accepted. Invalid JSON returns an empty list rather than throwing
 * into the menu. Uid is not available, so no uid filter is applied.
 *
 * @param {string} text PowerShell `ConvertTo-Json` output.
 * @returns {LanguageServerProcess[]} IDE language servers.
 */
export function parseWindowsProcessJson(text: string) {
    let value: WindowsProcessRow | WindowsProcessRow[] | null;
    try {
        value = JSON.parse(text);
    }
    catch {
        return [];
    }
    const rows = Array.isArray(value) ? value : value ? [value] : [];
    const servers: LanguageServerProcess[] = [];
    for (const row of rows) {
        const command = row?.CommandLine ?? row?.commandLine ?? '';
        const pid = Number(row?.ProcessId ?? row?.processId);
        const parsed = parseLanguageServerCommand(command, pid, null, null);
        if (parsed)
            servers.push(parsed);
    }
    return servers;
}

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
 * @param {AuthErrorJson | null | undefined} json Response JSON. Arrays and non-objects are not auth errors.
 * @returns {boolean} True for an explicit auth error object.
 */
function explicitAuthError(json: AuthErrorJson | null | undefined) {
    if (!json || typeof json !== 'object' || Array.isArray(json))
        return false;
    const nested = json.error;
    const code = typeof json.code === 'string'
        ? json.code
        : (nested && typeof nested === 'object' && typeof nested.code === 'string' ? nested.code : '');
    return AUTH_ERROR_CODES.has(code.toLowerCase());
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
 * @param {{ readCert: Function, exchange?: Function }} io Cert loader and optional transport.
 * @returns {Promise<Record<string, unknown>>} Parsed JSON body.
 */
export async function callLanguageServer(ls: { port: number; csrfToken: string }, method: string, body: unknown, io: { readCert: Function; exchange?: Function }) {
    const cert = await io.readCert(ls);
    const request = buildLanguageServerRequest(ls, method, body, cert);
    let response;
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
    return new Promise((resolve, reject) => {
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
export function discoverLanguageServers(io: any = {}) {
    if (typeof io.processText === 'string') {
        const platform = io.platform ?? process.platform;
        if (platform === 'win32')
            return Promise.resolve(parseWindowsProcessJson(io.processText));
        return Promise.resolve(parseProcessTable(io.processText, io.uid ?? null));
    }
    const platform = io.platform ?? process.platform;
    const spec = discoveryCommand(platform);
    const ownUid = io.uid === undefined ? process.getuid?.() ?? null : io.uid;
    return new Promise((resolve) => {
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
