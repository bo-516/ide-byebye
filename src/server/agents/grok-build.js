import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertPathInsideRoot } from '../security.js';
import { renderRequestMarkdown } from './file.js';
import {
    buildGrokBuildFilePrompt,
    buildGrokBuildLauncherScript,
    buildGrokBuildPrompt,
    resolveGrokBuildCommandCandidates,
    resolveGrokBuildProjectRoot,
    shouldWriteGrokBuildPromptFile,
} from './grok-build-launcher.js';

export {
    buildGrokBuildFilePrompt,
    buildGrokBuildLauncherScript,
    buildGrokBuildPrompt,
    formatGrokBuildHandoffPath,
    resolveGrokBuildCommandCandidates,
    resolveGrokBuildPathStyleOptions,
    resolveGrokBuildProjectRoot,
    shellSingleQuote,
    shouldWriteGrokBuildPromptFile,
    withGrokBuildPathRoot,
} from './grok-build-launcher.js';

/**
 * Build a filesystem-safe timestamp fragment for Grok Build handoff files.
 *
 * Boundary: `date` must expose `toISOString()`. Passing a non-Date-like value throws before any handoff file is named.
 *
 * @param {Date} date Date used to stamp the prompt / launcher file name.
 * @returns {string} ISO-like timestamp with colon characters replaced.
 */
function fileStamp(date) {
    return date.toISOString().replace(/:/g, '-').replace(/\..+$/, '');
}

/**
 * Probe whether a command exits successfully for `--version`.
 *
 * Boundary: a missing binary (`ENOENT`) or non-zero exit marks that candidate unavailable; a hang is killed after the
 * timeout so `isAvailable` cannot stall the agents endpoint.
 *
 * @param {string} command Executable path or PATH name.
 * @param {number} [timeoutMs=5000] Kill timeout for the version probe.
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
 * Resolve the Grok Build CLI binary that should be embedded in the launcher.
 *
 * Boundary: returns the first candidate whose `--version` succeeds. Callers must treat `null` as unavailable — do not
 * fall back to spawning an unverified name after this helper fails.
 *
 * @param {Record<string, unknown>} config Grok Build adapter config.
 * @returns {Promise<string | null>} Absolute path or PATH name of a working `grok`, or null.
 */
export async function resolveGrokBuildCommand(config) {
    for (const candidate of resolveGrokBuildCommandCandidates(config)) {
        if (await probeCommandVersion(candidate))
            return candidate;
    }
    return null;
}

/**
 * Resolve the OS command used to open the generated launcher script.
 *
 * Boundary: custom `openCommand` wins; otherwise only macOS receives the native `open` (which runs `.command` files in
 * Terminal.app). Non-macOS callers must configure an opener explicitly.
 *
 * @param {Record<string, unknown>} config Grok Build adapter config.
 * @returns {string | null} Executable name/path, or null when unavailable.
 */
function resolveOpenCommand(config) {
    if (typeof config.openCommand === 'string' && config.openCommand.trim())
        return config.openCommand.trim();
    return process.platform === 'darwin' ? 'open' : null;
}

/**
 * Build process arguments for the launcher opener.
 *
 * Boundary: `openArgs` must be iterable. The launcher path is appended last so wrappers can prepend app-specific flags.
 *
 * @param {Record<string, unknown>} config Grok Build adapter config.
 * @param {string} launchPath Absolute path to the generated `.command` / script file.
 * @returns {string[]} Arguments passed to the opener process.
 */
function buildOpenArgs(config, launchPath) {
    return [...(config.openArgs ?? []), launchPath];
}

/**
 * Spawn the OS command that opens the Grok Build launcher.
 *
 * Boundary: this observes only opener startup and exit status; the Terminal session may still fail after a successful
 * `open` (missing login PATH, auth, etc.).
 *
 * @param {string} command Executable used to open the launcher.
 * @param {string[]} args Arguments for the opener command.
 * @returns {Promise<void>} Resolves after a zero exit status, rejects otherwise.
 */
function openLauncher(command, args) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const child = spawn(command, args, { stdio: 'ignore' });
        const finish = (err) => {
            if (settled)
                return;
            settled = true;
            err ? reject(err) : resolve();
        };
        child.once('error', (err) => finish(err));
        child.once('close', (code, signal) => {
            if (code === 0) {
                finish();
                return;
            }
            finish(new Error(`${command} failed with ${signal ?? `exit code ${code ?? 'unknown'}`}`));
        });
    });
}

/**
 * Write the full request markdown under the inspector output directory.
 *
 * Boundary: the target `requests` directory must stay inside the trusted project root. Outside paths throw before any
 * file is created.
 *
 * @param {Record<string, unknown>} request Normalized intent request.
 * @param {{ outputDir: string, projectRoot: string, prompt: string }} context Agent context used for storage and rendering.
 * @returns {string} Absolute path to the written prompt file.
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
 * Write the interactive prompt body and the executable launcher script.
 *
 * Boundary: both files stay under `outputDir/launches` inside the project root. The prompt file holds the exact text
 * passed to `grok --verbatim`; the launcher never embeds that text, only its path.
 *
 * @param {{ request: Record<string, unknown>, context: { outputDir: string, projectRoot: string }, command: string, cwd: string, prompt: string, permissionMode?: string }} input Write inputs.
 * @returns {{ launchPath: string, promptPath: string }} Absolute paths of the launcher and prompt files.
 */
