import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * One row from `ps`.
 *
 * @typedef {{ pid: number, command: string }} ProcessRow
 */
interface ProcessRow {
    pid: number;
    command: string;
}

/** Hooks for process lookup. Tests pass fakes; production uses `ps` and `lsof`. */
interface BridgeHostHooks {
    listProcesses?: () => ProcessRow[];
    listenerPids?: (port: number) => number[];
    restart?: (pid: number) => boolean;
}

/**
 * Workspace id Antigravity IDE puts in `--workspace_id` for a folder.
 *
 * Boundary: the IDE hashes `pathToFileURL(folder).href` with sha256. A relative path is resolved first.
 * A trailing slash changes the URL, so callers must pass the folder the CLI actually opens.
 *
 * @param {string} workspacePath Absolute folder opened in the IDE.
 * @returns {string} Lowercase hex digest.
 */
export function antigravityIdeWorkspaceId(workspacePath: string) {
    const href = pathToFileURL(path.resolve(workspacePath)).href;
    return createHash('sha256').update(href).digest('hex');
}

/**
 * Older `--workspace_id` shape: `file_` plus the path with separators turned into underscores.
 *
 * @param {string} workspacePath Absolute folder.
 * @returns {string} Slug id.
 */
export function antigravityIdeWorkspaceSlug(workspacePath: string) {
    const resolved = path.resolve(workspacePath).replace(/^[A-Za-z]:/, (drive) => drive[0]);
    return `file_${resolved.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
}

/**
 * Parse `ps -o pid=,command=` output.
 *
 * Boundary: the first integer is the pid and the rest of the line is the command, so paths with spaces stay intact.
 * Blank lines are skipped.
 *
 * @param {string} text Raw `ps` output.
 * @returns {ProcessRow[]} Process rows.
 */
export function parseProcessTable(text: string) {
    const rows = [];
    for (const line of String(text ?? '').split('\n')) {
        const match = line.match(/^\s*(\d+)\s+(.*\S)\s*$/);
        if (!match)
            continue;
        rows.push({ pid: Number(match[1]), command: match[2] });
    }
    return rows;
}

/**
 * Read `--extension_server_port` from a language-server command.
 *
 * @param {string} command Raw command line.
 * @returns {number | null} Port, or null when the flag is missing or not a port.
 */
export function extensionServerPort(command: string) {
    const match = String(command).match(/--extension_server_port(?:=|\s+)(\d+)/);
    const port = match ? Number(match[1]) : NaN;
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

/**
 * Read `--workspace_id` from a language-server command.
 *
 * @param {string} command Raw command line.
 * @returns {string} Id, or `''` when the flag is absent.
 */
export function workspaceIdFlag(command: string) {
    const match = String(command).match(/--workspace_id(?:=|\s+)(\S+)/);
    return match ? match[1] : '';
}

/**
 * Whether this process is the Antigravity IDE extension host, not a helper language server.
 *
 * Boundary: the host is the Plugin helper running `node.mojom.NodeService`. A renderer or the
 * `language_server` binary must not be signaled.
 *
 * @param {string} command Raw command line.
 * @returns {boolean} True for the IDE extension host.
 */
export function isAntigravityIdeExtensionHost(command: string) {
    const text = String(command);
    return text.includes('Antigravity IDE Helper (Plugin)') && text.includes('node.mojom.NodeService');
}

/**
 * Whether a language-server command belongs to Antigravity IDE rather than the desktop app.
 *
 * @param {string} command Raw command line.
 * @returns {boolean} True for an IDE language server.
 */
export function isAntigravityIdeLanguageServer(command: string) {
    const text = String(command);
    return /language_server_/.test(text)
        && text.includes('antigravity')
        && !/--subclient_type(?:=|\s+)hub\b/.test(text)
        && /antigravity-ide/.test(text);
}

/**
 * Pick the extension host for the IDE window that has `workspacePath` open.
 *
 * Boundary: the match is `--workspace_id` on the language server, which is the sha256 of the folder's
 * `file:` URL (or the older underscore slug). The host is the process listening on that server's
 * `--extension_server_port`. When several servers match, the highest pid wins. A listener whose command
 * is present and is not the extension host is skipped. Returns null when nothing matches — callers must
 * not signal an unrelated pid.
 *
 * @param {{ processes: ProcessRow[], workspacePath: string, listenerPidsByPort: ReadonlyMap<number, number[]> }} input Process table and port listeners.
 * @returns {number | null} Extension-host pid.
 */
export function chooseAntigravityIdeExtensionHost(input: {
    processes: ProcessRow[],
    workspacePath: string,
    listenerPidsByPort: ReadonlyMap<number, number[]>,
}) {
    const ids = new Set([
        antigravityIdeWorkspaceId(input.workspacePath),
        antigravityIdeWorkspaceSlug(input.workspacePath),
    ]);
    const matches = input.processes
        .filter((row) => isAntigravityIdeLanguageServer(row.command) && ids.has(workspaceIdFlag(row.command)))
        .sort((a, b) => b.pid - a.pid);
    for (const server of matches) {
        const port = extensionServerPort(server.command);
        if (!port)
            continue;
        for (const pid of input.listenerPidsByPort.get(port) ?? []) {
            const host = input.processes.find((row) => row.pid === pid);
            if (host && !isAntigravityIdeExtensionHost(host.command))
                continue;
            return pid;
        }
    }
    return null;
}

/**
 * List local processes.
 *
 * Boundary: the command is fixed. Windows and a failed `ps` return an empty list so nothing is signaled by guesswork.
 *
 * @returns {ProcessRow[]} Process rows.
 */
function listProcesses() {
    if (process.platform === 'win32')
        return [];
    try {
        return parseProcessTable(execFileSync('ps', ['-axww', '-o', 'pid=,command='], {
            encoding: 'utf8',
            timeout: 5000,
            maxBuffer: 8 * 1024 * 1024,
        }));
    }
    catch {
        return [];
    }
}

/**
 * Pids listening on `port`.
 *
 * @param {number} port TCP port.
 * @returns {number[]} Listener pids.
 */
function listenerPids(port: number) {
    if (process.platform === 'win32')
        return [];
    try {
        const text = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], {
            encoding: 'utf8',
            timeout: 5000,
        });
        return [...text.matchAll(/^p(\d+)/gm)].map((match) => Number(match[1]));
    }
    catch {
        return [];
    }
}

/**
 * Extension host for `workspacePath`, or null when it cannot be identified.
 *
 * @param {string} workspacePath Absolute IDE folder.
 * @param {BridgeHostHooks} [hooks] Process lookup overrides.
 * @returns {number | null} Host pid.
 */
export function findAntigravityIdeExtensionHostPid(workspacePath: string, hooks: BridgeHostHooks = {}) {
    const processes = (hooks.listProcesses ?? listProcesses)();
    const lookup = hooks.listenerPids ?? listenerPids;
    const ports = new Map();
    for (const row of processes) {
        if (!isAntigravityIdeLanguageServer(row.command))
            continue;
        const port = extensionServerPort(row.command);
        if (port && !ports.has(port))
            ports.set(port, lookup(port));
    }
    return chooseAntigravityIdeExtensionHost({
        processes,
        workspacePath,
        listenerPidsByPort: ports,
    });
}

/**
 * Ask VS Code to restart one extension host by signaling it.
 *
 * Boundary: the pid must be an Antigravity IDE extension host in the current process table.
 * Any other pid is ignored. SIGTERM is what the IDE treats as an unexpected host exit and then relaunches.
 *
 * @param {number} pid Extension-host pid.
 * @param {BridgeHostHooks} [hooks] Process lookup overrides.
 * @returns {boolean} True when the signal was sent.
 */
export function restartAntigravityIdeExtensionHost(pid: number, hooks: BridgeHostHooks = {}) {
    if (hooks.restart)
        return hooks.restart(pid) === true;
    const row = listProcesses().find((item) => item.pid === pid);
    if (!row || !isAntigravityIdeExtensionHost(row.command))
        return false;
    try {
        process.kill(pid, 'SIGTERM');
        return true;
    }
    catch {
        return false;
    }
}
