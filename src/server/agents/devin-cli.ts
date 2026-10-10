import {
    buildDevinCliLauncherFile,
    buildDevinCliPrompt,
    resolveDevinCliCommandCandidates,
    resolveDevinCliProjectRoot,
    shouldWriteDevinCliPromptFile,
} from './devin-cli-launcher.js';
import { resolveFirstCommand, writeHandoffPromptFile, writeLaunchFiles } from './launch-files.js';
import { openTarget } from './opener.js';
import { readSessionPicker } from '../sessions/options.js';
import { listDevinSessions } from '../sessions/devin-sessions.js';

export {
    buildDevinCliFilePrompt,
    buildDevinCliLauncherFile,
    buildDevinCliLauncherScript,
    buildDevinCliPrompt,
    buildDevinCliWindowsLauncherScript,
    devinCliLauncherExtension,
    resolveDevinCliCommandCandidates,
    resolveDevinCliPathStyleOptions,
    resolveDevinCliProjectRoot,
    shouldWriteDevinCliPromptFile,
    withDevinCliPathRoot,
} from './devin-cli-launcher.js';
export { DEVIN_SESSION_ID_PATTERN } from '../sessions/types.js';

/**
 * Resolve the Devin CLI binary that should be embedded in the launcher.
 *
 * Boundary: returns the first candidate whose `--version` succeeds. Callers must treat `null` as unavailable — do not
 * fall back to spawning an unverified name after this helper fails.
 *
 * @param {{ command?: unknown }} config Devin CLI adapter config.
 * @returns {Promise<string | null>} Absolute path or PATH name of a working `devin`, or null.
 */
export async function resolveDevinCliCommand(config: { command?: unknown }) {
    return resolveFirstCommand(resolveDevinCliCommandCandidates(config));
}

/**
 * Create the Devin CLI adapter.
 *
 * Boundary: this adapter opens a local Terminal session running interactive `devin` with the intent prompt as the
 * initial message; it does not apply edits itself. Handoff is via a launcher file (`.command` on macOS / Linux,
 * `.cmd` on Windows). Long prompts and `promptMode: "file"` switch to `devin --prompt-file` so the full request is
 * delivered as the first message rather than as a pointer prompt. Availability requires a working `devin` binary.
 * `targetSession` resumes an id previously returned by `listSessions`.
 *
 * @param {Record<string, unknown>} config Devin CLI adapter options from plugin config.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter registered by the agent registry.
 */
export function createDevinCliAdapter(config: Record<string, unknown> = {}) {
    const sessionsEnabled = readSessionPicker(config).enabled;
    return {
        name: 'devin-cli',
        sessionsEnabled,
        async isAvailable() {
            const command = await resolveDevinCliCommand(config);
            if (!command) {
                return {
                    available: false,
                    reason: `"${resolveDevinCliCommandCandidates(config)[0]}" not found. Install Devin (https://devin.ai) or Devin Desktop and ensure the CLI is on PATH.`,
                };
            }
            return { available: true };
        },
        /**
         * List project sessions via `devin list --format json`. The route does not call this when `sessionsEnabled` is false.
         *
         * @param {{ projectRoot: string }} ctx Inspector project root.
         * @returns {Promise<{ sessions: Array<Record<string, unknown>>, delivery: string, notice?: string }>}
         */
        async listSessions(ctx: { projectRoot: string }) {
            return listDevinSessions({ projectRoot: ctx.projectRoot, config });
        },
        async send(request: Parameters<typeof buildDevinCliPrompt>[0] & { id: string, createdAt: string | number | Date }, context: {
            emit: (event: { type: string, text?: string }) => void,
            outputDir: string,
            projectRoot: string,
            prompt: string,
            targetSession?: { id: string, cwd: string, targetable?: boolean } | null,
        }) {
            const target = context.targetSession;
            const events = [{ type: 'started', text: target ? 'Resuming Devin session' : 'Opening Devin' }];
            context.emit(events[0]);
            try {
                const command = await resolveDevinCliCommand(config);
                if (!command) {
                    throw new Error(
                        `"${resolveDevinCliCommandCandidates(config)[0]}" not found. Install Devin (https://devin.ai) or Devin Desktop and ensure the CLI is on PATH.`,
                    );
                }

                const pathConfig = target ? { ...config, projectRoot: target.cwd } : config;
                // Rebuild with agent pathStyle (default relative); do not assume context.prompt matches Devin config.
                const prompt = buildDevinCliPrompt(request, pathConfig);
                let writtenPromptPath: string | undefined;
                let promptFile: string | undefined;
                if (shouldWriteDevinCliPromptFile(pathConfig, prompt)) {
                    // Persist the same path-style prompt and hand it to `devin --prompt-file` — the CLI reads the file
                    // itself, so the full request text becomes the first message instead of a pointer prompt.
                    promptFile = writeHandoffPromptFile(request, { ...context, prompt });
                    writtenPromptPath = promptFile;
                    const event = {
                        type: 'file-change',
                        text: target ? 'Wrote prompt handoff' : `Wrote ${writtenPromptPath}`,
                    };
                    events.push(event);
                    context.emit(event);
                }

                const cwd = target ? target.cwd : resolveDevinCliProjectRoot(config, context);
                const permissionMode = typeof config.permissionMode === 'string' && config.permissionMode.trim()
                    ? config.permissionMode.trim()
                    : undefined;
                const model = typeof config.model === 'string' && config.model.trim()
                    ? config.model.trim()
                    : undefined;
                const cloud = config.cloud === true;
                // The script is built before any file is written, so a bad resume id leaves nothing behind.
                const { launchPath, promptPath } = writeLaunchFiles({
                    request,
                    context,
                    prompt,
                    buildScript: (promptPathArg) => buildDevinCliLauncherFile({
                        command,
                        cwd,
                        promptPath: promptPathArg,
                        promptFile,
                        permissionMode,
                        model,
                        cloud,
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
                const completed = { type: 'completed', text: 'Devin opened with the prepared prompt' };
                events.push(completed);
                context.emit(completed);
                return {
                    ok: true,
                    agent: 'devin-cli',
                    requestId: request.id,
                    events,
                    output: target
                        ? 'Opened Devin and sent the prompt to the session.'
                        : writtenPromptPath
                            ? `Opened Devin. Full request context was written to ${writtenPromptPath}.`
                            : `Opened Devin with the generated prompt (${promptPath}).`,
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
                    agent: 'devin-cli',
                    requestId: request.id,
                    events,
                    error,
                };
            }
        },
    };
}
