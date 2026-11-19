import fs from 'node:fs';
import os from 'node:os';
import { readPositiveLimit, resolveAgentProjectRoot } from './launch-prompt.js';
import { openTarget } from './opener.js';
import { createPromptHandoff, type HandoffPromptRequest } from './prompt-handoff.js';
import type { AgentEmitEvent } from './types.js';
import {
    buildWorkBuddyAppDeepLink,
    DEFAULT_WORKBUDDY_PROMPT_URL_LIMIT,
    resolveWorkBuddyScheme,
    WORKBUDDY_APP_NOT_FOUND,
    WORKBUDDY_PROMPT_TEXT_LIMIT,
    workBuddyAppCandidates,
} from './workbuddy-route.js';

/** Side effects of the WorkBuddy desktop adapter; replaceable in tests so nothing is opened on the host. */
export interface WorkBuddyAppDeps {
    platform: string;
    homedir: string;
    env: NodeJS.ProcessEnv;
    exists: (file: string) => boolean;
    open: (config: Record<string, unknown>, target: string) => Promise<void>;
}

/** Route context read by {@link createWorkBuddyAppAdapter}. */
interface WorkBuddyAppContext {
    emit: (event: AgentEmitEvent) => void;
    outputDir: string;
    projectRoot: string;
    prompt: string;
}

/**
 * Production side effects for {@link createWorkBuddyAppAdapter}.
 *
 * @returns {WorkBuddyAppDeps} Default host dependencies.
 */
function defaultDeps(): WorkBuddyAppDeps {
    return {
        platform: process.platform,
        homedir: os.homedir(),
        env: process.env,
        exists: fs.existsSync,
        open: (config, target) => openTarget(config, target),
    };
}

/**
 * Create the WorkBuddy desktop app adapter (`workbuddy-app`).
 *
 * Boundary: opens `workbuddy-ai://task?action=start&…` (or `workbuddy://` on legacy bundles) to prefill a new task in
 * the project folder without auto-submitting. Prompts longer than WorkBuddy's 8000-character parser cap or
 * `promptUrlLimit` move to a Markdown handoff file under `<outputDir>/requests/`. Availability checks the desktop
 * bundle on macOS / Windows (or an explicit `scheme` override on other platforms).
 *
 * @param {Record<string, unknown>} [config] `agents.workbuddyApp` options.
 * @param {Partial<WorkBuddyAppDeps>} [overrides] Test seam overrides.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter.
 */
export function createWorkBuddyAppAdapter(
    config: Record<string, unknown> = {},
    overrides: Partial<WorkBuddyAppDeps> = {},
) {
    const deps: WorkBuddyAppDeps = { ...defaultDeps(), ...overrides };
    const findApp = () => workBuddyAppCandidates(config, deps).find((candidate) => deps.exists(candidate)) ?? null;
    const hasExplicitScheme = typeof config.scheme === 'string' && config.scheme.trim().length > 0;

    return {
        name: 'workbuddy-app',
        async isAvailable() {
            if (findApp() || (deps.platform !== 'darwin' && deps.platform !== 'win32' && hasExplicitScheme))
                return { available: true };
            return { available: false, reason: WORKBUDDY_APP_NOT_FOUND };
        },
        async send(request: HandoffPromptRequest, context: WorkBuddyAppContext) {
            const events: AgentEmitEvent[] = [];
            const push = (type: string, text: string) => {
                const event = { type, text };
                events.push(event);
                context.emit(event);
            };
            push('started', 'Opening WorkBuddy');
            try {
                const appPath = findApp();
                if (!appPath && !(deps.platform !== 'darwin' && deps.platform !== 'win32' && hasExplicitScheme))
                    throw new Error(WORKBUDDY_APP_NOT_FOUND);
                const cwd = resolveAgentProjectRoot(config, context);
                const scheme = resolveWorkBuddyScheme(config, appPath);
                const handoff = createPromptHandoff(request, context, config, push);
                const urlLimit = readPositiveLimit(config.promptUrlLimit, DEFAULT_WORKBUDDY_PROMPT_URL_LIMIT);
                const linkFor = (prompt: string) => buildWorkBuddyAppDeepLink({
                    scheme,
                    prompt,
                    cwd,
                    welcomeMode: config.welcomeMode,
                    mode: config.mode,
                    model: config.model,
                    permissionMode: config.permissionMode,
                });
                const fits = (prompt: string) => prompt.length <= WORKBUDDY_PROMPT_TEXT_LIMIT && linkFor(prompt).length <= urlLimit;
                if (config.promptMode === 'file' || !fits(handoff.state.prompt))
                    handoff.toPointer();
                if (!handoff.fitIntent(fits))
                    throw new Error(`The WorkBuddy link exceeds promptUrlLimit (${urlLimit}) even with the request moved to a file`);
                await deps.open(config, linkFor(handoff.state.prompt));
                push('completed', 'WorkBuddy opened with the prompt prefilled');
                return {
                    ok: true,
                    agent: 'workbuddy-app',
                    requestId: request.id,
                    events,
                    output: `Opened WorkBuddy with the prompt prefilled in ${cwd}.${handoff.note()}`,
                    writtenPromptPath: handoff.state.writtenPromptPath,
                };
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                push('failed', error);
                return { ok: false, agent: 'workbuddy-app', requestId: request.id, events, error };
            }
        },
    };
}
