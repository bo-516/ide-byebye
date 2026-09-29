import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { assertPathInsideRoot } from '../security.js';
import { renderRequestMarkdown } from './file.js';
import {
    buildGrokBuildFilePrompt,
    buildGrokBuildLauncherFile,
    buildGrokBuildPrompt,
    grokBuildLauncherExtension,
    resolveGrokBuildCommandCandidates,
    resolveGrokBuildProjectRoot,
    shouldWriteGrokBuildPromptFile,
} from './grok-build-launcher.js';
import { openTarget } from './opener.js';
import { readSessionPicker } from '../sessions/options.js';
import { isGrokSessionLive, listGrokSessions, resolveGrokHome } from '../sessions/grok-sessions.js';
import { sessionErrorText } from '../sessions/types.js';

export {
    buildGrokBuildFilePrompt,
    buildGrokBuildLauncherFile,
    buildGrokBuildLauncherScript,
    buildGrokBuildPrompt,
    formatGrokBuildHandoffPath,
    grokBuildLauncherExtension,
    powershellSingleQuote,
    resolveGrokBuildCommandCandidates,
    resolveGrokBuildPathStyleOptions,
    resolveGrokBuildProjectRoot,
    shellSingleQuote,
    shouldWriteGrokBuildPromptFile,
    withGrokBuildPathRoot,
    buildGrokBuildWindowsLauncherScript,
} from './grok-build-launcher.js';

/**
 * Build a filesystem-safe timestamp fragment for Grok Build handoff files.
 *
 * Boundary: `date` must expose `toISOString()`. Passing a non-Date-like value throws before any handoff file is named.
 *
 * @param {Date} date Date used to stamp the prompt / launcher file name.
 * @returns {string} ISO-like timestamp with colon characters replaced.
 */
