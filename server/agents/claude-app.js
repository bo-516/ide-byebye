import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertPathInsideRoot } from '../security.js';
import { renderRequestMarkdown } from './file.js';
import { buildPromptReferenceLines } from '../prompt.js';
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
    if (input.folder)
        url.searchParams.append('folder', input.folder);
    return url.toString();
}
export function buildClaudeAppFilePrompt(request, promptPath) {
    return [...buildPromptReferenceLines(request), promptPath, '', request.intent.trim()].join('\n').trim() + '\n';
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
                const url = buildClaudeAppDeepLink({
                    scheme: config.scheme,
                    route: config.route,
                    prompt,
                    folder: context.projectRoot,
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
