import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BRIDGE_EXTENSION_PACKAGE, BRIDGE_EXTENSION_SOURCE } from './antigravity-ide-bridge-extension.js';
import { findAntigravityIdeExtensionHostPid, restartAntigravityIdeExtensionHost } from './antigravity-ide-bridge-host.js';

/** How long a window heartbeat stays fresh enough to skip an extension-host restart. */
const HEARTBEAT_TTL_MS = 20000;

/**
 * Directories the bridge and the IDE extension share.
 *
 * Boundary: everything stays under `~/.antigravity-ide/ide-byebye-bridge`. A relative `home` is resolved.
 * The extension reads the same paths from `os.homedir()`, so a mismatched `home` makes the IDE ignore the request.
 *
 * @param {string} [home=os.homedir()] User home directory.
 * @returns {{ root: string, requests: string, acks: string, windows: string }} Absolute directories.
 */
export function antigravityIdeBridgePaths(home = os.homedir()) {
    const root = path.join(path.resolve(home), '.antigravity-ide', 'ide-byebye-bridge');
    return {
        root,
        requests: path.join(root, 'requests'),
        acks: path.join(root, 'acks'),
        windows: path.join(root, 'windows'),
    };
}

/**
 * Folder the IDE scans for user extensions.
 *
 * @param {string} [home=os.homedir()] User home directory.
 * @returns {string} Absolute extension directory for this bridge version.
 */
export function antigravityIdeBridgeExtensionDir(home = os.homedir()) {
    return path.join(path.resolve(home), '.antigravity-ide', 'extensions', 'local.ide-byebye-bridge-0.1.0');
}

/**
 * Compare two filesystem paths the way the current platform does.
 *
 * @param {string} left First path.
 * @param {string} right Second path.
 * @param {string} [platform=process.platform] Node platform id.
 * @returns {boolean} True when both resolve to the same location.
 */
export function sameFilesystemPath(left, right, platform = process.platform) {
    const a = path.resolve(left);
    const b = path.resolve(right);
    if (platform === 'darwin' || platform === 'win32')
        return a.toLowerCase() === b.toLowerCase();
    return a === b;
}

/**
 * Install or refresh the bridge extension under the IDE's user extensions directory.
 *
 * Boundary: writes only `extension.js` and `package.json` inside {@link antigravityIdeBridgeExtensionDir}.
 * An unchanged install is left untouched. This does not reload an already-running extension host.
 *
 * @param {string} [home=os.homedir()] User home directory.
 * @returns {{ dir: string, updated: boolean }} Install location and whether files changed.
 */
export function installAntigravityIdeBridge(home = os.homedir()) {
    const dir = antigravityIdeBridgeExtensionDir(home);
    fs.mkdirSync(dir, { recursive: true });
    const packagePath = path.join(dir, 'package.json');
    const extensionPath = path.join(dir, 'extension.js');
    const updated = !sameFile(packagePath, BRIDGE_EXTENSION_PACKAGE) || !sameFile(extensionPath, BRIDGE_EXTENSION_SOURCE);
    if (updated) {
        fs.writeFileSync(packagePath, BRIDGE_EXTENSION_PACKAGE);
        fs.writeFileSync(extensionPath, BRIDGE_EXTENSION_SOURCE);
    }
    return { dir, updated };
}

/**
 * Whether `file` already contains `expected`.
 *
 * @param {string} file Absolute path.
 * @param {string} expected Desired contents.
 * @returns {boolean} True when the file matches.
 */
function sameFile(file, expected) {
    try {
        return fs.readFileSync(file, 'utf8') === expected;
    }
    catch {
        return false;
    }
}

/**
 * Request id safe to use as a single filename.
 *
 * Boundary: anything other than a uuid-like token is replaced, so a page-supplied id cannot escape the requests directory.
 *
 * @param {string} id Proposed id.
 * @returns {string} Safe id.
 */
export function safeBridgeRequestId(id) {
    return /^[A-Za-z0-9-]{8,80}$/.test(String(id ?? '')) ? String(id) : randomUUID();
}

/**
 * Write the prompt request the extension will place in the agent input.
 *
 * Boundary: the file name is only {@link safeBridgeRequestId}. `message` is stored as JSON, not executed.
 * `files` should already be inside the project; the extension checks again.
 *
 * @param {{ id: string, workspacePath: string, message: string, files?: string[], home?: string, now?: number }} input Request fields.
 * @returns {string} Absolute request path.
 */
export function writeAntigravityIdeBridgeRequest(input) {
    const paths = antigravityIdeBridgePaths(input.home);
    fs.mkdirSync(paths.requests, { recursive: true });
    const id = safeBridgeRequestId(input.id);
    const target = path.join(paths.requests, `${id}.json`);
    const body = {
        id,
        workspacePath: path.resolve(input.workspacePath),
        message: String(input.message ?? ''),
        files: (input.files ?? []).filter((file) => typeof file === 'string' && file),
        createdAt: input.now ?? Date.now(),
    };
    fs.writeFileSync(target, JSON.stringify(body), { mode: 0o600 });
    return target;
}

/**
 * Read a bridge ack file.
 *
 * @param {string} id Request id.
 * @param {string} [home] User home directory.
 * @returns {{ id: string, ok: boolean, error?: string } | null} Ack, or null when it is not written yet.
 */
export function readAntigravityIdeBridgeAck(id, home = os.homedir()) {
    const file = path.join(antigravityIdeBridgePaths(home).acks, `${safeBridgeRequestId(id)}.json`);
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!parsed || typeof parsed.ok !== 'boolean')
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}

