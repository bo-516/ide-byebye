import fs from 'node:fs';
import path from 'node:path';
import { assertPathInsideRoot } from '../security.js';
import { renderRequestMarkdown } from './file.js';
import { openTarget } from './opener.js';
import { buildCodexAppFilePrompt, buildCodexAppPrompt } from './codex-app-prompt.js';
import { readSessionPicker } from '../sessions/options.js';
import { listCodexSessions } from '../sessions/codex-sessions.js';
import { SESSION_ID_PATTERNS } from '../sessions/types.js';
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
function fileStamp(date: Date) {
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
function normalizeScheme(scheme: string | undefined) {
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
export function buildCodexAppDeepLink(input: { scheme?: string, prompt: string, path?: string, originUrl?: string }) {
    const url = new URL(`${normalizeScheme(input.scheme)}://new`);
    url.searchParams.set('prompt', input.prompt);
    if (input.path)
        url.searchParams.set('path', input.path);
    if (input.originUrl)
        url.searchParams.set('originUrl', input.originUrl);
    return url.toString();
}

/**
 * Build a Codex App deeplink that opens an existing thread and prefills the composer.
 *
 * Boundary: `threadId` must match the Codex UUID pattern. A bad id throws before a URL is built, so it cannot be
 * interpolated into the scheme. The prompt is query-encoded. This link only prefills; Codex does not auto-submit.
 * `path` is omitted — the thread already has a cwd, and relative links inside `prompt` were rendered against it.
 *
 * @param {{ scheme?: string, threadId: string, prompt: string }} input Deeplink fields.
 * @returns {string} `codex://threads/<id>?prompt=…` (or the configured scheme).
 */
export function buildCodexAppThreadDeepLink(input: { scheme?: string, threadId: string, prompt: string }) {
    if (!SESSION_ID_PATTERNS['codex-app'].test(String(input.threadId ?? '')))
        throw new Error('Invalid Codex thread id');
    const url = new URL(`${normalizeScheme(input.scheme)}://threads/${input.threadId}`);
    url.searchParams.set('prompt', input.prompt);
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
 * @param {{ projectRoot?: unknown } | null | undefined} config Codex App adapter config.
 * @param {{ projectRoot: string }} context Agent context carrying the Vite project root.
 * @returns {string} Absolute or context-provided project directory for the deeplink `path`.
 */
export function resolveCodexAppProjectRoot(config: { projectRoot?: unknown } | null | undefined, context: { projectRoot: string }) {
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
 * Decide whether Codex App should receive prompt text directly or through a file.
 *
 * Boundary: only `promptMode: "file"` currently forces file handoff; invalid or
 * omitted modes keep direct deeplink prompting. Passing a non-string mode is
 * therefore treated like `auto`.
 *
 * @param {{ promptMode?: unknown }} config Codex App adapter config.
 * @param {string} prompt Rendered prompt text, reserved for future size-based auto mode.
 * @returns {boolean} True when the request should be written to disk first.
 */
function shouldWritePromptFile(config: { promptMode?: unknown }, prompt: string) {
    void prompt;
    const mode = config.promptMode ?? 'auto';
    if (mode === 'file')
        return true;
    return false;
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
    const sessionsEnabled = readSessionPicker(config).enabled;
    return {
        name: 'codex-app',
        sessionsEnabled,
        async isAvailable() {
            return { available: true };
        },
        /**
         * List project threads. Ignored by the route when `sessionsEnabled` is false.
         *
         * @param {{ projectRoot: string }} ctx Inspector project root.
         * @returns {Promise<{ sessions: Array<Record<string, unknown>>, delivery: string, notice?: string }>}
         */
        async listSessions(ctx: { projectRoot: string }) {
            return listCodexSessions({ projectRoot: ctx.projectRoot, config });
        },
        async send(request: Parameters<typeof buildCodexAppPrompt>[0] & { id: string, createdAt: string | number | Date }, context: {
            emit: (event: { type: string, text?: string }) => void,
            outputDir: string,
            projectRoot: string,
            prompt: string,
            targetSession?: { id: string, cwd: string } | null,
        }) {
            const target = context.targetSession;
            const events = [{ type: 'started', text: target ? 'Opening Codex App thread' : 'Opening Codex App' }];
            context.emit(events[0]);
            try {
                // Thread cwd is the link root so `@` paths match the conversation the user is already in.
                const promptRequest = target ? { ...request, projectRoot: target.cwd } : request;
                let prompt = buildCodexAppPrompt(promptRequest);
                let writtenPromptPath: string | undefined;
                if (shouldWritePromptFile(config, context.prompt)) {
                    // The route's prompt is relative to the inspector root. A thread handoff must embed the prompt
                    // rebuilt against the thread cwd, or repo-root threads keep package-relative links.
                    writtenPromptPath = writePromptFile(request, target ? { ...context, prompt } : context);
                    prompt = buildCodexAppFilePrompt(promptRequest, writtenPromptPath);
                    const event = {
                        type: 'file-change',
                        text: target ? 'Wrote prompt handoff' : `Wrote ${writtenPromptPath}`,
                    };
                    events.push(event);
                    context.emit(event);
                }
                const url = target
                    ? buildCodexAppThreadDeepLink({ scheme: config.scheme, threadId: target.id, prompt })
                    : buildCodexAppDeepLink({
                        scheme: config.scheme,
                        prompt,
                        path: resolveCodexAppProjectRoot(config, context),
                    });
                await openTarget(config, url);
                const completed = {
                    type: 'completed',
                    text: target
                        ? 'Codex App opened with the thread prompt prefilled'
                        : 'Codex App opened with a prefilled new conversation',
                };
                events.push(completed);
                context.emit(completed);
                return {
                    ok: true,
                    agent: 'codex-app',
                    requestId: request.id,
                    events,
                    output: target
                        ? 'Opened Codex App thread with the prompt prefilled.'
                        : writtenPromptPath
                            ? `Opened Codex App. Full request context was written to ${writtenPromptPath}.`
                            : 'Opened Codex App with the generated prompt prefilled.',
                    ...(target
                        ? { targetSessionId: target.id }
                        : writtenPromptPath
                            ? { writtenPromptPath }
                            : {}),
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
