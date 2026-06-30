import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertPathInsideRoot } from '../security.js';
import { renderRequestMarkdown } from './file.js';
import { buildPromptReferenceLines, filterInlineReferenceLines } from '../prompt.js';
const DEFAULT_SCHEME = 'claude';
const DEFAULT_ROUTE = 'code';
function fileStamp(date) {
    return date.toISOString().replace(/:/g, '-').replace(/\..+$/, '');
}
function normalizeScheme(scheme) {
    const value = (scheme ?? DEFAULT_SCHEME).replace(/:$/, '');
    if (!/^[a-z][a-z0-9+.-]*$/i.test(value)) {
        throw new Error(`Invalid Claude App URL scheme: ${scheme}`);
    }
    return value;
}
export function buildClaudeAppDeepLink(input) {
    const route = input.route ?? DEFAULT_ROUTE;
    const url = new URL(`${normalizeScheme(input.scheme)}://${route}/new`);
    url.searchParams.set('q', input.prompt);
    const folders = input.folders ?? (input.folder ? [input.folder] : []);
    for (const folder of folders) {
        if (folder)
            url.searchParams.append('folder', folder);
    }
    for (const file of input.files ?? []) {
        if (file)
            url.searchParams.append('file', file);
    }
    return url.toString();
}
/**
 * Collect the absolute paths referenced by an intent request so they can be
 * opened directly in Claude App via repeatable `file` deeplink params.
 *
 * Boundary: `source.filePath` values are already validated inside the project
 * root by source resolution. Code references come first (primary selection, then
 * extra `@code` chips) and screenshot artifacts are appended last so editable
 * code leads. Order is preserved and duplicates are dropped. Passing
 * `includeScreenshots: false` keeps only code files.
 *
 * @param {Record<string, unknown>} request Normalized intent request.
 * @param {{ includeScreenshots?: boolean }} [options] Whether to append screenshot paths.
 * @returns {string[]} Unique absolute file paths to attach to the deeplink.
 */
export function collectClaudeAppFiles(request, options = {}) {
    const { includeScreenshots = true } = options;
    const files = [];
    const add = (filePath) => {
        if (typeof filePath === 'string' && filePath && !files.includes(filePath))
            files.push(filePath);
    };
    add(request.source?.filePath);
    if (Array.isArray(request.references)) {
        for (const reference of request.references)
            add(reference?.source?.filePath);
    }
    if (includeScreenshots) {
        const screenshots = request.screenshots?.length
            ? request.screenshots
            : request.screenshot
                ? [request.screenshot]
                : [];
        for (const screenshot of screenshots)
            add(screenshot?.filePath);
    }
    return files;
}
/**
 * Resolve the ordered, de-duplicated folder list opened by the Claude App
 * deeplink: the project root first, then any extra absolute folders configured
 * via `claudeApp.folders` (e.g. a sibling backend repo in a split workspace).
 *
 * Boundary: only non-blank string entries are kept; relative configured paths are
 * resolved against the current Node process. Passing no `folders` config yields
 * just the project root, preserving the previous single-folder behavior.
 *
 * @param {Record<string, unknown>} config Claude App adapter config.
 * @param {{ projectRoot: string }} context Agent context carrying the Vite project root.
 * @returns {string[]} Absolute folder paths for repeatable `folder` deeplink params.
 */
export function resolveClaudeAppFolders(config, context) {
    const folders = [];
    const add = (folderPath) => {
        if (typeof folderPath === 'string' && folderPath && !folders.includes(folderPath))
            folders.push(folderPath);
    };
    add(context.projectRoot);
    const extra = Array.isArray(config.folders) ? config.folders : [];
    for (const folder of extra) {
        if (typeof folder === 'string' && folder.trim())
            add(path.resolve(folder.trim()));
    }
    return folders;
}
export function buildClaudeAppFilePrompt(request, promptPath) {
    const intent = request.intent.trim();
    const refs = filterInlineReferenceLines(buildPromptReferenceLines(request), intent);
    return [...refs, promptPath, '', intent].join('\n').trim() + '\n';
}
function writePromptFile(request, context) {
    const requestsDir = path.join(context.outputDir, 'requests');
    assertPathInsideRoot(requestsDir, context.projectRoot);
    fs.mkdirSync(requestsDir, { recursive: true });
    const target = path.join(requestsDir, `${fileStamp(new Date(request.createdAt))}-${request.id}.md`);
    fs.writeFileSync(target, renderRequestMarkdown(request, context.prompt), 'utf8');
    return target;
}
function shouldWritePromptFile(config, prompt) {
    void prompt;
    const mode = config.promptMode ?? 'auto';
    if (mode === 'file')
        return true;
    return false;
}
function resolveOpenCommand(config) {
    if (config.openCommand)
        return config.openCommand;
    return process.platform === 'darwin' ? 'open' : null;
}
function buildOpenArgs(config, url) {
    return [...(config.openArgs ?? []), url];
}
function openDeepLink(command, args) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const child = spawn(command, args, { stdio: 'ignore' });
        const finish = (err) => {
            if (settled)
                return;
            settled = true;
            if (err)
                reject(err);
            else
                resolve();
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
export function createClaudeAppAdapter(config = {}) {
    return {
        name: 'claude-app',
        async isAvailable() {
            if (resolveOpenCommand(config))
                return { available: true };
            return {
                available: false,
                reason: 'Claude App deeplinks require macOS "open" or a configured claudeApp.openCommand.',
            };
        },
        async send(request, context) {
            const events = [{ type: 'started', text: 'Opening Claude App' }];
            context.emit(events[0]);
            try {
                let prompt = context.prompt;
                let writtenPromptPath;
                if (shouldWritePromptFile(config, prompt)) {
                    writtenPromptPath = writePromptFile(request, context);
                    prompt = buildClaudeAppFilePrompt(request, writtenPromptPath);
                    const event = { type: 'file-change', text: `Wrote ${writtenPromptPath}` };
                    events.push(event);
                    context.emit(event);
                }
                const files = config.attachFiles === false
                    ? []
                    : collectClaudeAppFiles(request, { includeScreenshots: config.attachScreenshots !== false });
                if (files.length) {
                    const event = { type: 'file-change', text: `Attaching ${files.length} file(s) to Claude App` };
                    events.push(event);
                    context.emit(event);
                }
                const folders = resolveClaudeAppFolders(config, context);
                const url = buildClaudeAppDeepLink({
                    scheme: config.scheme,
                    route: config.route,
                    prompt,
                    folders,
                    files,
                });
                const command = resolveOpenCommand(config);
                if (!command) {
                    throw new Error('Claude App deeplinks require macOS "open" or a configured claudeApp.openCommand.');
                }
                await openDeepLink(command, buildOpenArgs(config, url));
                const completed = {
                    type: 'completed',
                    text: 'Claude App opened with a prefilled new conversation',
                };
                events.push(completed);
                context.emit(completed);
                return {
                    ok: true,
                    agent: 'claude-app',
                    requestId: request.id,
                    events,
                    output: writtenPromptPath
                        ? `Opened Claude App. Full request context was written to ${writtenPromptPath}.`
                        : 'Opened Claude App with the generated prompt prefilled.',
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
                    agent: 'claude-app',
                    requestId: request.id,
                    events,
                    error,
                };
            }
        },
    };
}
