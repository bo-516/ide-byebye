import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    buildCascadeIdeBridgeExtensionPackage,
    buildCascadeIdeBridgeExtensionSource,
} from './cascade-ide-bridge-extension.js';
import {
    findCascadeIdeExtensionHostPid,
    restartCascadeIdeExtensionHost,
    type CascadeBridgeHostHooks,
} from './cascade-ide-bridge-host.js';
import {
    sameFilesystemPath,
    safeBridgeRequestId,
} from './antigravity-ide-bridge.js';
import type { CascadeIdeSpec } from './cascade-ide-spec.js';

/** How long a window heartbeat stays fresh enough to skip an extension-host restart. */
const HEARTBEAT_TTL_MS = 20000;
/** Bridge request poll interval while waiting for the IDE ack. */
const ACK_POLL_MS = 200;

/**
 * Directories the bridge and the IDE extension share.
 *
 * Boundary: everything stays under `~/<dataDir>/<bridgeDir>`. A relative `home` is resolved. The
 * extension reads the same paths from `os.homedir()`, so a mismatched `home` makes the IDE ignore
 * the request.
 *
 * @param {CascadeIdeSpec} spec Product spec.
 * @param {string} [home=os.homedir()] User home directory.
 * @returns {{ root: string, requests: string, acks: string, windows: string }} Absolute directories.
 */
export function cascadeIdeBridgePaths(spec: CascadeIdeSpec, home = os.homedir()) {
    const root = path.join(path.resolve(home), spec.dataDirName, spec.bridgeDirName);
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
 * @param {CascadeIdeSpec} spec Product spec.
 * @param {string} [home=os.homedir()] User home directory.
 * @returns {string} Absolute extension directory for this bridge version.
 */
export function cascadeIdeBridgeExtensionDir(spec: CascadeIdeSpec, home = os.homedir()) {
    return path.join(path.resolve(home), spec.dataDirName, 'extensions', spec.extensionDirName);
}

/**
 * Whether `file` already contains `expected`.
 *
 * @param {string} file Absolute path.
 * @param {string} expected Desired contents.
 * @returns {boolean} True when the file matches.
 */
function sameFile(file: string, expected: string) {
    try {
        return fs.readFileSync(file, 'utf8') === expected;
    }
    catch {
        return false;
    }
}

/**
 * Install or refresh the bridge extension under the IDE's user extensions directory.
 *
 * Boundary: writes only `extension.js` and `package.json` inside {@link cascadeIdeBridgeExtensionDir}.
 * An unchanged install is left untouched. This does not reload an already-running extension host.
 *
 * @param {CascadeIdeSpec} spec Product spec.
 * @param {string} [home=os.homedir()] User home directory.
 * @returns {{ dir: string, updated: boolean }} Install location and whether files changed.
 */
export function installCascadeIdeBridge(spec: CascadeIdeSpec, home = os.homedir()) {
    const dir = cascadeIdeBridgeExtensionDir(spec, home);
    fs.mkdirSync(dir, { recursive: true });
    const packagePath = path.join(dir, 'package.json');
    const extensionPath = path.join(dir, 'extension.js');
    const updated = !sameFile(packagePath, buildCascadeIdeBridgeExtensionPackage(spec))
        || !sameFile(extensionPath, buildCascadeIdeBridgeExtensionSource(spec));
    if (updated) {
        fs.writeFileSync(packagePath, buildCascadeIdeBridgeExtensionPackage(spec));
        fs.writeFileSync(extensionPath, buildCascadeIdeBridgeExtensionSource(spec));
    }
    return { dir, updated };
}

/**
 * Write the prompt request the extension will hand to the chat panel.
 *
 * Boundary: the file name is only {@link safeBridgeRequestId}. `argument` is the pre-encoded
 * `SendActionToChatPanelRequest` JSON string — stored as data and passed to `executeCommand` by the
 * extension, never evaluated.
 *
 * @param {CascadeIdeSpec} spec Product spec.
 * @param {{ id: string, workspacePath: string, argument: string, home?: string, now?: number }} input Request fields.
 * @returns {string} Absolute request path.
 */
export function writeCascadeIdeBridgeRequest(spec: CascadeIdeSpec, input: { id: string, workspacePath: string, argument: string, home?: string, now?: number }) {
    const paths = cascadeIdeBridgePaths(spec, input.home);
    fs.mkdirSync(paths.requests, { recursive: true });
    const id = safeBridgeRequestId(input.id);
    const target = path.join(paths.requests, `${id}.json`);
    const body = {
        id,
        workspacePath: path.resolve(input.workspacePath),
        argument: String(input.argument ?? ''),
        createdAt: input.now ?? Date.now(),
    };
    fs.writeFileSync(target, JSON.stringify(body), { mode: 0o600 });
    return target;
}

/**
 * Read a bridge ack file.
 *
 * @param {CascadeIdeSpec} spec Product spec.
 * @param {string} id Request id.
 * @param {string} [home] User home directory.
 * @returns {{ id: string, ok: boolean, error?: string } | null} Ack, or null when it is not written yet.
 */
export function readCascadeIdeBridgeAck(spec: CascadeIdeSpec, id: string, home = os.homedir()) {
    const file = path.join(cascadeIdeBridgePaths(spec, home).acks, `${safeBridgeRequestId(id)}.json`);
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
 * Path comparison follows {@link sameFilesystemPath}.
 *
 * @param {CascadeIdeSpec} spec Product spec.
 * @param {string} workspacePath Folder opened in the IDE.
 * @param {{ home?: string, now?: number, pidAlive?: (pid: number) => boolean }} [options] Clock and pid probe.
 * @returns {boolean} True when the extension is running in that window.
 */
export function cascadeIdeBridgeIsRunning(spec: CascadeIdeSpec, workspacePath: string, options: { home?: string, now?: number, pidAlive?: (pid: number) => boolean } = {}) {
    const dir = cascadeIdeBridgePaths(spec, options.home).windows;
    let names: string[];
    try {
        names = fs.readdirSync(dir);
    }
    catch {
        return false;
    }
    const now = options.now ?? Date.now();
    const pidAlive = options.pidAlive ?? ((pid: number) => {
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
            if ((beat.folders ?? []).some((folder: string) => sameFilesystemPath(folder, workspacePath)))
                return true;
        }
        catch {
            // Ignore a half-written heartbeat.
        }
    }
    return false;
}

/**
 * Poll until the ack exists or the deadline passes.
 *
 * @param {CascadeIdeSpec} spec Product spec.
 * @param {string} id Request id.
 * @param {number} timeoutMs Maximum wait.
 * @param {string} home User home directory.
 * @returns {Promise<{ id: string, ok: boolean, error?: string } | null>} Ack, or null on timeout.
 */
function waitForAck(spec: CascadeIdeSpec, id: string, timeoutMs: number, home: string): Promise<{ id: string, ok: boolean, error?: string } | null> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
        const poll = () => {
            const ack = readCascadeIdeBridgeAck(spec, id, home);
            if (ack)
                resolve(ack);
            else if (Date.now() >= deadline)
                resolve(null);
            else
                setTimeout(poll, ACK_POLL_MS);
        };
        poll();
    });
}

