import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { resolveFirstCommand, writeLaunchFiles } from './launch-files.js';
import { quoteWindowsCmdArg } from './opener.js';
import { deliverCascadeIdePrompt } from './cascade-ide-bridge.js';
import { buildInsertMessageArgument, buildSubmitMessageArgument } from './cascade-ide-proto.js';
import {
    buildCascadeIdeLauncherFile,
    cascadeIdeMissingMessage,
    resolveCascadeIdeCommandCandidates,
    resolveCascadeIdeProjectRoot,
} from './cascade-ide-cli.js';
import type { CascadeIdeSpec } from './cascade-ide-spec.js';

/** How long to wait for the IDE CLI to hand the folder off and exit. */
const CLI_OPEN_TIMEOUT_MS = 45000;

/**
 * First IDE CLI candidate whose `--version` succeeds.
 *
 * @param {CascadeIdeSpec} spec Product spec.
 * @param {{ command?: unknown }} config IDE adapter config.
 * @returns {Promise<string | null>} Command to embed in the launcher, or null.
 */
function resolveCascadeIdeCommand(spec: CascadeIdeSpec, config: { command?: unknown }) {
    return resolveFirstCommand(resolveCascadeIdeCommandCandidates(spec, config));
}

/**
 * Run the launcher and wait until the IDE CLI exits.
 *
 * Boundary: success is exit 0, which means the CLI opened (or focused) the folder — not that the bridge
 * delivered the prompt; the ack wait happens in {@link deliverCascadeIdePrompt}. The process is killed
 * after {@link CLI_OPEN_TIMEOUT_MS} so a stuck CLI cannot hold the `/send` request. stderr is capped so
 * a noisy CLI cannot grow the error string without limit.
 *
 * @param {CascadeIdeSpec} spec Product spec (display name for the timeout error).
 * @param {string} launchPath Absolute launcher path (bash script or `.cmd`).
 * @returns {Promise<void>} Resolves on exit 0.
 */
function runLauncher(spec: CascadeIdeSpec, launchPath: string) {
    const onWindows = process.platform === 'win32';
    // Quote the launcher path for cmd so a project path with spaces is one token.
    const command = onWindows ? 'cmd.exe' : 'bash';
    const args = onWindows ? ['/d', '/s', '/c', quoteWindowsCmdArg(launchPath)] : [launchPath];
    return new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (err?: unknown) => {
            if (settled)
                return;
            settled = true;
            if (err)
                reject(err);
            else
                resolve(undefined);
        };
        let stderr = '';
        let child: ChildProcess;
        try {
            child = spawn(command, args, {
                stdio: ['ignore', 'ignore', 'pipe'],
                windowsHide: true,
                windowsVerbatimArguments: onWindows,
            });
        }
        catch (err) {
            finish(err);
            return;
        }
        child.stderr?.on('data', (chunk) => {
            stderr = (stderr + chunk.toString()).slice(-4000);
        });
        const timer = setTimeout(() => {
            child.kill();
            finish(new Error(`${spec.displayName} CLI timed out before opening the folder`));
        }, CLI_OPEN_TIMEOUT_MS);
        child.once('error', (err) => {
            clearTimeout(timer);
            finish(err);
        });
        child.once('close', (code, signal) => {
            clearTimeout(timer);
            if (code === 0)
                finish(undefined);
            else
                finish(new Error(stderr.trim() || `${spec.displayName} CLI failed with ${signal ?? `exit code ${code ?? 'unknown'}`}`));
        });
    });
}

/**
 * Request shape the adapter's `send` reads — the normalized intent request plus handoff ids.
 *
 * Boundary: `context.prompt` is the already-rendered prompt; the bridge sends it verbatim inside a
 * `SendActionToChatPanelRequest` argument built here, so the extension never sees raw request fields.
 */
type CascadeIdeRequest = Record<string, unknown> & { id: string, createdAt: string | number | Date };

/**
 * Create a Cascade-family IDE adapter (Devin Desktop, Windsurf) from a product spec.
 *
 * Boundary: registered only when its `agents.<key>` entry is `true` or an options object (`buildRegistry`
 * does not default it on). The CLI opens the project folder; a local bridge extension then executes
 * `<prefix>.sendChatActionMessage` — `addCascadeInput` places the prompt in the composer without
 * submitting (default), `sendCascadeInputNewConversation` submits a new conversation when
 * `config.submit` is true. `openCommand` / `openArgs` are ignored. Availability requires a working CLI.
 *
 * @param {CascadeIdeSpec} spec Product spec.
 * @param {Record<string, unknown>} config IDE adapter options from plugin config.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter.
 */
export function createCascadeIdeAdapter(spec: CascadeIdeSpec, config: Record<string, unknown> = {}) {
    return {
        name: spec.adapterId,
        sessionsEnabled: false,
        async isAvailable() {
            const command = await resolveCascadeIdeCommand(spec, config);
            if (!command)
                return { available: false, reason: cascadeIdeMissingMessage(spec, config) };
            return { available: true };
        },
        async send(request: CascadeIdeRequest, context: {
            emit: (event: { type: string, text?: string }) => void,
            prompt: string,
            outputDir: string,
            projectRoot: string,
            targetSession?: { id: string } | null,
        }) {
            const events = [{ type: 'started', text: `Opening ${spec.displayName}` }];
            context.emit(events[0]);
            try {
                if (context.targetSession)
                    throw new Error(`${spec.displayName} does not support sending to an existing session`);
                const command = await resolveCascadeIdeCommand(spec, config);
                if (!command)
                    throw new Error(cascadeIdeMissingMessage(spec, config));
                const prompt = context.prompt;
                const cwd = resolveCascadeIdeProjectRoot(config, context);
                const submit = config.submit === true;
                // The launcher only opens the folder; the prompt file is the record of what went into the
                // chat input. The encoded argument travels through the bridge request, not the shell.
                const { launchPath, promptPath } = writeLaunchFiles({
                    request,
                    context,
                    tag: spec.launchTag,
                    prompt,
                    buildScript: () => buildCascadeIdeLauncherFile({
                        command,
                        cwd,
                        newWindow: config.newWindow === true,
                        reuseWindow: config.reuseWindow === true,
                    }),
                });
                const launchEvent = { type: 'file-change', text: `Wrote launcher ${launchPath}` };
                events.push(launchEvent);
                context.emit(launchEvent);
                await deliverCascadeIdePrompt(spec, {
                    id: request.id,
                    workspacePath: cwd,
                    argument: submit ? buildSubmitMessageArgument(prompt) : buildInsertMessageArgument(prompt),
                    openWorkspace: () => runLauncher(spec, launchPath),
                });
                const completed = {
                    type: 'completed',
                    text: submit
                        ? `${spec.displayName} opened and submitted the prompt to a new conversation`
                        : `${spec.displayName} opened with the prompt in the chat input`,
                };
                events.push(completed);
                context.emit(completed);
                return {
                    ok: true,
                    agent: spec.adapterId,
                    requestId: request.id,
                    events,
                    output: `Opened ${spec.displayName} with the generated prompt${submit ? ' submitted to a new conversation' : ' in the chat input'} (${promptPath}).`,
                    writtenPromptPath: promptPath,
                };
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                const failed = { type: 'failed', text: error };
                events.push(failed);
                context.emit(failed);
                return {
                    ok: false,
                    agent: spec.adapterId,
                    requestId: request.id,
                    events,
                    error,
                };
            }
        },
    };
}
