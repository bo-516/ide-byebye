import fs from 'node:fs';
import path from 'node:path';
import { antigravityNavigateExpression, antigravityUserDataDir, buildAntigravityComposerUrl, parseDevToolsActivePort, selectAntigravityPage, } from './antigravity-app.js';

/**
 * Read the live Antigravity page from its DevTools endpoint.
 *
 * Boundary: a missing or stale `DevToolsActivePort` returns null. The HTTP call is loopback-only. A non-local page
 * in the target list is ignored by {@link selectAntigravityPage}.
 *
 * @param {string} userDataDir Electron user-data directory.
 * @param {typeof fetch} [fetchImpl=fetch] HTTP implementation.
 * @returns {Promise<{ url: string, webSocketDebuggerUrl: string } | null>} Composer page, or null when the app is not reachable.
 */
async function readAntigravityPage(userDataDir: string, fetchImpl = fetch) {
    let text;
    try {
        text = fs.readFileSync(path.join(userDataDir, 'DevToolsActivePort'), 'utf8');
    }
    catch {
        return null;
    }
    const endpoint = parseDevToolsActivePort(text);
    if (!endpoint)
        return null;
    let list;
    try {
        const response = await fetchImpl(`http://127.0.0.1:${endpoint.port}/json/list`);
        if (!response.ok)
            return null;
        list = await response.json();
    }
    catch {
        return null;
    }
    return selectAntigravityPage(list);
}

/**
 * Evaluate one expression in the Antigravity page over its DevTools websocket.
 *
 * Boundary: `wsUrl` must be the page's `webSocketDebuggerUrl`. The socket is closed after the result. Node's global
 * `WebSocket` is required (Node 22+). A missing constructor throws before any connection.
 *
 * @param {string} wsUrl Page websocket URL.
 * @param {string} expression JavaScript to run in the page.
 * @param {number} [timeoutMs=8000] How long to wait for the result.
 * @returns {Promise<void>} Resolves when DevTools accepts the expression.
 */
function evaluateInPage(wsUrl: string, expression: string, timeoutMs = 8000) {
    const WebSocketImpl = globalThis.WebSocket;
    if (typeof WebSocketImpl !== 'function')
        throw new Error('This Node version cannot attach to the Antigravity window');
    return new Promise((resolve, reject) => {
        const ws = new WebSocketImpl(wsUrl);
        const timer = setTimeout(() => {
            ws.close();
            reject(new Error('Timed out while writing the prompt into Antigravity'));
        }, timeoutMs);
        const finish = (err?: unknown) => {
            clearTimeout(timer);
            ws.close();
            if (err)
                reject(err);
            else
                resolve(undefined);
        };
        ws.addEventListener('open', () => {
            ws.send(JSON.stringify({
                id: 1,
                method: 'Runtime.evaluate',
                params: { expression, returnByValue: true },
            }));
        });
        ws.addEventListener('message', (event) => {
            let message;
            try {
                message = JSON.parse(String(event.data));
            }
            catch {
                return;
            }
            if (message.id !== 1)
                return;
            const details = message.result?.exceptionDetails;
            if (message.error || details)
                finish(new Error(message.error?.message || details?.text || 'Antigravity rejected the prompt'));
            else
                finish(undefined);
        });
        ws.addEventListener('error', () => finish(new Error('Could not connect to the Antigravity window')));
    });
}

/**
 * Put `prompt` into the running Antigravity composer's input.
 *
 * Boundary: waits until the desktop app exposes a loopback page, then navigates that page to `/?q=&ws=`. The app
 * copies `q` into the input and removes it from the address bar. If the app is not running, this keeps returning null
 * until `timeoutMs`. It does not launch the app; the caller does that first.
 *
 * @param {{ prompt: string, workspaceDir?: string, timeoutMs?: number, userDataDir?: string }} input Prompt and optional project directory.
 * @returns {Promise<boolean>} True when the composer URL was applied.
 */
export async function injectAntigravityComposer(input: { prompt: string, workspaceDir?: string, timeoutMs?: number, userDataDir?: string }) {
    const userDataDir = input.userDataDir || antigravityUserDataDir();
    const deadline = Date.now() + (input.timeoutMs ?? 20000);
    let page = null;
    while (Date.now() < deadline) {
        page = await readAntigravityPage(userDataDir);
        if (page)
            break;
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!page)
        return false;
    const target = buildAntigravityComposerUrl(page.url, input.prompt, input.workspaceDir);
    await evaluateInPage(page.webSocketDebuggerUrl, antigravityNavigateExpression(target));
    return true;
}