/**
 * Delete a request file so a later extension start does not apply a stale prompt.
 *
 * @param {CascadeIdeSpec} spec Product spec.
 * @param {string} id Request id.
 * @param {string} home User home directory.
 */
function discardRequest(spec: CascadeIdeSpec, id: string, home: string) {
    const safe = safeBridgeRequestId(id);
    const dir = cascadeIdeBridgePaths(spec, home).requests;
    fs.rmSync(path.join(dir, `${safe}.json`), { force: true });
    fs.rmSync(path.join(dir, `${safe}.json.processing`), { force: true });
}

/**
 * Finish from an ack, or throw when the IDE never applied the prompt.
 *
 * @param {CascadeIdeSpec} spec Product spec.
 * @param {{ id: string, ok: boolean, error?: string } | null} ack Ack from the extension.
 * @param {string} id Request id.
 * @param {string} home User home directory.
 * @returns {void}
 */
function finishAck(spec: CascadeIdeSpec, ack: { id: string, ok: boolean, error?: string } | null, id: string, home: string) {
    if (!ack) {
        discardRequest(spec, id, home);
        throw new Error(`${spec.displayName} opened the folder, but the chat input did not accept the prompt. Reload that IDE window and try again.`);
    }
    if (!ack.ok) {
        discardRequest(spec, id, home);
        throw new Error(ack.error || `${spec.displayName} rejected the chat input prompt.`);
    }
}

/**
 * Open the IDE folder, then place the encoded prompt `argument` into that window's Cascade input.
 *
 * Boundary: `insert` mode uses the `addCascadeInput` action — the text stays in the composer; `submit`
 * mode uses `sendCascadeInputNewConversation`, which creates a new conversation and submits. An
 * already-running bridge is reused. Otherwise the extension host for this folder is restarted once,
 * because an already-open IDE window does not load a newly installed extension. The host is chosen
 * only by the language server's `--workspace_id`. When that host cannot be identified, this throws
 * after the folder has been opened instead of signaling some other window.
 *
 * @param {CascadeIdeSpec} spec Product spec.
 * @param {{ id: string, workspacePath: string, argument: string, home?: string, openWorkspace: () => Promise<void>, hooks?: CascadeBridgeHostHooks & { pidAlive?: (pid: number) => boolean } }} input Delivery inputs.
 * @returns {Promise<void>} Resolves when the IDE ack says the action was delivered.
 */
export async function deliverCascadeIdePrompt(spec: CascadeIdeSpec, input: {
    id: string,
    workspacePath: string,
    argument: string,
    home?: string,
    openWorkspace: () => Promise<void>,
    hooks?: CascadeBridgeHostHooks & { pidAlive?: (pid: number) => boolean },
}) {
    const home = input.home ?? os.homedir();
    const id = safeBridgeRequestId(input.id);
    const hooks = input.hooks ?? {};
    const running = () => cascadeIdeBridgeIsRunning(spec, input.workspacePath, { home, pidAlive: hooks.pidAlive });
    installCascadeIdeBridge(spec, home);
    writeCascadeIdeBridgeRequest(spec, { ...input, id, home });
    await input.openWorkspace();
    let ack = await waitForAck(spec, id, running() ? 15000 : 2000, home);
    if (ack)
        return finishAck(spec, ack, id, home);
    if (!running()) {
        const deadline = Date.now() + 8000;
        let pid: number | null = null;
        while (!pid && !ack && Date.now() < deadline) {
            pid = findCascadeIdeExtensionHostPid(spec, input.workspacePath, hooks);
            if (!pid)
                ack = await waitForAck(spec, id, 400, home);
        }
        if (!ack && pid)
            restartCascadeIdeExtensionHost(spec, pid, hooks);
    }
    if (!ack)
        ack = await waitForAck(spec, id, 20000, home);
    finishAck(spec, ack, id, home);
}
