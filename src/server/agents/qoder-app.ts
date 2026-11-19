import fs from 'node:fs';
import os from 'node:os';
import { probeCommandVersion } from './launch-files.js';
import { readPositiveLimit } from './launch-prompt.js';
import { openTarget } from './opener.js';
import { createPromptHandoff, type HandoffPromptRequest } from './prompt-handoff.js';
import {
    buildQoderAppDeepLink,
    DEFAULT_QODER_PROMPT_URL_LIMIT,
    QODER_APP_NOT_FOUND,
    qoderAppCandidates,
} from './qoder-route.js';
import type { AgentEmitEvent } from './types.js';

/** Side effects of the Qoder desktop / IDE adapter; replaceable in tests so nothing is probed or opened. */
export interface QoderAppDeps {
    platform: string;
    homedir: string;
    env: NodeJS.ProcessEnv;
    exists: (file: string) => boolean;
    probe: (command: string) => Promise<boolean>;
    open: (config: Record<string, unknown>, target: string) => Promise<void>;
}

/** Route context read by {@link createQoderAppAdapter}. */
interface QoderAppContext {
    emit: (event: AgentEmitEvent) => void;
    outputDir: string;
    projectRoot: string;
    prompt: string;
}

/**
 * Production side effects for {@link createQoderAppAdapter}.
 *
 * @returns {QoderAppDeps} Default host dependencies.
 */
function defaultDeps(): QoderAppDeps {
    return {
        platform: process.platform,
        homedir: os.homedir(),
        env: process.env,
        exists: fs.existsSync,
        probe: (command) => probeCommandVersion(command),
        open: (config, target) => openTarget(config, target),
    };
}

/**
 * Create the Qoder IDE / Desktop deeplink adapter (`qoder-app`).
 *
 * Boundary: opens `qoder://aicoding.aicoding-deeplink/chat?text=…` to prefill a Qoder chat session without auto-sending.
 * Long prompts beyond `promptUrlLimit` move to a Markdown handoff file under `<outputDir>/requests/`. Availability
 * checks the desktop bundle on macOS / Windows, and falls back to `qoder` on PATH (or an explicit `scheme`) on Linux.
 *
 * @param {Record<string, unknown>} [config] `agents.qoderApp` options.
 * @param {Partial<QoderAppDeps>} [overrides] Test seam overrides.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter.
 */
export function createQoderAppAdapter(
    config: Record<string, unknown> = {},
    overrides: Partial<QoderAppDeps> = {},
) {
    const deps: QoderAppDeps = { ...defaultDeps(), ...overrides };
    const hasExplicitScheme = typeof config.scheme === 'string' && config.scheme.trim().length > 0;
    const isInstalled = async () => {
        if (qoderAppCandidates(config, deps).some((candidate) => deps.exists(candidate)))
            return true;
        if (deps.platform !== 'darwin' && deps.platform !== 'win32')
            return hasExplicitScheme || await deps.probe('qoder');
        return false;
    };

    return {
        name: 'qoder-app',
        async isAvailable() {
            if (await isInstalled())
                return { available: true };
            return { available: false, reason: QODER_APP_NOT_FOUND };
        },
        async send(request: HandoffPromptRequest, context: QoderAppContext) {
            const events: AgentEmitEvent[] = [];
            const push = (type: string, text: string) => {
                const event = { type, text };
                events.push(event);
                context.emit(event);
            };
            push('started', 'Opening Qoder');
            try {
                if (!await isInstalled())
                    throw new Error(QODER_APP_NOT_FOUND);
                const handoff = createPromptHandoff(request, context, config, push);
                const urlLimit = readPositiveLimit(config.promptUrlLimit, DEFAULT_QODER_PROMPT_URL_LIMIT);
                const linkFor = (prompt: string) => buildQoderAppDeepLink({
                    scheme: config.scheme,
                    authority: config.authority,
                    route: config.route,
                    prompt,
                    mode: config.mode,
                    isNewChat: config.isNewChat,
                });
                const fits = (prompt: string) => linkFor(prompt).length <= urlLimit;
                if (config.promptMode === 'file' || !fits(handoff.state.prompt))
                    handoff.toPointer();
                if (!handoff.fitIntent(fits))
                    throw new Error(`The Qoder deeplink exceeds promptUrlLimit (${urlLimit}) even with the request moved to a file`);
                await deps.open(config, linkFor(handoff.state.prompt));
                push('completed', 'Qoder opened with the prompt prefilled');
                return {
                    ok: true,
                    agent: 'qoder-app',
                    requestId: request.id,
                    events,
                    output: `Opened Qoder with the prompt prefilled.${handoff.note()}`,
                    writtenPromptPath: handoff.state.writtenPromptPath,
                };
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                push('failed', error);
                return { ok: false, agent: 'qoder-app', requestId: request.id, events, error };
            }
        },
    };
}
