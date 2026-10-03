import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeCommandVersion, resolveFirstCommand, writeLaunchFiles } from './launch-files.js';
import { readPositiveLimit, resolveAgentProjectRoot, shouldWriteLauncherPromptFile } from './launch-prompt.js';
import { buildLauncherFile } from './launch-script.js';
import { openTarget } from './opener.js';
import {
    buildOpenCodeDeepLink,
    DEFAULT_OPENCODE_PROMPT_URL_LIMIT,
    OPENCODE_DEEPLINK_MAJORS,
    OPENCODE_NOT_FOUND,
    OPENCODE_PLIST_READ_LIMIT,
    openCodeAppCandidates,
    openCodeLauncherArgs,
    parseOpenCodeBundleMajor,
    pickOpenCodeRoute,
    readOpenCodeLaunch,
    resolveOpenCodeCommandCandidates,
} from './opencode-route.js';
import { createPromptHandoff, type HandoffPromptRequest } from './prompt-handoff.js';
import type { AgentEmitEvent } from './types.js';

/** Side effects of the OpenCode adapter; tests replace them so nothing is spawned or opened. */
export interface OpenCodeDeps {
    platform: string;
    homedir: string;
    exists: (file: string) => boolean;
    /** The first `limit` bytes of a file as UTF-8, or null when it cannot be read. */
    readHead: (file: string, limit: number) => string | null;
    /** `--version` probe for one CLI candidate. */
    probe: (command: string) => Promise<boolean>;
    /** Opens a deeplink or launcher; `config` carries `openCommand` / `openArgs`. */
    open: (config: Record<string, unknown>, target: string) => Promise<void>;
}

/** Route context the adapter reads. */
interface OpenCodeContext {
    emit: (event: AgentEmitEvent) => void;
    outputDir: string;
    projectRoot: string;
    prompt: string;
}

/**
 * Read up to `limit` bytes of `file`.
 *
 * @param {string} file Absolute path. @param {number} limit Byte cap.
 * @returns {string | null} UTF-8 text, or null on any read error.
 */
function readFileHead(file: string, limit: number) {
    try {
        const fd = fs.openSync(file, 'r');
        try {
            const buffer = Buffer.alloc(limit);
            return buffer.subarray(0, fs.readSync(fd, buffer, 0, limit, 0)).toString('utf8');
        }
        finally {
            fs.closeSync(fd);
        }
    }
    catch {
        return null;
    }
}

/**
 * Real side effects, used for every dependency the caller does not override.
 *
 * @returns {OpenCodeDeps} Production dependencies.
 */
function defaultDeps(): OpenCodeDeps {
    return {
        platform: process.platform,
        homedir: os.homedir(),
        exists: fs.existsSync,
        readHead: readFileHead,
        probe: (command) => probeCommandVersion(command),
        open: (config, target) => openTarget(config, target),
    };
}

/**
 * Create the OpenCode adapter (`opencode`).
 *
 * Boundary: `launch: 'auto'` (default) opens a new desktop session with the prompt prefilled when the macOS app is a
 * 1.x build; 2.x desktops drop deeplinks, so they — and CLI-only or non-macOS installs — get a Terminal launcher
 * running `opencode <dir> --prompt=<prompt>`, which submits it. The app is found from fixed bundle paths or
 * `appPath`; nothing comes from the page. The background service and its password are never touched.
 *
 * @param {Record<string, unknown>} [config] `agents.opencode` options.
 * @param {Partial<OpenCodeDeps>} [overrides] Replacement side effects for tests.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter.
 */
