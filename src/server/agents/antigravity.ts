import { spawn } from 'node:child_process';
import { resolveFirstCommand, writeHandoffPromptFile, writeLaunchFiles } from './launch-files.js';
import { openTarget } from './opener.js';
import { resolveAntigravityApp } from './antigravity-app.js';
import { injectAntigravityComposer } from './antigravity-devtools.js';
import {
    antigravityMissingMessage,
    buildAntigravityFilePrompt,
    buildAntigravityLauncherFile,
    buildAntigravityPrompt,
    resolveAntigravityCommandCandidates,
    resolveAntigravityProjectRoot,
    shouldWriteAntigravityPromptFile,
} from './antigravity-launcher.js';

/**
 * First `agy` candidate whose `--version` succeeds.
 *
 * @param {{ command?: unknown }} config Antigravity adapter config.
 * @returns {Promise<string | null>} Command to embed in the launcher, or null.
 */
function resolveAntigravityCommand(config: { command?: unknown }) {
    return resolveFirstCommand(resolveAntigravityCommandCandidates(config));
}

/**
 * Focus the installed Antigravity desktop app without starting a second copy.
 *
 * Boundary: macOS uses `open -a`, which returns when LaunchServices has accepted the request. Other platforms spawn
 * the executable detached so this function does not wait for the user to quit the app. A missing binary rejects.
 *
 * @param {string} appPath App bundle or executable from {@link resolveAntigravityApp}.
 * @returns {Promise<void>} Resolves once the OS has been asked to open the app.
 */
function launchAntigravityApp(appPath: string) {
    return new Promise((resolve, reject) => {
        if (process.platform === 'darwin') {
            const child = spawn('open', ['-a', appPath], { stdio: 'ignore' });
            child.once('error', reject);
            child.once('close', (code) => {
                if (code === 0)
                    resolve(undefined);
                else
                    reject(new Error(`Could not open Antigravity (exit ${code ?? 'unknown'})`));
            });
            return;
        }
        const child = spawn(appPath, [], { stdio: 'ignore', detached: true });
        child.once('error', reject);
        child.once('spawn', () => {
            child.unref();
            resolve(undefined);
        });
    });
}

/**
 * Create the Antigravity adapter.
 *
 * Boundary: registered only when `agents.antigravity` is `true` or an options object. The desktop app is preferred:
 * the prompt is written into its composer (`?q=` on the app's own loopback window). The `agy` CLI is only used when
 * that app is not installed. Availability is the installed app, not a running window, so the button stays enabled
 * when Antigravity is installed but closed.
 *
 * @param {Record<string, unknown>} config Antigravity adapter options from plugin config.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter.
 */
export function createAntigravityAdapter(config: any = {}) {
    return {
        name: 'antigravity',
        async isAvailable() {
            if (resolveAntigravityApp())
                return { available: true };
            const command = await resolveAntigravityCommand(config);
            if (!command)
                return {
                    available: false,
                    reason: 'Antigravity is not installed. Install the Antigravity desktop app, or the agy CLI and put it on PATH.',
                };
            return { available: true };
        },
        async send(request: Parameters<typeof buildAntigravityPrompt>[0] & { id: string, createdAt: string | number | Date }, context: {
            emit: (event: { type: string, text?: string }) => void,
            prompt: string,
            outputDir: string,
            projectRoot: string,
        }) {
            const events = [{ type: 'started', text: 'Opening Antigravity' }];
            context.emit(events[0]);
            try {
                const appPath = resolveAntigravityApp();
                let prompt = buildAntigravityPrompt(request, config);
                let writtenPromptPath: string | undefined;
                if (shouldWriteAntigravityPromptFile(config, prompt)) {
                    writtenPromptPath = writeHandoffPromptFile(request, { ...context, prompt });
                    prompt = buildAntigravityFilePrompt(request, writtenPromptPath, config);
                    const event = { type: 'file-change', text: `Wrote ${writtenPromptPath}` };
                    events.push(event);
                    context.emit(event);
                }
                const cwd = resolveAntigravityProjectRoot(config, context);
                if (appPath) {
                    await launchAntigravityApp(appPath);
                    const injected = await injectAntigravityComposer({ prompt, workspaceDir: cwd });
                    if (!injected)
                        throw new Error('Antigravity opened, but its window was not ready for the prompt');
                    const completed = { type: 'completed', text: 'Antigravity opened with the prompt in the composer' };
                    events.push(completed);
                    context.emit(completed);
                    return {
                        ok: true,
                        agent: 'antigravity',
                        requestId: request.id,
                        events,
                        output: writtenPromptPath
                            ? `Opened Antigravity with the prompt in the composer. Full request context was written to ${writtenPromptPath}.`
                            : 'Opened Antigravity with the prompt in the composer.',
                        writtenPromptPath,
                    };
                }
                const command = await resolveAntigravityCommand(config);
                if (!command)
                    throw new Error(antigravityMissingMessage(config));
                const mode = typeof config.mode === 'string' && config.mode.trim() ? config.mode.trim() : undefined;
                const { launchPath, promptPath } = writeLaunchFiles({
                    request,
                    context,
                    tag: 'agy',
                    prompt,
                    buildScript: (promptFile) => buildAntigravityLauncherFile({ command, cwd, promptPath: promptFile, mode }),
                });
                const launchEvent = { type: 'file-change', text: `Wrote launcher ${launchPath}` };
                events.push(launchEvent);
                context.emit(launchEvent);
                await openTarget(config, launchPath);
                const completed = { type: 'completed', text: 'Antigravity opened with a prefilled prompt' };
                events.push(completed);
                context.emit(completed);
                return {
                    ok: true,
                    agent: 'antigravity',
                    requestId: request.id,
                    events,
                    output: writtenPromptPath
                        ? `Opened Antigravity. Full request context was written to ${writtenPromptPath}.`
                        : `Opened Antigravity with the generated prompt prefilled (${promptPath}).`,
                    writtenPromptPath: writtenPromptPath ?? promptPath,
                };
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                const failed = { type: 'failed', text: error };
                events.push(failed);
                context.emit(failed);
                return {
                    ok: false,
                    agent: 'antigravity',
                    requestId: request.id,
                    events,
                    error,
                };
            }
        },
    };
}
