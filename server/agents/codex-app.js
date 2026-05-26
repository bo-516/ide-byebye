import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertPathInsideRoot } from '../security.js';
import { renderRequestMarkdown } from './file.js';
import { buildPromptReferenceLines } from '../prompt.js';
const DEFAULT_SCHEME = 'codex';
function fileStamp(date) {
    return date.toISOString().replace(/:/g, '-').replace(/\..+$/, '');
}
function normalizeScheme(scheme) {
    const value = (scheme ?? DEFAULT_SCHEME).replace(/:$/, '');
    if (!/^[a-z][a-z0-9+.-]*$/i.test(value)) {
        throw new Error(`Invalid Codex App URL scheme: ${scheme}`);
    }
    return value;
}
export function buildCodexAppDeepLink(input) {
    const url = new URL(`${normalizeScheme(input.scheme)}://new`);
    url.searchParams.set('prompt', input.prompt);
    if (input.path)
        url.searchParams.set('path', input.path);
    if (input.originUrl)
        url.searchParams.set('originUrl', input.originUrl);
    return url.toString();
}
export function buildCodexAppFilePrompt(request, promptPath) {
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
export function createCodexAppAdapter(config = {}) {
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
                let prompt = context.prompt;
                let writtenPromptPath;
                if (shouldWritePromptFile(config, prompt)) {
                    writtenPromptPath = writePromptFile(request, context);
                    prompt = buildCodexAppFilePrompt(request, writtenPromptPath);
                    const event = { type: 'file-change', text: `Wrote ${writtenPromptPath}` };
                    events.push(event);
                    context.emit(event);
                }
                const url = buildCodexAppDeepLink({
                    scheme: config.scheme,
                    prompt,
                    path: context.projectRoot,
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
