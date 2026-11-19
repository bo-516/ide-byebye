import os from 'node:os';
import type { ImageDelivery } from '../../shared/constants.js';
import { probeCommandVersion, resolveFirstCommand, writeLaunchFiles } from './launch-files.js';
import { resolveAgentProjectRoot, shouldWriteLauncherPromptFile } from './launch-prompt.js';
import { buildLauncherFile } from './launch-script.js';
import { openTarget } from './opener.js';
import { createPromptHandoff, type HandoffPromptRequest } from './prompt-handoff.js';
import {
    collectQoderCliAttachments,
    QODER_CLI_NOT_FOUND,
    qoderCliLauncherArgs,
    resolveQoderCliCommandCandidates,
} from './qoder-route.js';
import type { AgentEmitEvent } from './types.js';

/** Side effects of the Qoder CLI adapter; replaceable in tests so nothing is spawned or opened. */
export interface QoderCliDeps {
    platform: string;
    homedir: string;
    env: NodeJS.ProcessEnv;
    probe: (command: string) => Promise<boolean>;
    open: (config: Record<string, unknown>, target: string) => Promise<void>;
}

/** Route context read by {@link createQoderCliAdapter}. */
interface QoderCliContext {
    emit: (event: AgentEmitEvent) => void;
    outputDir: string;
    projectRoot: string;
    prompt: string;
}

/**
 * Production side effects for {@link createQoderCliAdapter}.
 *
 * @returns {QoderCliDeps} Default host dependencies.
 */
function defaultDeps(): QoderCliDeps {
    return {
        platform: process.platform,
        homedir: os.homedir(),
        env: process.env,
        probe: (command) => probeCommandVersion(command),
        open: (config, target) => openTarget(config, target),
    };
}

/**
 * Create the Qoder CLI adapter (`qoder-cli`).
 *
 * Boundary: probes `qodercli` (not bare `qoder`, so Qoder IDE's window launcher cannot masquerade as the CLI) and opens
 * a Terminal launcher running `qodercli --prompt-interactive=…`. `imageInput` is `'attachment'` unless
 * `attachImages: false` because screenshots and pasted images are also passed via `--attachment`.
 *
 * @param {Record<string, unknown>} [config] `agents.qoderCli` options.
 * @param {Partial<QoderCliDeps>} [overrides] Test seam overrides.
 * @returns {{ name: string, imageInput: ImageDelivery, isAvailable: Function, send: Function }} Agent adapter.
 */
export function createQoderCliAdapter(
    config: Record<string, unknown> = {},
    overrides: Partial<QoderCliDeps> = {},
) {
    const deps: QoderCliDeps = { ...defaultDeps(), ...overrides };
    const imageInput: ImageDelivery = config.attachImages === false ? 'path' : 'attachment';
    const resolveCli = () => resolveFirstCommand(resolveQoderCliCommandCandidates(config, deps), deps.probe);

    return {
        name: 'qoder-cli',
        imageInput,
        async isAvailable() {
            if (await resolveCli())
                return { available: true };
            return { available: false, reason: QODER_CLI_NOT_FOUND };
        },
        async send(request: HandoffPromptRequest, context: QoderCliContext) {
            const events: AgentEmitEvent[] = [];
            const push = (type: string, text: string) => {
                const event = { type, text };
                events.push(event);
                context.emit(event);
            };
            push('started', 'Opening Qoder CLI');
            try {
                const command = await resolveCli();
                if (!command)
                    throw new Error(QODER_CLI_NOT_FOUND);
                const cwd = resolveAgentProjectRoot(config, context);
                const handoff = createPromptHandoff(request, context, config, push);
                if (shouldWriteLauncherPromptFile(config, handoff.state.prompt))
                    handoff.toPointer();
                const attachments = config.attachImages === false
                    ? []
                    : collectQoderCliAttachments(request, [context.projectRoot, context.outputDir, cwd]);
                const { launchPath, promptPath } = writeLaunchFiles({
                    request,
                    context,
                    tag: 'qoder',
                    prompt: handoff.state.prompt,
                    platform: deps.platform,
                    buildScript: (promptFile) => buildLauncherFile({
                        command,
                        cwd,
                        promptPath: promptFile,
                        args: qoderCliLauncherArgs({
                            permissionMode: config.permissionMode,
                            model: config.model,
                            attachments,
                        }),
                    }, deps.platform),
                });
                push('file-change', `Wrote launcher ${launchPath}`);
                await deps.open(config, launchPath);
                push('completed', 'Qoder CLI opened and the prompt was submitted');
                return {
                    ok: true,
                    agent: 'qoder-cli',
                    requestId: request.id,
                    events,
                    output: `Opened Qoder CLI in Terminal and submitted the prompt (${promptPath}).${handoff.note()}`,
                    writtenPromptPath: handoff.state.writtenPromptPath ?? promptPath,
                };
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                push('failed', error);
                return { ok: false, agent: 'qoder-cli', requestId: request.id, events, error };
            }
        },
    };
}
