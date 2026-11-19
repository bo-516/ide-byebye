import fs from 'node:fs';
import os from 'node:os';
import { probeCommandVersion, resolveFirstCommand, writeLaunchFiles } from './launch-files.js';
import { resolveAgentProjectRoot, shouldWriteLauncherPromptFile } from './launch-prompt.js';
import { buildLauncherFile } from './launch-script.js';
import { openTarget } from './opener.js';
import { createPromptHandoff, type HandoffPromptRequest } from './prompt-handoff.js';
import type { AgentEmitEvent } from './types.js';
import {
    resolveWorkBuddyCliCommandCandidates,
    WORKBUDDY_CLI_NOT_FOUND,
    workBuddyAppCandidates,
    workBuddyCliLauncherArgs,
} from './workbuddy-route.js';

/** Side effects of the WorkBuddy CLI adapter; replaceable in tests so nothing is spawned or opened. */
export interface WorkBuddyCliDeps {
    platform: string;
    homedir: string;
    env: NodeJS.ProcessEnv;
    exists: (file: string) => boolean;
    probe: (command: string) => Promise<boolean>;
    open: (config: Record<string, unknown>, target: string) => Promise<void>;
}

/** Route context read by {@link createWorkBuddyCliAdapter}. */
interface WorkBuddyCliContext {
    emit: (event: AgentEmitEvent) => void;
    outputDir: string;
    projectRoot: string;
    prompt: string;
}

/**
 * Production side effects for {@link createWorkBuddyCliAdapter}.
 *
 * @returns {WorkBuddyCliDeps} Default host dependencies.
 */
function defaultDeps(): WorkBuddyCliDeps {
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
 * Create the WorkBuddy / CodeBuddy CLI adapter (`workbuddy-cli`).
 *
 * Boundary: probes `codebuddy` on PATH, user install paths, and the CLI unpacked inside `WorkBuddy AI.app` /
 * `WorkBuddy.app`, then opens a Terminal launcher running interactive `codebuddy` in `projectRoot` with the prompt
 * passed as the initial turn.
 *
 * @param {Record<string, unknown>} [config] `agents.workbuddyCli` options.
 * @param {Partial<WorkBuddyCliDeps>} [overrides] Test seam overrides.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter.
 */
export function createWorkBuddyCliAdapter(
    config: Record<string, unknown> = {},
    overrides: Partial<WorkBuddyCliDeps> = {},
) {
    const deps: WorkBuddyCliDeps = { ...defaultDeps(), ...overrides };
    const findApp = () => workBuddyAppCandidates(config, deps).find((candidate) => deps.exists(candidate)) ?? null;
    const resolveCli = () => resolveFirstCommand(
        resolveWorkBuddyCliCommandCandidates(config, {
            platform: deps.platform,
            homedir: deps.homedir,
            appPath: findApp(),
        }),
        deps.probe,
    );

    return {
        name: 'workbuddy-cli',
        async isAvailable() {
            if (await resolveCli())
                return { available: true };
            return { available: false, reason: WORKBUDDY_CLI_NOT_FOUND };
        },
        async send(request: HandoffPromptRequest, context: WorkBuddyCliContext) {
            const events: AgentEmitEvent[] = [];
            const push = (type: string, text: string) => {
                const event = { type, text };
                events.push(event);
                context.emit(event);
            };
            push('started', 'Opening WorkBuddy CLI');
            try {
                const command = await resolveCli();
                if (!command)
                    throw new Error(WORKBUDDY_CLI_NOT_FOUND);
                const cwd = resolveAgentProjectRoot(config, context);
                const handoff = createPromptHandoff(request, context, config, push);
                if (shouldWriteLauncherPromptFile(config, handoff.state.prompt))
                    handoff.toPointer();
                const { launchPath, promptPath } = writeLaunchFiles({
                    request,
                    context,
                    tag: 'workbuddy',
                    prompt: handoff.state.prompt,
                    platform: deps.platform,
                    buildScript: (promptFile) => buildLauncherFile({
                        command,
                        cwd,
                        promptPath: promptFile,
                        args: workBuddyCliLauncherArgs(config),
                    }, deps.platform),
                });
                push('file-change', `Wrote launcher ${launchPath}`);
                await deps.open(config, launchPath);
                push('completed', 'WorkBuddy CLI opened and the prompt was submitted');
                return {
                    ok: true,
                    agent: 'workbuddy-cli',
                    requestId: request.id,
                    events,
                    output: `Opened WorkBuddy CLI in Terminal and submitted the prompt (${promptPath}).${handoff.note()}`,
                    writtenPromptPath: handoff.state.writtenPromptPath ?? promptPath,
                };
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                push('failed', error);
                return { ok: false, agent: 'workbuddy-cli', requestId: request.id, events, error };
            }
        },
    };
}
