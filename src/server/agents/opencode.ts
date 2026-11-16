import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSessionPicker } from '../sessions/options.js';
import { listOpenCodeSessions } from '../sessions/opencode-sessions.js';
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
    /** Optional `opencode session list` runner override for tests. */
    list?: (command: string, cwd: string) => string;
}

/** Result returned by {@link createOpenCodeAdapter}'s `send`. */
export interface OpenCodeSendResult {
    ok: boolean;
    agent: 'opencode';
    requestId: string;
    events: AgentEmitEvent[];
    output?: string;
    error?: string;
    writtenPromptPath?: string;
    targetSessionId?: string;
}

/** Route context the adapter reads. */
interface OpenCodeContext {
    emit: (event: AgentEmitEvent) => void;
    outputDir: string;
    projectRoot: string;
    prompt: string;
    targetSession?: { id: string, cwd: string, targetable?: boolean } | null;
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
 * 1.x build; 2.x desktops drop `new-session` deeplinks, so they — along with CLI-only or non-macOS installs and any
 * existing-session resume (`targetSession`) — get a Terminal launcher running `opencode <dir> [--session <id>]
 * --prompt=<prompt>`, which submits it. `launch: 'app'` forces deeplinks and disables session listing. The background
 * service and its password are never touched.
 *
 * @param {Record<string, unknown>} [config] `agents.opencode` options.
 * @param {Partial<OpenCodeDeps>} [overrides] Replacement side effects for tests.
 * @returns {{ name: string, sessionsEnabled: boolean, isAvailable: Function, listSessions: Function, send: Function }} Agent adapter.
 */
export function createOpenCodeAdapter(config: Record<string, unknown> = {}, overrides: Partial<OpenCodeDeps> = {}) {
    const deps: OpenCodeDeps = { ...defaultDeps(), ...overrides };
    const launch = readOpenCodeLaunch(config.launch);
    const sessionsEnabled = launch !== 'app' && readSessionPicker(config).enabled;
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
        sessionsEnabled,
        async isAvailable() {
            const appPath = findApp();
            if (launch === 'app' || deeplinkReady(readMajor(appPath)) || await resolveCli(appPath))
                return { available: true };
            return { available: false, reason: OPENCODE_NOT_FOUND };
        },
        /**
         * List project sessions via `opencode session list --format json`. Not called when `sessionsEnabled` is false.
         *
         * @param {{ projectRoot: string }} ctx Inspector project root.
         * @returns {Promise<{ sessions: Array<Record<string, unknown>>, delivery: string, notice?: string }>}
         */
        async listSessions(ctx: { projectRoot: string }) {
            return listOpenCodeSessions({
                projectRoot: ctx.projectRoot,
                config,
                io: {
                    resolveCommand: () => resolveCli(findApp()),
                    runList: deps.list,
                },
            });
        },
        async send(request: HandoffPromptRequest, context: OpenCodeContext): Promise<OpenCodeSendResult> {
            const target = context.targetSession;
            const events: AgentEmitEvent[] = [];
            const push = (type: string, text: string) => {
                const event = { type, text };
                events.push(event);
                context.emit(event);
            };
            push('started', target ? 'Resuming OpenCode session' : 'Opening OpenCode');
            try {
                const directory = target ? target.cwd : resolveAgentProjectRoot(config, context);
                const pathConfig = target ? { ...config, projectRoot: target.cwd } : config;
                const handoff = createPromptHandoff(request, context, pathConfig, (type, text) => {
                    push(type, target && type === 'file-change' ? 'Wrote prompt handoff' : text);
                });
                const appPath = findApp();
                const desktopMajor = !target && launch === 'auto' ? readMajor(appPath) : null;
                const skipCli = !target && (launch === 'app' || deeplinkReady(desktopMajor));
                const command = skipCli ? null : await resolveCli(appPath);
                const route = target
                    ? (command ? { route: 'terminal' as const } : { route: 'unavailable' as const })
                    : pickOpenCodeRoute({ launch, platform: deps.platform, desktopMajor, cliAvailable: command !== null });
                if (pathConfig.promptMode === 'file')
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
                if (shouldWriteLauncherPromptFile(pathConfig, handoff.state.prompt))
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
                        args: openCodeLauncherArgs(directory, target?.id),
                    }, deps.platform),
                });
                push('file-change', target ? 'Wrote launcher' : `Wrote launcher ${launchPath}`);
                await deps.open(config, launchPath);
                push('completed', 'OpenCode opened and the prompt was submitted');
                return {
                    ok: true,
                    agent: 'opencode',
                    requestId: request.id,
                    events,
                    output: target
                        ? 'Opened OpenCode and submitted the prompt to the session.'
                        : `Opened OpenCode in Terminal and submitted the prompt (${promptPath}).${handoff.note()}`,
                    ...(target
                        ? { targetSessionId: target.id }
                        : { writtenPromptPath: handoff.state.writtenPromptPath ?? promptPath }),
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