export function createOpenCodeAdapter(config: Record<string, unknown> = {}, overrides: Partial<OpenCodeDeps> = {}) {
    const deps: OpenCodeDeps = { ...defaultDeps(), ...overrides };
    const launch = readOpenCodeLaunch(config.launch);
    /** @returns {string | null} The first installed desktop bundle (macOS only). */
    const findApp = () => openCodeAppCandidates(config, deps).find((candidate) => deps.exists(candidate)) ?? null;
    /** @param {string | null} appPath Installed bundle. @returns {number | null} Its major version, if readable. */
    const readMajor = (appPath: string | null) => {
        const plist = appPath ? deps.readHead(path.join(appPath, 'Contents', 'Info.plist'), OPENCODE_PLIST_READ_LIMIT) : null;
        return plist === null ? null : parseOpenCodeBundleMajor(plist);
    };
    /** @param {string | null} appPath Installed bundle. @returns {Promise<string | null>} First working CLI. */
    const resolveCli = (appPath: string | null) => resolveFirstCommand(resolveOpenCodeCommandCandidates(config, { homedir: deps.homedir, appPath }), deps.probe);
    /** @param {number | null} major Desktop major. @returns {boolean} Whether `auto` would use the deeplink. */
    const deeplinkReady = (major: number | null) => launch === 'auto' && deps.platform === 'darwin'
        && major !== null && OPENCODE_DEEPLINK_MAJORS.includes(major);

    return {
        name: 'opencode',
        async isAvailable() {
            const appPath = findApp();
            if (launch === 'app' || deeplinkReady(readMajor(appPath)) || await resolveCli(appPath))
                return { available: true };
            return { available: false, reason: OPENCODE_NOT_FOUND };
        },
        async send(request: HandoffPromptRequest, context: OpenCodeContext) {
            const events: AgentEmitEvent[] = [];
            const push = (type: string, text: string) => {
                const event = { type, text };
                events.push(event);
                context.emit(event);
            };
            push('started', 'Opening OpenCode');
            try {
                const directory = resolveAgentProjectRoot(config, context);
                const handoff = createPromptHandoff(request, context, config, push);
                const appPath = findApp();
                const desktopMajor = launch === 'auto' ? readMajor(appPath) : null;
                const command = launch === 'app' || deeplinkReady(desktopMajor) ? null : await resolveCli(appPath);
                const route = pickOpenCodeRoute({ launch, platform: deps.platform, desktopMajor, cliAvailable: command !== null });
                if (config.promptMode === 'file')
                    handoff.toPointer();
                if (route.route === 'app') {
                    const urlLimit = readPositiveLimit(config.promptUrlLimit, DEFAULT_OPENCODE_PROMPT_URL_LIMIT);
                    if (buildOpenCodeDeepLink({ directory, prompt: handoff.state.prompt }).length > urlLimit)
                        handoff.toPointer();
                    await deps.open(config, buildOpenCodeDeepLink({ directory, prompt: handoff.state.prompt }));
                    push('completed', 'OpenCode opened with the prompt prefilled');
                    return {
                        ok: true,
                        agent: 'opencode',
                        requestId: request.id,
                        events,
                        output: `Opened OpenCode with the prompt prefilled in a new session.${handoff.note()}`,
                        writtenPromptPath: handoff.state.writtenPromptPath,
                    };
                }
                if (!command)
                    throw new Error(OPENCODE_NOT_FOUND);
                if (shouldWriteLauncherPromptFile(config, handoff.state.prompt))
                    handoff.toPointer();
                const { launchPath, promptPath } = writeLaunchFiles({
                    request,
                    context,
                    tag: 'opencode',
                    prompt: handoff.state.prompt,
                    platform: deps.platform,
                    buildScript: (promptFile) => buildLauncherFile({
                        command,
                        cwd: directory,
                        promptPath: promptFile,
                        args: openCodeLauncherArgs(directory),
                    }, deps.platform),
                });
                push('file-change', `Wrote launcher ${launchPath}`);
                await deps.open(config, launchPath);
                push('completed', 'OpenCode opened and the prompt was submitted');
                return {
                    ok: true,
                    agent: 'opencode',
                    requestId: request.id,
                    events,
                    output: `Opened OpenCode in Terminal and submitted the prompt (${promptPath}).${handoff.note()}`,
                    writtenPromptPath: handoff.state.writtenPromptPath ?? promptPath,
                };
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                push('failed', error);
                return { ok: false, agent: 'opencode', requestId: request.id, events, error };
            }
        },
    };
}
