import { spawn } from 'node:child_process';
import { JsonRpcClient, createWebSocketTransport, } from './json-rpc.js';
const DEFAULT_URL = 'ws://127.0.0.1:9891';
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
let spawnedWebSocketServer = null;
/**
 * Map a Codex App Server notification to our event shape. The App Server
 * protocol is versioned and evolving, so this stays defensive: anything we
 * don't specifically recognize still surfaces as a generic message.
 */
export function normalizeAppServerNotification(n) {
    const params = (n.params ?? {});
    const method = n.method;
    if (method.endsWith('turn/completed') || method === 'turn/completed') {
        return { type: 'completed', text: readText(params), raw: n };
    }
    if (method.endsWith('turn/failed') || method === 'turn/failed') {
        return { type: 'failed', text: readText(params) ?? 'Turn failed', raw: n };
    }
    if (method.includes('item') || method.includes('message')) {
        return { type: 'message', text: readText(params), raw: n };
    }
    if (method.includes('exec') || method.includes('command') || method.includes('tool')) {
        return { type: 'tool', text: readText(params), raw: n };
    }
    if (method.includes('patch') || method.includes('file') || method.includes('diff')) {
        return { type: 'file-change', text: readText(params), raw: n };
    }
    return { type: 'message', text: `${method}`, raw: n };
}
function readText(params) {
    if (typeof params.text === 'string')
        return params.text;
    if (typeof params.message === 'string')
        return params.message;
    if (typeof params.delta === 'string')
        return params.delta;
    const error = params.error;
    if (typeof error?.message === 'string')
        return error.message;
    const item = params.item;
    const itemText = item ? readItemText(item) : undefined;
    if (itemText)
        return itemText;
    const turn = params.turn;
    const turnText = turn ? readTurnText(turn) : undefined;
    if (turnText)
        return turnText;
    return undefined;
}
function readTurnText(turn) {
    const items = turn.items;
    if (!Array.isArray(items))
        return undefined;
    for (let i = items.length - 1; i >= 0; i -= 1) {
        const item = items[i];
        const text = readItemText(item);
        if (text)
            return text;
    }
    return undefined;
}
function readItemText(item) {
    if (typeof item.text === 'string')
        return item.text;
    if (typeof item.message === 'string')
        return item.message;
    if (typeof item.content === 'string')
        return item.content;
    const type = String(item.type ?? '');
    if (type === 'commandExecution' || type === 'command_execution') {
        const command = typeof item.command === 'string' ? item.command : undefined;
        const output = typeof item.aggregatedOutput === 'string'
            ? item.aggregatedOutput
            : typeof item.aggregated_output === 'string'
                ? item.aggregated_output
                : undefined;
        return [command, output].filter(Boolean).join('\n');
    }
    if (type === 'fileChange' || type === 'file_change') {
        const changes = Array.isArray(item.changes)
            ? item.changes
                .map((change) => {
                const obj = (change ?? {});
                const kind = typeof obj.kind === 'string' ? obj.kind : 'change';
                const path = typeof obj.path === 'string' ? obj.path : undefined;
                return path ? `${kind}: ${path}` : kind;
            })
                .join('\n')
            : undefined;
        return changes;
    }
    if (type === 'reasoning') {
        if (Array.isArray(item.summary))
            return item.summary.filter(isString).join('\n');
        if (Array.isArray(item.content))
            return item.content.filter(isString).join('\n');
    }
    return undefined;
}
function isString(value) {
    return typeof value === 'string';
}
async function connect(config, options = {}) {
    const transport = config.transport ?? 'websocket';
    if (transport === 'websocket') {
        const url = config.url ?? DEFAULT_URL;
        try {
            return await createWebSocketTransport(url);
        }
        catch (err) {
            if (options.allowStart === false || !config.command)
                throw err;
            startWebSocketServer(config, url);
            return waitForWebSocket(config, url, err);
        }
    }
    throw new Error(`Codex App Server transport "${transport}" is not implemented yet; use "websocket".`);
}
function startWebSocketServer(config, url) {
    if (spawnedWebSocketServer && !spawnedWebSocketServer.killed)
        return;
    const command = config.command;
    if (!command)
        return;
    const args = config.args ?? ['app-server', '--listen', url];
    spawnedWebSocketServer = spawn(command, args, {
        stdio: 'ignore',
        detached: false,
    });
    spawnedWebSocketServer.once('error', () => {
        spawnedWebSocketServer = null;
    });
    spawnedWebSocketServer.once('exit', () => {
        spawnedWebSocketServer = null;
    });
}
async function waitForWebSocket(config, url, initialError) {
    const deadline = Date.now() + (config.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);
    let lastError = initialError;
    while (Date.now() < deadline) {
        await delay(250);
        try {
            return await connect({ ...config, command: undefined }, { allowStart: false });
        }
        catch (err) {
            lastError = err;
        }
    }
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`Failed to connect to ${url} after starting Codex App Server: ${reason}`);
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function readThreadId(response) {
    const obj = (response ?? {});
    if (typeof obj.threadId === 'string')
        return obj.threadId;
    if (typeof obj.id === 'string')
        return obj.id;
    const thread = obj.thread;
    if (typeof thread?.id === 'string')
        return thread.id;
    return undefined;
}
function textInput(text) {
    return [{ type: 'text', text, text_elements: [] }];
}
export function createCodexAppServerAdapter(config) {
    const timeoutMs = config.timeoutMs ?? 10 * 60 * 1000;
    return {
        name: 'codex-app-server',
        async isAvailable() {
            const transport = config.transport ?? 'websocket';
            if (transport !== 'websocket') {
                return {
                    available: false,
                    reason: `Transport "${transport}" not implemented; use websocket`,
                };
            }
            try {
                const t = await connect(config);
                t.close();
                return { available: true };
            }
            catch (err) {
                const url = config.url ?? DEFAULT_URL;
                return {
                    available: false,
                    reason: (err instanceof Error ? err.message : String(err)) +
                        (config.command ? '' : `. Start it with: codex app-server --listen ${url}`),
                };
            }
        },
        async send(request, context) {
            const events = [];
            let transport = null;
            try {
                transport = await connect(config);
                const rpc = new JsonRpcClient(transport);
                return await new Promise((resolve) => {
                    let settled = false;
                    let threadId;
                    const emit = (event) => {
                        events.push(event);
                        context.emit(event);
                    };
                    const finish = (ok, output, error) => {
                        if (settled)
                            return;
                        settled = true;
                        clearTimeout(timer);
                        if (threadId) {
                            context.sessionStore.set('codexAppServer.lastThreadId', threadId);
                            context.sessionStore.set(`codexAppServer.threadsByProject.${context.projectRoot.replace(/\./g, '_')}`, threadId);
                        }
                        transport?.close();
                        resolve({
                            ok,
                            agent: 'codex-app-server',
                            requestId: request.id,
                            threadId,
                            output,
                            events,
                            error,
                        });
                    };
                    const timer = setTimeout(() => finish(false, undefined, `Codex App Server turn timed out after ${timeoutMs}ms`), timeoutMs);
                    rpc.onNotification((n) => {
                        const event = normalizeAppServerNotification(n);
                        emit(event);
                        if (event.type === 'completed')
                            finish(true, event.text);
                        if (event.type === 'failed')
                            finish(false, event.text, event.text ?? 'Turn failed');
                    });
                    void (async () => {
                        try {
                            // `initialize` is optional; ignore failures so older servers work.
                            await rpc
                                .request('initialize', {
                                clientInfo: {
                                    name: 'code-intent-inspector',
                                    title: 'Code Intent Inspector',
                                    version: '0.1.0',
                                },
                                capabilities: null,
                            })
                                .then(() => rpc.notify('initialized'))
                                .catch(() => undefined);
                            const stored = context.sessionStore.get('codexAppServer.lastThreadId');
                            const resumeId = config.threadId ?? (config.resumeLastThread && request.resume ? stored : undefined);
                            emit({
                                type: 'started',
                                text: resumeId ? `Resuming thread ${resumeId}` : 'Starting Codex thread',
                            });
                            const thread = resumeId
                                ? await rpc.request('thread/resume', { threadId: resumeId })
                                : await rpc.request('thread/start', { cwd: context.projectRoot });
                            threadId = readThreadId(thread) ?? resumeId;
                            if (!threadId) {
                                throw new Error('Codex App Server did not return a thread id');
                            }
                            await rpc.request('turn/start', {
                                threadId,
                                input: textInput(context.prompt),
                                cwd: context.projectRoot,
                            });
                            // Completion arrives via notifications handled above. If the
                            // server is purely request/response, the turn/start result may
                            // already represent completion — but we wait for the timer or a
                            // terminal notification to be safe.
                        }
                        catch (err) {
                            finish(false, undefined, err instanceof Error ? err.message : String(err));
                        }
                    })();
                });
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                context.emit({ type: 'failed', text: error });
                transport?.close();
                return {
                    ok: false,
                    agent: 'codex-app-server',
                    requestId: request.id,
                    events,
                    error,
                };
            }
        },
    };
}
