import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { resolveFirstCommand, writeLaunchFiles } from './launch-files.js';
import { quoteWindowsCmdArg } from './opener.js';
import { createAntigravitySessionBridge } from '../sessions/antigravity-sessions.js';
import { deliverAntigravityIdePrompt } from './antigravity-ide-bridge.js';
import {
    antigravityIdeMissingMessage,
    buildAntigravityIdeLauncherFile,
    collectAntigravityIdeContextFiles,
    resolveAntigravityIdeCommandCandidates,
    resolveAntigravityIdeProjectRoot,
    retainPathsInsideRoots,
} from './antigravity-ide-cli.js';

/** How long to wait for `antigravity-ide chat` to hand the prompt to the IDE and exit. */
const CLI_HANDOFF_TIMEOUT_MS = 45000;

/**
 * First IDE CLI candidate whose `--version` succeeds.
 *
 * @param {{ command?: unknown }} config Antigravity IDE adapter config.
 * @returns {Promise<string | null>} Command to embed in the launcher, or null.
 */
function resolveAntigravityIdeCommand(config: { command?: unknown }) {
    return resolveFirstCommand(resolveAntigravityIdeCommandCandidates(config));
}

/**
 * Run the launcher and wait until the IDE CLI exits.
 *
 * Boundary: success is exit 0, which means the CLI handed the chat off — not that the model finished. The process is
 * killed after {@link CLI_HANDOFF_TIMEOUT_MS} so a stuck CLI cannot hold the `/send` request. stderr is capped so a
 * noisy CLI cannot grow the error string without limit.
 *
 * @param {string} launchPath Absolute launcher path (bash script or `.cmd`).
 * @returns {Promise<void>} Resolves on exit 0.
 */
function runLauncher(launchPath: string) {
    const onWindows = process.platform === 'win32';
    // Quote the launcher path for cmd so a project path with spaces is one token. The prompt itself stays in the
    // prompt file; this argv is only the script path.
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
            finish(new Error('Antigravity IDE CLI timed out before handing off the chat'));
        }, CLI_HANDOFF_TIMEOUT_MS);
        child.once('error', (err) => {
            clearTimeout(timer);
            finish(err);
        });
        child.once('close', (code, signal) => {
            clearTimeout(timer);
            if (code === 0)
                finish(undefined);
            else
                finish(new Error(stderr.trim() || `Antigravity IDE CLI failed with ${signal ?? `exit code ${code ?? 'unknown'}`}`));
        });
    });
}

/**
 * Create the Antigravity IDE adapter.
 *
 * Boundary: registered only when `agents.antigravityIde` is `true` or an options object (`buildRegistry` does not
 * default it on). The CLI opens the project folder. A local bridge extension then places the prompt in the agent
 * input and does not submit it. `openCommand` / `openArgs` are ignored. Availability requires a working CLI binary.
 *
 * @param {Record<string, unknown>} config Antigravity IDE adapter options from plugin config.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter.
 */
export function createAntigravityIdeAdapter(config: any = {}) {
    const sessions = createAntigravitySessionBridge(config);
    return {
        name: 'antigravity-ide',
        sessionsEnabled: sessions.enabled,
        async isAvailable() {
            const command = await resolveAntigravityIdeCommand(config);
            if (!command)
                return { available: false, reason: antigravityIdeMissingMessage(config) };
            return { available: true };
        },
        /**
         * List IDE conversations when `experimentalSessions` is on. Otherwise the route never calls this.
         *
         * @param {{ projectRoot: string }} ctx Inspector project root.
         * @returns {Promise<{ sessions: Array<Record<string, unknown>>, delivery: string, notice?: string }>}
         */
        async listSessions(ctx: { projectRoot: string }) {
            return sessions.list(ctx.projectRoot);
        },
        async send(request: Parameters<typeof collectAntigravityIdeContextFiles>[0] & { id: string, createdAt: string | number | Date }, context: {
            emit: (event: { type: string, text?: string }) => void,
            prompt: string,
            outputDir: string,
            projectRoot: string,
            targetSession?: { id: string, cwd?: string, status?: string, route?: { languageServerPort?: number } } | null,
        }) {
            if (context.targetSession)
                // The guard proves `targetSession` is set. The assertion is erased; `send` still receives `context`.
                return sessions.send(request, context as Parameters<typeof sessions.send>[1]);
            const events = [{ type: 'started', text: 'Opening Antigravity IDE' }];
            context.emit(events[0]);
            try {
                const command = await resolveAntigravityIdeCommand(config);
                if (!command)
                    throw new Error(antigravityIdeMissingMessage(config));
                const prompt = context.prompt;
                const cwd = resolveAntigravityIdeProjectRoot(config, context);
                const files = config.addFiles === false
                    ? []
                    : retainPathsInsideRoots(collectAntigravityIdeContextFiles(request), [context.projectRoot, cwd]);
                // The launcher only opens the folder; the prompt file is the record of what went into the agent input.
                const { launchPath, promptPath } = writeLaunchFiles({
                    request,
                    context,
                    tag: 'agy-ide',
                    prompt,
                    buildScript: () => buildAntigravityIdeLauncherFile({
                        command,
                        cwd,
                        newWindow: config.newWindow === true,
                        reuseWindow: config.reuseWindow === true,
                    }),
                });
                const launchEvent = { type: 'file-change', text: `Wrote launcher ${launchPath}` };
                events.push(launchEvent);
                context.emit(launchEvent);
                await deliverAntigravityIdePrompt({
                    id: request.id,
                    workspacePath: cwd,
                    message: prompt,
                    files,
                    openWorkspace: () => runLauncher(launchPath),
                });
                const completed = { type: 'completed', text: 'Antigravity IDE opened with the prompt in the agent input' };
                events.push(completed);
                context.emit(completed);
                return {
                    ok: true,
                    agent: 'antigravity-ide',
                    requestId: request.id,
                    events,
                    output: `Opened Antigravity IDE with the generated prompt in the agent input (${promptPath}).`,
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
                    agent: 'antigravity-ide',
                    requestId: request.id,
                    events,
                    error,
                };
            }
        },
    };
}
