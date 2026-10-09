import path from 'node:path';

/** IDE language server from discovery. `csrfToken` must not be logged or copied onto a catalog row. `uid` is null on Windows. */
export interface LanguageServerProcess {
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
