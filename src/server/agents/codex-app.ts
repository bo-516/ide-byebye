import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertPathInsideRoot } from '../security.js';
import { renderRequestMarkdown } from './file.js';
import { buildCodexAppFilePrompt, buildCodexAppPrompt } from './codex-app-prompt.js';
const DEFAULT_SCHEME = 'codex';
export { buildCodexAppFilePrompt, buildCodexAppPrompt };

/**
 * Build a filesystem-safe timestamp fragment for prompt handoff files.
 *
 * Boundary: this helper only formats a valid Date-like object; passing a non-Date
 * value that lacks `toISOString()` will throw before a prompt file is written.
 *
 * @param {Date} date Date used to stamp the prompt file name.
 * @returns {string} ISO-like timestamp with colon characters replaced for file-system compatibility.
 */
function fileStamp(date) {
    return date.toISOString().replace(/:/g, '-').replace(/\..+$/, '');
}

/**
 * Normalize the URL scheme used for Codex App deeplinks.
 *
 * Boundary: the returned scheme omits a trailing colon and must match URL scheme
 * syntax. Passing an invalid scheme throws so the adapter reports a visible error
 * instead of opening a malformed external URL.
 *
 * @param {string | undefined} scheme Optional configured scheme.
 * @returns {string} Valid deeplink scheme, usually `codex`.
 */
function normalizeScheme(scheme) {
    const value = (scheme ?? DEFAULT_SCHEME).replace(/:$/, '');
    if (!/^[a-z][a-z0-9+.-]*$/i.test(value)) {
        throw new Error(`Invalid Codex App URL scheme: ${scheme}`);
    }
    return value;
}

/**
 * Build the Codex App new-conversation deeplink.
 *
 * Boundary: `prompt` is required by the receiving app, while `path` and
 * `originUrl` are optional query parameters. Passing a blank path simply omits
 * the target folder and leaves folder selection to Codex App.
 *
 * @param {{ scheme?: string, prompt: string, path?: string, originUrl?: string }} input Deeplink fields.
 * @returns {string} Fully encoded Codex App deeplink URL.
 */
export function buildCodexAppDeepLink(input) {
    const url = new URL(`${normalizeScheme(input.scheme)}://new`);
    url.searchParams.set('prompt', input.prompt);
    if (input.path)
        url.searchParams.set('path', input.path);
    if (input.originUrl)
        url.searchParams.set('originUrl', input.originUrl);
    return url.toString();
}

/**
 * Resolve the project directory sent to Codex App.
 *
 * Boundary: `codexApp.projectRoot` overrides the Vite project root only when it
 * is a non-blank string. Relative configured paths are resolved against the
 * current Node process; passing a non-string or blank value falls back to
 * `context.projectRoot`.
 *
 * @param {Record<string, unknown>} config Codex App adapter config.
 * @param {{ projectRoot: string }} context Agent context carrying the Vite project root.
 * @returns {string} Absolute or context-provided project directory for the deeplink `path`.
 */
export function resolveCodexAppProjectRoot(config, context) {
    const configuredRoot = typeof config?.projectRoot === 'string' && config.projectRoot.trim()
        ? config.projectRoot.trim()
        : '';
    return configuredRoot ? path.resolve(configuredRoot) : context.projectRoot;
}

/**
 * Write a full prompt handoff file under the inspector output directory.
 *
 * Boundary: the target `requests` directory must stay inside the trusted Vite
 * project root. Passing a context with an outside output directory throws via
 * `assertPathInsideRoot` before any file is created.
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
 * Decide whether Codex App should receive prompt text directly or through a file.
 *
 * Boundary: only `promptMode: "file"` currently forces file handoff; invalid or
 * omitted modes keep direct deeplink prompting. Passing a non-string mode is
 * therefore treated like `auto`.
 *
 * @param {Record<string, unknown>} config Codex App adapter config.
 * @param {string} prompt Rendered prompt text, reserved for future size-based auto mode.
 * @returns {boolean} True when the request should be written to disk first.
 */
