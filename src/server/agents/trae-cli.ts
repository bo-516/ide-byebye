import os from 'node:os';
import { probeCommandVersion, resolveFirstCommand, writeLaunchFiles } from './launch-files.js';
import { resolveAgentProjectRoot, shouldWriteLauncherPromptFile } from './launch-prompt.js';
import { buildLauncherFile } from './launch-script.js';
import { openTarget } from './opener.js';
import { createPromptHandoff, type HandoffPromptRequest } from './prompt-handoff.js';
import {
    resolveTraeCliCommandCandidates,
    TRAE_CLI_NOT_FOUND,
    traeCliLauncherArgs,
} from './trae-route.js';
import type { AgentEmitEvent } from './types.js';

/** Side effects of the TRAE CLI adapter; replaceable in tests so nothing is spawned or opened. */
export interface TraeCliDeps {
    platform: string;
    homedir: string;
    env: NodeJS.ProcessEnv;
    probe: (command: string) => Promise<boolean>;
    open: (config: Record<string, unknown>, target: string) => Promise<void>;
}

/** Route context read by {@link createTraeCliAdapter}. */
interface TraeCliContext {
    emit: (event: AgentEmitEvent) => void;
    outputDir: string;
    projectRoot: string;
    prompt: string;
}

/**
 * Production side effects for {@link createTraeCliAdapter}.
 *
 * @returns {TraeCliDeps} Default host dependencies.
 */
function defaultDeps(): TraeCliDeps {
    return {
        platform: process.platform,
        homedir: os.homedir(),
        env: process.env,
        probe: (command) => probeCommandVersion(command),
        open: (config, target) => openTarget(config, target),
    };
}

/**
 * Create the TRAE CLI adapter (`trae-cli`).
 *
 * Boundary: probes `traecli` on PATH and the official `install_v2.sh` install directories, then opens a Terminal
 * launcher running interactive `traecli --cd <cwd> -- "<prompt>"`.
 *
 * @param {Record<string, unknown>} [config] `agents.traeCli` options.
 * @param {Partial<TraeCliDeps>} [overrides] Test seam overrides.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter.
 */
export function createTraeCliAdapter(
    config: Record<string, unknown> = {},
    overrides: Partial<TraeCliDeps> = {},
) {
    const deps: TraeCliDeps = { ...defaultDeps(), ...overrides };
    const resolveCli = () => resolveFirstCommand(resolveTraeCliCommandCandidates(config, deps), deps.probe);

    return {
        name: 'trae-cli',
        async isAvailable() {
            if (await resolveCli())
                return { available: true };
            return { available: false, reason: TRAE_CLI_NOT_FOUND };
        },
        async send(request: HandoffPromptRequest, context: TraeCliContext) {
            const events: AgentEmitEvent[] = [];
            const push = (type: string, text: string) => {
                const event = { type, text };
                events.push(event);
                context.emit(event);
            };
            push('started', 'Opening TRAE CLI');
            try {
                const command = await resolveCli();
                if (!command)
                    throw new Error(TRAE_CLI_NOT_FOUND);
                const cwd = resolveAgentProjectRoot(config, context);
                const handoff = createPromptHandoff(request, context, config, push);
                if (shouldWriteLauncherPromptFile(config, handoff.state.prompt))
                    handoff.toPointer();
                const { launchPath, promptPath } = writeLaunchFiles({
                    request,
                    context,
                    tag: 'trae',
                    prompt: handoff.state.prompt,
                    platform: deps.platform,
                    buildScript: (promptFile) => buildLauncherFile({
                        command,
                        cwd,
                        promptPath: promptFile,
                        args: traeCliLauncherArgs(cwd, config),
                    }, deps.platform),
                });
                push('file-change', `Wrote launcher ${launchPath}`);
                await deps.open(config, launchPath);
                push('completed', 'TRAE CLI opened and the prompt was submitted');
                return {
                    ok: true,
                    agent: 'trae-cli',
                    requestId: request.id,
                    events,
                    output: `Opened TRAE CLI in Terminal and submitted the prompt (${promptPath}).${handoff.note()}`,
                    writtenPromptPath: handoff.state.writtenPromptPath ?? promptPath,
                };
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                push('failed', error);
                return { ok: false, agent: 'trae-cli', requestId: request.id, events, error };
            }
        },
    };
}
