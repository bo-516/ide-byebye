import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertPathInsideRoot } from '../security.js';
import { renderRequestMarkdown } from './file.js';
import { openTarget } from './opener.js';
import { resolveAntigravityApp } from './antigravity-app.js';
import { injectAntigravityComposer } from './antigravity-devtools.js';
import {
    antigravityLauncherExtension,
    antigravityMissingMessage,
    buildAntigravityFilePrompt,
    buildAntigravityLauncherFile,
    buildAntigravityPrompt,
    resolveAntigravityCommandCandidates,
    resolveAntigravityProjectRoot,
    shouldWriteAntigravityPromptFile,
} from './antigravity-launcher.js';

/**
 * Build a filesystem-safe timestamp fragment for Antigravity handoff files.
 *
 * Boundary: `date` must expose `toISOString()`. A non-Date-like value throws before any file is named.
 *
 * @param {Date} date Date used to stamp the file name.
 * @returns {string} ISO-like timestamp with colon characters replaced.
 */
function fileStamp(date) {
    return date.toISOString().replace(/:/g, '-').replace(/\..+$/, '');
}

/**
 * Probe whether a command exits 0 for `--version`.
 *
 * Boundary: a missing binary or non-zero exit is unavailable. A hang is killed after `timeoutMs` so `isAvailable`
 * cannot stall the agents endpoint.
 *
 * @param {string} command Executable path or PATH name.
 * @param {number} [timeoutMs=5000] Kill timeout.
 * @returns {Promise<boolean>} True when `--version` exits 0.
 */
function probeCommandVersion(command, timeoutMs = 5000) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (ok) => {
            if (settled)
                return;
            settled = true;
            resolve(ok);
        };
        let child;
        try {
            child = spawn(command, ['--version'], { stdio: 'ignore' });
        }
        catch {
            finish(false);
            return;
        }
        const timer = setTimeout(() => {
            child.kill();
            finish(false);
        }, timeoutMs);
        child.once('error', () => {
            clearTimeout(timer);
            finish(false);
        });
        child.once('close', (code) => {
            clearTimeout(timer);
            finish(code === 0);
        });
    });
}

/**
 * First `agy` candidate whose `--version` succeeds.
 *
 * @param {Record<string, unknown>} config Antigravity adapter config.
 * @returns {Promise<string | null>} Command to embed in the launcher, or null.
 */
async function resolveAntigravityCommand(config) {
    for (const candidate of resolveAntigravityCommandCandidates(config)) {
        if (await probeCommandVersion(candidate))
            return candidate;
    }
    return null;
}

/**
 * Write the full request markdown under `outputDir/requests`.
 *
 * Boundary: the directory must stay inside the trusted project root. Outside paths throw before any file is created.
 *
 * @param {Record<string, unknown>} request Normalized intent request.
 * @param {{ outputDir: string, projectRoot: string, prompt: string }} context Storage and the prompt to render.
 * @returns {string} Absolute path of the written markdown file.
 */
function writePromptFile(request, context) {
    const requestsDir = path.join(context.outputDir, 'requests');
    assertPathInsideRoot(requestsDir, context.projectRoot);
    fs.mkdirSync(requestsDir, { recursive: true });
    const target = path.join(requestsDir, `${fileStamp(new Date(request.createdAt))}-${request.id}.md`);
    fs.writeFileSync(target, renderRequestMarkdown(request, context.prompt), 'utf8');
    return target;
}

/**
 * Write the interactive prompt body and the launcher script.
 *
 * Boundary: both files stay under `outputDir/launches` inside the project root. The prompt file is what
 * `agy --prompt-interactive` reads; the launcher never embeds that text.
 *
 * @param {{ request: Record<string, unknown>, context: { outputDir: string, projectRoot: string }, command: string, cwd: string, prompt: string, mode?: string }} input Write inputs.
 * @returns {{ launchPath: string, promptPath: string }} Absolute paths.
 */
function writeLauncherFiles(input) {
    const launchesDir = path.join(input.context.outputDir, 'launches');
    assertPathInsideRoot(launchesDir, input.context.projectRoot);
    fs.mkdirSync(launchesDir, { recursive: true });
    const stamp = `${fileStamp(new Date(input.request.createdAt))}-${input.request.id}`;
    const promptPath = path.join(launchesDir, `${stamp}.agy.prompt.txt`);
    const launchPath = path.join(launchesDir, `${stamp}.agy${antigravityLauncherExtension()}`);
    fs.writeFileSync(promptPath, input.prompt.endsWith('\n') ? input.prompt : `${input.prompt}\n`, 'utf8');
    fs.writeFileSync(launchPath, buildAntigravityLauncherFile({
        command: input.command,
        cwd: input.cwd,
        promptPath,
        mode: input.mode,
    }), { encoding: 'utf8', mode: 0o755 });
    return { launchPath, promptPath };
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
function launchAntigravityApp(appPath) {
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
        async send(request, context) {
            const events = [{ type: 'started', text: 'Opening Antigravity' }];
            context.emit(events[0]);
            try {
                const appPath = resolveAntigravityApp();
                let prompt = buildAntigravityPrompt(request, config);
                let writtenPromptPath;
                if (shouldWriteAntigravityPromptFile(config, prompt)) {
                    writtenPromptPath = writePromptFile(request, { ...context, prompt });
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
                const { launchPath, promptPath } = writeLauncherFiles({
                    request,
                    context,
                    command,
                    cwd,
                    prompt,
                    mode,
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
