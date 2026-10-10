import { execFileSync } from 'node:child_process';
import type { CascadeIdeSpec } from './cascade-ide-spec.js';
import {
    antigravityIdeWorkspaceId,
    antigravityIdeWorkspaceSlug,
    extensionServerPort,
    parseProcessTable,
    workspaceIdFlag,
} from './antigravity-ide-bridge-host.js';

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
export interface CascadeBridgeHostHooks {
    listProcesses?: () => ProcessRow[];
    listenerPids?: (port: number) => number[];
    restart?: (pid: number) => boolean;
}

/** Process-row predicate for one product's language server. */
export interface CascadeHostPredicates {
    isLanguageServer: (command: string) => boolean;
    isExtensionHost: (command: string) => boolean;
}

/**
 * Predicates that identify `spec`'s language server and extension host in a process table.
 *
 * Boundary: the language server is matched by `language_server_` in the binary name plus the
 * `--extensions_dir` value containing the product's data-dir segment (`/.devin/extensions`,
 * `/.windsurf/extensions`) — that flag is what keeps Devin's `language_server_…` apart from the
 * standalone `windsurf` CLI's or another IDE's. The extension host is the `<App> Helper (Plugin)`
 * running `node.mojom.NodeService`; a renderer or the language server itself must not be signaled.
 *
 * @param {CascadeIdeSpec} spec Product spec.
 * @returns {CascadeHostPredicates} Command-line predicates.
 */
export function cascadeIdeHostPredicates(spec: CascadeIdeSpec): CascadeHostPredicates {
    return {
        isLanguageServer(command: string) {
            const text = String(command).replace(/\\/g, '/');
            return /language_server_/.test(text) && text.includes(spec.extensionsDirMarker);
        },
        isExtensionHost(command: string) {
            const text = String(command);
            return text.includes(spec.helperMarker) && text.includes('node.mojom.NodeService');
        },
    };
}

/**
 * List local processes.
 *
 * Boundary: the command is fixed. Windows and a failed `ps` return an empty list so nothing is signaled
 * by guesswork.
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
 * Pick the extension host for the IDE window that has `workspacePath` open.
 *
 * Boundary: the match is `--workspace_id` on the language server, which is the sha256 of the folder's
 * `file:` URL or the older `file_` underscore slug (the same Codeium ids Antigravity uses). The host is
 * the process listening on that server's `--extension_server_port`. When several servers match, the
 * highest pid wins. A listener whose command is present and is not the extension host is skipped.
 * Returns null when nothing matches — callers must not signal an unrelated pid.
 *
 * @param {CascadeIdeSpec} spec Product spec.
 * @param {{ processes: ProcessRow[], workspacePath: string, listenerPidsByPort: ReadonlyMap<number, number[]> }} input Process table and port listeners.
 * @returns {number | null} Extension-host pid.
 */
export function chooseCascadeIdeExtensionHost(spec: CascadeIdeSpec, input: {
    processes: ProcessRow[],
    workspacePath: string,
    listenerPidsByPort: ReadonlyMap<number, number[]>,
}) {
    const predicates = cascadeIdeHostPredicates(spec);
    const ids = new Set([
        antigravityIdeWorkspaceId(input.workspacePath),
        antigravityIdeWorkspaceSlug(input.workspacePath),
    ]);
    const matches = input.processes
        .filter((row) => predicates.isLanguageServer(row.command) && ids.has(workspaceIdFlag(row.command)))
        .sort((a, b) => b.pid - a.pid);
    for (const server of matches) {
        const port = extensionServerPort(server.command);
        if (!port)
            continue;
        for (const pid of input.listenerPidsByPort.get(port) ?? []) {
            const host = input.processes.find((row) => row.pid === pid);
            if (host && !predicates.isExtensionHost(host.command))
                continue;
            return pid;
        }
    }
    return null;
}

/**
 * Extension host for `workspacePath`, or null when it cannot be identified.
 *
 * @param {CascadeIdeSpec} spec Product spec.
 * @param {string} workspacePath Absolute IDE folder.
 * @param {CascadeBridgeHostHooks} [hooks] Process lookup overrides.
 * @returns {number | null} Host pid.
 */
export function findCascadeIdeExtensionHostPid(spec: CascadeIdeSpec, workspacePath: string, hooks: CascadeBridgeHostHooks = {}) {
    const predicates = cascadeIdeHostPredicates(spec);
    const processes = (hooks.listProcesses ?? listProcesses)();
    const lookup = hooks.listenerPids ?? listenerPids;
    const ports = new Map<number, number[]>();
    for (const row of processes) {
        if (!predicates.isLanguageServer(row.command))
            continue;
        const port = extensionServerPort(row.command);
        if (port && !ports.has(port))
            ports.set(port, lookup(port));
    }
    return chooseCascadeIdeExtensionHost(spec, {
        processes,
        workspacePath,
        listenerPidsByPort: ports,
    });
}

/**
 * Ask the IDE to restart one extension host by signaling it.
 *
 * Boundary: the pid must be a `spec` extension host in the current process table. Any other pid is
 * ignored. SIGTERM is what the IDE treats as an unexpected host exit and then relaunches.
 *
 * @param {CascadeIdeSpec} spec Product spec.
 * @param {number} pid Extension-host pid.
 * @param {CascadeBridgeHostHooks} [hooks] Process lookup overrides.
 * @returns {boolean} True when the signal was sent.
 */
export function restartCascadeIdeExtensionHost(spec: CascadeIdeSpec, pid: number, hooks: CascadeBridgeHostHooks = {}) {
    if (hooks.restart)
        return hooks.restart(pid) === true;
    const predicates = cascadeIdeHostPredicates(spec);
    const row = listProcesses().find((item) => item.pid === pid);
    if (!row || !predicates.isExtensionHost(row.command))
        return false;
    try {
        process.kill(pid, 'SIGTERM');
        return true;
    }
    catch {
        return false;
    }
}
