import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertPathInsideRoot } from '../security.js';
import { renderRequestMarkdown } from './file.js';
import { buildCursorAppDeepLink, buildCursorAppFilePrompt, resolveCursorAppWorkspace } from './cursor-app-deeplink.js';

/** Cursor prompt text validator budget; too high can let Cursor reject oversized prompts. */
const DEFAULT_PROMPT_URL_LIMIT = 10000;
export { buildCursorAppDeepLink, buildCursorAppFilePrompt, resolveCursorAppWorkspace } from './cursor-app-deeplink.js';

/**
 * Build a filesystem-safe timestamp fragment for Cursor prompt handoff files.
 *
 * Boundary: `date` must expose `toISOString()`. Passing a non-Date-like value throws before any handoff file is named.
 *
 * @param {Date} date Date used to stamp the prompt file name.
 * @returns {string} ISO-like timestamp with colon characters replaced.
 */
function fileStamp(date) {
    return date.toISOString().replace(/:/g, '-').replace(/\..+$/, '');
}

/**
 * Write a full prompt handoff file under the inspector output directory.
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
 * Decide whether Cursor should receive prompt text directly or through a file.
 *
 * Boundary: `promptMode: "file"` always writes a handoff file. In `auto`, prompts that exceed Cursor's text validator
 * budget switch to file handoff; invalid limits fall back to Cursor's observed 10k budget.
 *
 * @param {Record<string, unknown>} config Cursor App adapter config.
 * @param {string} prompt Rendered prompt text.
 * @returns {boolean} True when the request should be written to disk first.
 */
function shouldWritePromptFile(config, prompt) {
    const mode = config.promptMode ?? 'auto';
    if (mode === 'file')
        return true;
    if (mode !== 'auto')
        return false;
    const rawLimit = Number(config.promptUrlLimit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_PROMPT_URL_LIMIT;
    return 21 + encodeURIComponent(prompt).length > limit;
}

/**
 * Resolve the command used to open a Cursor deeplink.
 *
 * Boundary: custom `openCommand` wins; otherwise only macOS receives the native `open` command. Non-macOS callers must
 * configure an opener explicitly.
 *
 * @param {Record<string, unknown>} config Cursor App adapter config.
 * @returns {string | null} Executable name/path, or null when unavailable.
 */
function resolveOpenCommand(config) {
    if (config.openCommand)
        return config.openCommand;
    return process.platform === 'darwin' ? 'open' : null;
}

/**
 * Build process arguments for the Cursor deeplink opener.
 *
 * Boundary: `openArgs` must be iterable. The URL is appended last so wrappers can prepend app-specific flags.
 *
 * @param {Record<string, unknown>} config Cursor App adapter config.
 * @param {string} url Encoded Cursor deeplink.
 * @returns {string[]} Arguments passed to the opener process.
 */
function buildOpenArgs(config, url) {
    return [...(config.openArgs ?? []), url];
}

/**
 * Spawn the OS command that opens the Cursor deeplink.
 *
 * Boundary: this observes only opener startup and exit status; Cursor may still reject the deeplink after the opener
 * exits successfully.
 *
 * @param {string} command Executable used to open the URL.
 * @param {string[]} args Arguments for the opener command.
 * @returns {Promise<void>} Resolves after a zero exit status, rejects otherwise.
 */
function openDeepLink(command, args) {
    return new Promise<any>((resolve, reject) => {
        let settled = false;
        const child = spawn(command, args, { stdio: 'ignore' });
        const finish = (err) => {
            if (settled)
                return;
            settled = true;
            err ? reject(err) : resolve(undefined);
        };
        child.once('error', (err) => finish(err));
        child.once('close', (code, signal) => {
            if (code === 0) {
                finish(undefined);
                return;
            }
            finish(new Error(`${command} failed with ${signal ?? `exit code ${code ?? 'unknown'}`}`));
        });
    });
}

/**
 * Create the Cursor App deeplink adapter.
 *
 * Boundary: this adapter opens Cursor's prompt deeplink and does not apply edits itself. Cursor supports workspace-name
 * routing, not arbitrary folder/file attachment, so source context remains in the prompt text.
 *
 * @param {Record<string, unknown>} config Cursor App adapter options from plugin config.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter registered by the agent registry.
 */
export function createCursorAppAdapter(config: any = {}) {
    return {
        name: 'cursor-app',
        async isAvailable() {
            if (resolveOpenCommand(config))
                return { available: true };
            return {
                available: false,
                reason: 'Cursor deeplinks require macOS "open" or a configured cursorApp.openCommand.',
            };
        },
        async send(request, context) {
            const events = [{ type: 'started', text: 'Opening Cursor' }];
            context.emit(events[0]);
            try {
                let prompt = context.prompt;
                let writtenPromptPath;
                if (shouldWritePromptFile(config, prompt)) {
                    writtenPromptPath = writePromptFile(request, context);
                    prompt = buildCursorAppFilePrompt(request, writtenPromptPath);
                    const event = { type: 'file-change', text: `Wrote ${writtenPromptPath}` };
                    events.push(event);
                    context.emit(event);
                }
                const mode = typeof config.mode === 'string' && config.mode.trim() ? config.mode.trim() : undefined;
                const url = buildCursorAppDeepLink({
                    scheme: config.scheme,
                    authority: config.authority,
                    route: config.route,
                    prompt,
                    workspace: resolveCursorAppWorkspace(config, context),
                    mode,
                });
                const command = resolveOpenCommand(config);
                if (!command) {
                    throw new Error('Cursor deeplinks require macOS "open" or a configured cursorApp.openCommand.');
                }
                await openDeepLink(command, buildOpenArgs(config, url));
                const completed = { type: 'completed', text: 'Cursor opened with a prefilled prompt' };
                events.push(completed);
                context.emit(completed);
                return {
                    ok: true,
                    agent: 'cursor-app',
                    requestId: request.id,
                    events,
                    output: writtenPromptPath
                        ? `Opened Cursor. Full request context was written to ${writtenPromptPath}.`
                        : 'Opened Cursor with the generated prompt prefilled.',
                    writtenPromptPath,
                };
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                const failed = { type: 'failed', text: error };
                events.push(failed);
                context.emit(failed);
                return {
                    ok: false,
                    agent: 'cursor-app',
                    requestId: request.id,
                    events,
                    error,
                };
            }
        },
    };
}
