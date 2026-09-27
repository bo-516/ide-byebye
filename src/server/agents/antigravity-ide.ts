import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertPathInsideRoot } from '../security.js';
import { renderRequestMarkdown } from './file.js';
import { quoteWindowsCmdArg } from './opener.js';
import {
    antigravityIdeLauncherExtension,
    antigravityIdeMissingMessage,
    buildAntigravityIdeFilePrompt,
    buildAntigravityIdeLauncherFile,
    collectAntigravityIdeContextFiles,
    resolveAntigravityIdeCommandCandidates,
    resolveAntigravityIdeProjectRoot,
    retainPathsInsideRoots,
    shouldWriteAntigravityIdePromptFile,
} from './antigravity-ide-cli.js';

/** How long to wait for `antigravity-ide chat` to hand the prompt to the IDE and exit. */
const CLI_HANDOFF_TIMEOUT_MS = 45000;

/**
 * Build a filesystem-safe timestamp fragment for IDE handoff files.
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
 * Boundary: `ENOENT` and non-zero exits are unavailable. A hang is killed after `timeoutMs` so the agents endpoint
 * cannot stall. This does not start a chat session.
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
 * First IDE CLI candidate whose `--version` succeeds.
 *
 * @param {Record<string, unknown>} config Antigravity IDE adapter config.
 * @returns {Promise<string | null>} Command to embed in the launcher, or null.
 */
async function resolveAntigravityIdeCommand(config) {
    for (const candidate of resolveAntigravityIdeCommandCandidates(config)) {
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
 * Write the prompt body and the launcher that feeds it to `antigravity-ide chat`.
 *
 * Boundary: both files stay under `outputDir/launches` inside the project root. The launcher never contains the prompt
 * text. Windows writes `.cmd`; other platforms write `.command`.
 *
 * @param {{ request: Record<string, unknown>, context: { outputDir: string, projectRoot: string }, launcher: Record<string, unknown> }} input Write inputs. `launcher` is the script field bag plus `prompt`.
 * @returns {{ launchPath: string, promptPath: string }} Absolute paths.
 */
function writeLauncherFiles(input) {
    const launchesDir = path.join(input.context.outputDir, 'launches');
    assertPathInsideRoot(launchesDir, input.context.projectRoot);
    fs.mkdirSync(launchesDir, { recursive: true });
    const stamp = `${fileStamp(new Date(input.request.createdAt))}-${input.request.id}`;
    const promptPath = path.join(launchesDir, `${stamp}.agy-ide.prompt.txt`);
    const launchPath = path.join(launchesDir, `${stamp}.agy-ide${antigravityIdeLauncherExtension()}`);
    const prompt = String(input.launcher.prompt ?? '');
    fs.writeFileSync(promptPath, prompt.endsWith('\n') ? prompt : `${prompt}\n`, 'utf8');
    fs.writeFileSync(launchPath, buildAntigravityIdeLauncherFile({ ...input.launcher, promptPath }), {
        encoding: 'utf8',
        mode: 0o755,
    });
    return { launchPath, promptPath };
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
function runLauncher(launchPath) {
    const onWindows = process.platform === 'win32';
    // Quote the launcher path for cmd so a project path with spaces is one token. The prompt itself stays in the
    // prompt file; this argv is only the script path.
    const command = onWindows ? 'cmd.exe' : 'bash';
    const args = onWindows ? ['/d', '/s', '/c', quoteWindowsCmdArg(launchPath)] : [launchPath];
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (err) => {
            if (settled)
                return;
            settled = true;
            if (err)
                reject(err);
            else
                resolve(undefined);
        };
        let stderr = '';
        let child;
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
 * default it on). The adapter opens the IDE's chat via `antigravity-ide chat` and does not apply edits itself.
 * `openCommand` / `openArgs` are ignored — the CLI starts the app. Availability requires a working CLI binary.
 *
 * @param {Record<string, unknown>} config Antigravity IDE adapter options from plugin config.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter.
 */
export function createAntigravityIdeAdapter(config: any = {}) {
    return {
        name: 'antigravity-ide',
        async isAvailable() {
            const command = await resolveAntigravityIdeCommand(config);
            if (!command)
                return { available: false, reason: antigravityIdeMissingMessage(config) };
            return { available: true };
        },
        async send(request, context) {
            const events = [{ type: 'started', text: 'Opening Antigravity IDE' }];
            context.emit(events[0]);
            try {
                const command = await resolveAntigravityIdeCommand(config);
                if (!command)
                    throw new Error(antigravityIdeMissingMessage(config));
                let prompt = context.prompt;
                let writtenPromptPath;
                if (shouldWriteAntigravityIdePromptFile(config, prompt)) {
                    writtenPromptPath = writePromptFile(request, context);
                    prompt = buildAntigravityIdeFilePrompt(request, writtenPromptPath);
                    const event = { type: 'file-change', text: `Wrote ${writtenPromptPath}` };
                    events.push(event);
                    context.emit(event);
                }
                const cwd = resolveAntigravityIdeProjectRoot(config, context);
                const files = config.addFiles === false
                    ? []
                    : retainPathsInsideRoots(collectAntigravityIdeContextFiles(request), [context.projectRoot, cwd]);
                if (writtenPromptPath && config.addFiles !== false)
                    files.push(writtenPromptPath);
                const { launchPath, promptPath } = writeLauncherFiles({
                    request,
                    context,
                    launcher: {
                        command,
                        cwd,
                        prompt,
                        mode: config.mode,
                        newWindow: config.newWindow === true,
                        reuseWindow: config.reuseWindow === true,
                        maximize: config.maximize === true,
                        profile: config.profile,
                        files,
                    },
                });
                const launchEvent = { type: 'file-change', text: `Wrote launcher ${launchPath}` };
                events.push(launchEvent);
                context.emit(launchEvent);
                await runLauncher(launchPath);
                const completed = { type: 'completed', text: 'Antigravity IDE opened with a prefilled chat' };
                events.push(completed);
                context.emit(completed);
                return {
                    ok: true,
                    agent: 'antigravity-ide',
                    requestId: request.id,
                    events,
                    output: writtenPromptPath
                        ? `Opened Antigravity IDE. Full request context was written to ${writtenPromptPath}.`
                        : `Opened Antigravity IDE with the generated prompt prefilled (${promptPath}).`,
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
                    agent: 'antigravity-ide',
                    requestId: request.id,
                    events,
                    error,
                };
            }
        },
    };
}
