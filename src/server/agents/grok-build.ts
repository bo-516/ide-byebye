import {
    buildGrokBuildFilePrompt,
    buildGrokBuildLauncherFile,
    buildGrokBuildPrompt,
    resolveGrokBuildCommandCandidates,
    resolveGrokBuildProjectRoot,
    shouldWriteGrokBuildPromptFile,
} from './grok-build-launcher.js';
import { resolveFirstCommand, writeHandoffPromptFile, writeLaunchFiles } from './launch-files.js';
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
 * Resolve the Grok Build CLI binary that should be embedded in the launcher.
 *
 * Boundary: returns the first candidate whose `--version` succeeds. Callers must treat `null` as unavailable — do not
 * fall back to spawning an unverified name after this helper fails.
 *
 * @param {{ command?: unknown }} config Grok Build adapter config.
 * @returns {Promise<string | null>} Absolute path or PATH name of a working `grok`, or null.
 */
export async function resolveGrokBuildCommand(config: { command?: unknown }) {
    return resolveFirstCommand(resolveGrokBuildCommandCandidates(config));
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
                    writtenPromptPath = writeHandoffPromptFile(request, { ...context, prompt });
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
                // The script is built before any file is written, so a bad resume id leaves nothing behind.
                const { launchPath, promptPath } = writeLaunchFiles({
                    request,
                    context,
                    prompt,
                    buildScript: (promptFile) => buildGrokBuildLauncherFile({
                        command,
                        cwd,
                        promptPath: promptFile,
                        permissionMode,
                        resumeSessionId: target?.id,
                    }),
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