function shouldWritePromptFile(config, prompt) {
    void prompt;
    const mode = config.promptMode ?? 'auto';
    if (mode === 'file')
        return true;
    return false;
}

/**
 * Resolve the command used to open a Codex App deeplink.
 *
 * Boundary: custom `openCommand` wins; otherwise only macOS receives the native
 * `open` command. Passing no command on non-macOS makes availability checks fail
 * cleanly instead of spawning an unknown executable.
 *
 * @param {Record<string, unknown>} config Codex App adapter config.
 * @returns {string | null} Executable name/path, or null when unavailable.
 */
function resolveOpenCommand(config) {
    if (config.openCommand)
        return config.openCommand;
    return process.platform === 'darwin' ? 'open' : null;
}

/**
 * Build process arguments for the deeplink opener command.
 *
 * Boundary: configured `openArgs` must be an array-like value accepted by spread;
 * invalid values will throw before spawning, surfacing a config error. The URL is
 * always appended last so wrappers can prepend flags.
 *
 * @param {Record<string, unknown>} config Codex App adapter config.
 * @param {string} url Encoded Codex App deeplink.
 * @returns {string[]} Arguments passed to the opener process.
 */
function buildOpenArgs(config, url) {
    return [...(config.openArgs ?? []), url];
}

/**
 * Spawn the OS command that opens the Codex App deeplink.
 *
 * Boundary: this function only observes process startup and exit status; it does
 * not know whether Codex App accepted the URL after the opener succeeds. Passing
 * a missing command or bad args rejects with the process error.
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
            if (err)
                reject(err);
            else
                resolve(undefined);
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
 * Create the Codex App deeplink adapter.
 *
 * Boundary: this adapter opens a local app URL and does not execute edits itself. Code references are converted to
 * Codex App Markdown links before deeplinking; `codexApp.projectRoot` can override the Vite root used in the URL `path`.
 * Passing an invalid app config makes availability checks or URL creation fail with a user-visible adapter error.
 *
 * @param {Record<string, unknown>} config Codex App adapter options from plugin config.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter registered by the agent registry.
 */
export function createCodexAppAdapter(config: any = {}) {
    return {
        name: 'codex-app',
        async isAvailable() {
            if (resolveOpenCommand(config))
                return { available: true };
            return {
                available: false,
                reason: 'Codex App deeplinks require macOS "open" or a configured codexApp.openCommand.',
            };
        },
        async send(request, context) {
            const events = [{ type: 'started', text: 'Opening Codex App' }];
            context.emit(events[0]);
            try {
                let prompt = buildCodexAppPrompt(request);
                let writtenPromptPath;
                if (shouldWritePromptFile(config, context.prompt)) {
                    writtenPromptPath = writePromptFile(request, context);
                    prompt = buildCodexAppFilePrompt(request, writtenPromptPath);
                    const event = { type: 'file-change', text: `Wrote ${writtenPromptPath}` };
                    events.push(event);
                    context.emit(event);
                }
                const url = buildCodexAppDeepLink({
                    scheme: config.scheme,
                    prompt,
                    path: resolveCodexAppProjectRoot(config, context),
                });
                const command = resolveOpenCommand(config);
                if (!command) {
                    throw new Error('Codex App deeplinks require macOS "open" or a configured codexApp.openCommand.');
                }
                await openDeepLink(command, buildOpenArgs(config, url));
                const completed = {
                    type: 'completed',
                    text: 'Codex App opened with a prefilled new conversation',
                };
                events.push(completed);
                context.emit(completed);
                return {
                    ok: true,
                    agent: 'codex-app',
                    requestId: request.id,
                    events,
                    output: writtenPromptPath
                        ? `Opened Codex App. Full request context was written to ${writtenPromptPath}.`
                        : 'Opened Codex App with the generated prompt prefilled.',
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
                    agent: 'codex-app',
                    requestId: request.id,
                    events,
                    error,
                };
            }
        },
    };
}