/**
 * Whether a live bridge heartbeat already lists this folder.
 *
 * Boundary: a heartbeat older than {@link HEARTBEAT_TTL_MS} or whose pid is dead does not count.
 * `pidAlive` returning false skips that file. Path comparison follows {@link sameFilesystemPath}.
 *
 * @param {string} workspacePath Folder opened in the IDE.
 * @param {{ home?: string, now?: number, pidAlive?: (pid: number) => boolean }} [options] Clock and pid probe.
 * @returns {boolean} True when the extension is running in that window.
 */
export function antigravityIdeBridgeIsRunning(workspacePath, options: any = {}) {
    const dir = antigravityIdeBridgePaths(options.home).windows;
    let names = [];
    try {
        names = fs.readdirSync(dir);
    }
    catch {
        return false;
    }
    const now = options.now ?? Date.now();
    const pidAlive = options.pidAlive ?? ((pid) => {
        try {
            process.kill(pid, 0);
            return true;
        }
        catch {
            return false;
        }
    });
    for (const name of names) {
        if (!name.endsWith('.json'))
            continue;
        try {
            const beat = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
            if (!beat || now - Number(beat.at) > HEARTBEAT_TTL_MS || !pidAlive(Number(beat.pid)))
                continue;
            if ((beat.folders ?? []).some((folder) => sameFilesystemPath(folder, workspacePath)))
                return true;
        }
        catch {
            // Ignore a half-written heartbeat.
        }
    }
    return false;
}

/**
 * Hooks for process lookup. Tests pass fakes; production uses `ps` and `lsof`.
 *
 * @typedef {{ listProcesses?: () => import('./antigravity-ide-bridge-host.js').ProcessRow[], listenerPids?: (port: number) => number[], restart?: (pid: number) => boolean, pidAlive?: (pid: number) => boolean }} BridgeHostHooks
 */

/**
 * Poll until the ack exists or the deadline passes.
 *
 * @param {string} id Request id.
 * @param {number} timeoutMs Maximum wait.
 * @param {string} [home] User home directory.
 * @returns {Promise<{ id: string, ok: boolean, error?: string } | null>} Ack, or null on timeout.
 */
function waitForAck(id, timeoutMs, home) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
        const poll = () => {
            const ack = readAntigravityIdeBridgeAck(id, home);
            if (ack)
                resolve(ack);
            else if (Date.now() >= deadline)
                resolve(null);
            else
                setTimeout(poll, 200);
        };
        poll();
    });
}

/**
 * Delete a request file so a later extension start does not apply a stale prompt.
 *
 * @param {string} id Request id.
 * @param {string} [home] User home directory.
 */
function discardRequest(id, home) {
    const safe = safeBridgeRequestId(id);
    const dir = antigravityIdeBridgePaths(home).requests;
    fs.rmSync(path.join(dir, `${safe}.json`), { force: true });
    fs.rmSync(path.join(dir, `${safe}.json.processing`), { force: true });
}

/**
 * Finish from an ack, or throw when the IDE never applied the prompt.
 *
 * @param {{ id: string, ok: boolean, error?: string } | null} ack Ack from the extension.
 * @param {string} id Request id.
 * @param {string} home User home directory.
 * @returns {void}
 */
function finishAck(ack, id, home) {
    if (!ack) {
        discardRequest(id, home);
        throw new Error('Antigravity IDE opened the folder, but the agent input did not accept the prompt. Reload that IDE window and try again.');
    }
    if (!ack.ok) {
        discardRequest(id, home);
        throw new Error(ack.error || 'Antigravity IDE rejected the agent input prompt.');
    }
}

/**
 * Open the IDE folder, then place `message` in that window's agent input.
 *
 * Boundary: the extension calls `sendToAgentPanel` with `autoSend: false`, so the text stays in the input.
 * An already-running bridge is reused. Otherwise the extension host for this folder is restarted once,
 * because an already-open IDE window does not load a newly installed extension. The host is chosen only
 * by the language server's `--workspace_id`. When that host cannot be identified, this throws after the
 * folder has been opened instead of signaling some other window.
 *
 * @param {{ id: string, workspacePath: string, message: string, files?: string[], home?: string, openWorkspace: () => Promise<void>, hooks?: BridgeHostHooks }} input Delivery inputs.
 * @returns {Promise<void>} Resolves when the IDE ack says the input was filled.
 */
export async function deliverAntigravityIdePrompt(input) {
    const home = input.home ?? os.homedir();
    const id = safeBridgeRequestId(input.id);
    const hooks = input.hooks ?? {};
    const running = () => antigravityIdeBridgeIsRunning(input.workspacePath, { home, pidAlive: hooks.pidAlive });
    installAntigravityIdeBridge(home);
    writeAntigravityIdeBridgeRequest({ ...input, id, home });
    await input.openWorkspace();
    let ack = await waitForAck(id, running() ? 15000 : 2000, home);
    if (ack)
        return finishAck(ack, id, home);
    if (!running()) {
        const deadline = Date.now() + 8000;
        let pid = null;
        while (!pid && !ack && Date.now() < deadline) {
            pid = findAntigravityIdeExtensionHostPid(input.workspacePath, hooks);
            if (!pid)
                ack = await waitForAck(id, 400, home);
        }
        if (!ack && pid)
            restartAntigravityIdeExtensionHost(pid, hooks);
    }
    if (!ack)
        ack = await waitForAck(id, 20000, home);
    finishAck(ack, id, home);
}