function writeLauncherFiles(input) {
    const launchesDir = path.join(input.context.outputDir, 'launches');
    assertPathInsideRoot(launchesDir, input.context.projectRoot);
    fs.mkdirSync(launchesDir, { recursive: true });
    const stamp = `${fileStamp(new Date(input.request.createdAt))}-${input.request.id}`;
    const promptPath = path.join(launchesDir, `${stamp}.prompt.txt`);
    const launchPath = path.join(launchesDir, `${stamp}.command`);
    fs.writeFileSync(promptPath, input.prompt.endsWith('\n') ? input.prompt : `${input.prompt}\n`, 'utf8');
    fs.writeFileSync(
        launchPath,
        buildGrokBuildLauncherScript({
            command: input.command,
            cwd: input.cwd,
            promptPath,
            permissionMode: input.permissionMode,
        }),
        { encoding: 'utf8', mode: 0o755 },
    );
    return { launchPath, promptPath };
}

/**
 * Create the Grok Build CLI adapter.
 *
 * Boundary: this adapter opens a local Terminal session running interactive `grok` with the intent prompt prefilled; it
 * does not apply edits itself. Grok Build has no app deeplink, so handoff is via an executable `.command` launcher.
 * Availability requires a working `grok` binary plus macOS `open` (or a configured `openCommand`).
 *
 * @param {Record<string, unknown>} config Grok Build adapter options from plugin config.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter registered by the agent registry.
 */
export function createGrokBuildAdapter(config = {}) {
    return {
        name: 'grok-build',
        async isAvailable() {
            const command = await resolveGrokBuildCommand(config);
            if (!command) {
                return {
                    available: false,
                    reason: `"${resolveGrokBuildCommandCandidates(config)[0]}" not found. Install Grok Build (https://x.ai/cli) and ensure it is on PATH.`,
                };
            }
            if (!resolveOpenCommand(config)) {
                return {
                    available: false,
                    reason: 'Grok Build handoff requires macOS "open" or a configured grokBuild.openCommand.',
                };
            }
            return { available: true };
        },
        async send(request, context) {
            const events = [{ type: 'started', text: 'Opening Grok Build' }];
            context.emit(events[0]);
            try {
                const command = await resolveGrokBuildCommand(config);
                if (!command) {
                    throw new Error(
                        `"${resolveGrokBuildCommandCandidates(config)[0]}" not found. Install Grok Build (https://x.ai/cli) and ensure it is on PATH.`,
                    );
                }
                const openCommand = resolveOpenCommand(config);
                if (!openCommand) {
                    throw new Error('Grok Build handoff requires macOS "open" or a configured grokBuild.openCommand.');
                }

                // Rebuild with agent pathStyle (default relative); do not assume context.prompt matches Grok config.
                let prompt = buildGrokBuildPrompt(request, config);
                let writtenPromptPath;
                if (shouldWriteGrokBuildPromptFile(config, prompt)) {
                    // Persist the same path-style prompt so the handoff markdown matches what Grok sees.
                    writtenPromptPath = writePromptFile(request, { ...context, prompt });
                    prompt = buildGrokBuildFilePrompt(request, writtenPromptPath, config);
                    const event = { type: 'file-change', text: `Wrote ${writtenPromptPath}` };
                    events.push(event);
                    context.emit(event);
                }

                const cwd = resolveGrokBuildProjectRoot(config, context);
                const permissionMode = typeof config.permissionMode === 'string' && config.permissionMode.trim()
                    ? config.permissionMode.trim()
                    : undefined;
                const { launchPath, promptPath } = writeLauncherFiles({
                    request,
                    context,
                    command,
                    cwd,
                    prompt,
                    permissionMode,
                });
                const launchEvent = { type: 'file-change', text: `Wrote launcher ${launchPath}` };
                events.push(launchEvent);
                context.emit(launchEvent);

                await openLauncher(openCommand, buildOpenArgs(config, launchPath));
                const completed = { type: 'completed', text: 'Grok Build opened with a prefilled prompt' };
                events.push(completed);
                context.emit(completed);
                return {
                    ok: true,
                    agent: 'grok-build',
                    requestId: request.id,
                    events,
                    output: writtenPromptPath
                        ? `Opened Grok Build. Full request context was written to ${writtenPromptPath}.`
                        : `Opened Grok Build with the generated prompt prefilled (${promptPath}).`,
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
                    agent: 'grok-build',
                    requestId: request.id,
                    events,
                    error,
                };
            }
        },
    };
}