function fileStamp(date: Date) {
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
function probeCommandVersion(command: string, timeoutMs = 5000) {
    return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (ok: boolean) => {
            if (settled)
                return;
            settled = true;
            resolve(ok);
        };
        let child: ChildProcess;
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
 * @param {{ command?: unknown }} config Grok Build adapter config.
 * @returns {Promise<string | null>} Absolute path or PATH name of a working `grok`, or null.
 */
export async function resolveGrokBuildCommand(config: { command?: unknown }) {
    for (const candidate of resolveGrokBuildCommandCandidates(config)) {
        if (await probeCommandVersion(candidate))
            return candidate;
    }
    return null;
}

/**
 * Write the full request markdown under the inspector output directory.
 *
 * Boundary: the target `requests` directory must stay inside the trusted project root. Outside paths throw before any
 * file is created.
 *
 * @param {{ id: string, createdAt: string | number | Date }} request Normalized intent request. Callers may omit the markdown fields; the assertion at the renderer is erased.
 * @param {{ outputDir: string, projectRoot: string, prompt: string }} context Agent context used for storage and rendering.
 * @returns {string} Absolute path to the written prompt file.
 */
function writePromptFile(request: { id: string, createdAt: string | number | Date }, context: { outputDir: string, projectRoot: string, prompt: string }) {
    const requestsDir = path.join(context.outputDir, 'requests');
    assertPathInsideRoot(requestsDir, context.projectRoot);
    fs.mkdirSync(requestsDir, { recursive: true });
    const target = path.join(requestsDir, `${fileStamp(new Date(request.createdAt))}-${request.id}.md`);
    fs.writeFileSync(target, renderRequestMarkdown(request as Parameters<typeof renderRequestMarkdown>[0], context.prompt), 'utf8');
    return target;
}

/**
 * Write the interactive prompt body and the executable launcher script.
 *
 * Boundary: both files stay under `outputDir/launches` inside the project root. The prompt file holds the exact text
 * passed to `grok --verbatim`; the launcher never embeds that text, only its path. Windows writes a `.cmd` wrapper;
 * other platforms write a bash `.command` file.
 *
 * @param {{ request: { id: string, createdAt: string | number | Date }, context: { outputDir: string, projectRoot: string }, command: string, cwd: string, prompt: string, permissionMode?: string, resumeSessionId?: string }} input Write inputs.
 *        `resumeSessionId` is set only after the live recheck. A bad id throws inside the script builder before the launcher file is written.
 * @returns {{ launchPath: string, promptPath: string }} Absolute paths of the launcher and prompt files.
 */
function writeLauncherFiles(input: {
    request: { id: string, createdAt: string | number | Date },
    context: { outputDir: string, projectRoot: string },
    command: string,
    cwd: string,
    prompt: string,
    permissionMode?: string,
    resumeSessionId?: string,
}) {
    const launchesDir = path.join(input.context.outputDir, 'launches');
    assertPathInsideRoot(launchesDir, input.context.projectRoot);
    fs.mkdirSync(launchesDir, { recursive: true });
    const stamp = `${fileStamp(new Date(input.request.createdAt))}-${input.request.id}`;
    const promptPath = path.join(launchesDir, `${stamp}.prompt.txt`);
    const launchPath = path.join(launchesDir, `${stamp}${grokBuildLauncherExtension()}`);
    const script = buildGrokBuildLauncherFile({
        command: input.command,
        cwd: input.cwd,
        promptPath,
        permissionMode: input.permissionMode,
        resumeSessionId: input.resumeSessionId,
    });
    fs.writeFileSync(promptPath, input.prompt.endsWith('\n') ? input.prompt : `${input.prompt}\n`, 'utf8');
    fs.writeFileSync(launchPath, script, { encoding: 'utf8', mode: 0o755 });
    return { launchPath, promptPath };
}

/**
 * Create the Grok Build CLI adapter.
 *
 * Boundary: this adapter opens a local Terminal session running interactive `grok` with the intent prompt prefilled; it
 * does not apply edits itself. Grok Build has no app deeplink, so handoff is via a launcher file (`.command` on macOS /
 * Linux, `.cmd` on Windows). Availability requires a working `grok` binary; the OS opener is always resolved.
 *
 * @param {Record<string, unknown>} config Grok Build adapter options from plugin config.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter registered by the agent registry.
 */
export function createGrokBuildAdapter(config: any = {}) {
    const sessionsEnabled = readSessionPicker(config).enabled;
    return {
        name: 'grok-build',
        sessionsEnabled,
        async isAvailable() {
            const command = await resolveGrokBuildCommand(config);
            if (!command) {
                return {
                    available: false,
                    reason: `"${resolveGrokBuildCommandCandidates(config)[0]}" not found. Install Grok Build (https://x.ai/cli) and ensure it is on PATH.`,
                };
            }
            return { available: true };
        },
        /**
         * List project sessions. The route does not call this when `sessionsEnabled` is false.
         *
         * @param {{ projectRoot: string }} ctx Inspector project root.
         * @returns {Promise<{ sessions: Array<Record<string, unknown>>, delivery: string, notice?: string }>}
         */
        async listSessions(ctx: { projectRoot: string }) {
            return listGrokSessions({ projectRoot: ctx.projectRoot, config });
        },
        async send(request: Parameters<typeof buildGrokBuildPrompt>[0] & { id: string, createdAt: string | number | Date }, context: {
            emit: (event: { type: string, text?: string }) => void,
            outputDir: string,
            projectRoot: string,
            prompt: string,
            targetSession?: { id: string, cwd: string, targetable?: boolean } | null,
        }) {
            const target = context.targetSession;
            const events = [{ type: 'started', text: target ? 'Resuming Grok Build session' : 'Opening Grok Build' }];
            context.emit(events[0]);
            try {
                const command = await resolveGrokBuildCommand(config);
                if (!command) {
                    throw new Error(
                        `"${resolveGrokBuildCommandCandidates(config)[0]}" not found. Install Grok Build (https://x.ai/cli) and ensure it is on PATH.`,
                    );
                }
                // Recheck immediately before any launcher file. The catalog may have been taken a moment ago.
                if (target && await isGrokSessionLive(resolveGrokHome(config), target.id)) {
                    const error = sessionErrorText('target-busy');
                    const failed = { type: 'failed', text: error };
                    events.push(failed);
                    context.emit(failed);
                    return {
                        ok: false,
                        agent: 'grok-build',
                        requestId: request.id,
                        code: 'target-busy',
                        error,
                        events,
                    };
                }

                const pathConfig = target ? { ...config, projectRoot: target.cwd } : config;
                // Rebuild with agent pathStyle (default relative); do not assume context.prompt matches Grok config.
                let prompt = buildGrokBuildPrompt(request, pathConfig);
                let writtenPromptPath: string | undefined;
                if (shouldWriteGrokBuildPromptFile(pathConfig, prompt)) {
                    // Persist the same path-style prompt so the handoff markdown matches what Grok sees.
                    writtenPromptPath = writePromptFile(request, { ...context, prompt });
                    prompt = buildGrokBuildFilePrompt(request, writtenPromptPath, pathConfig);
                    const event = {
                        type: 'file-change',
                        text: target ? 'Wrote prompt handoff' : `Wrote ${writtenPromptPath}`,
                    };
                    events.push(event);
                    context.emit(event);
                }

                const cwd = target ? target.cwd : resolveGrokBuildProjectRoot(config, context);
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
                    resumeSessionId: target?.id,
                });
                const launchEvent = {
                    type: 'file-change',
                    text: target ? 'Wrote launcher' : `Wrote launcher ${launchPath}`,
                };
                events.push(launchEvent);
                context.emit(launchEvent);

                await openTarget(config, launchPath);
                const completed = { type: 'completed', text: 'Grok Build opened with a prefilled prompt' };
                events.push(completed);
                context.emit(completed);
                return {
                    ok: true,
                    agent: 'grok-build',
                    requestId: request.id,
                    events,
                    output: target
                        ? 'Opened Grok Build and submitted the prompt to the session.'
                        : writtenPromptPath
                            ? `Opened Grok Build. Full request context was written to ${writtenPromptPath}.`
                            : `Opened Grok Build with the generated prompt prefilled (${promptPath}).`,
                    ...(target
                        ? { targetSessionId: target.id }
                        : { writtenPromptPath: writtenPromptPath ?? promptPath }),
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
