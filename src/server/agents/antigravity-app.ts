import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Where the Antigravity desktop app writes `DevToolsActivePort`.
 *
 * Boundary: this is the Electron user-data directory, not the project. A wrong platform string looks in the wrong
 * home folder and the composer injection never finds the window.
 *
 * @param {string} [platform=process.platform] Node platform id.
 * @param {string} [homedir=os.homedir()] User home directory.
 * @param {NodeJS.ProcessEnv} [env=process.env] Environment, used for Windows `%APPDATA%`.
 * @returns {string} Absolute directory that contains `DevToolsActivePort` when the app is running.
 */
export function antigravityUserDataDir(platform = process.platform, homedir = os.homedir(), env: NodeJS.ProcessEnv = process.env) {
    if (platform === 'darwin')
        return path.join(homedir, 'Library', 'Application Support', 'Antigravity');
    if (platform === 'win32')
        return path.join(env.APPDATA || homedir, 'Antigravity');
    return path.join(homedir, '.config', 'Antigravity');
}

/**
 * Installed Antigravity.app / executable paths, in probe order.
 *
 * Boundary: these are the desktop app, not the `agy` CLI. A missing install returns the candidates anyway; callers
 * check `fs.existsSync`. `platform` / `homedir` / `env` are injectable so tests do not depend on this machine.
 *
 * @param {string} [platform=process.platform] Node platform id.
 * @param {string} [homedir=os.homedir()] User home directory.
 * @param {NodeJS.ProcessEnv} [env=process.env] Environment, used for Windows install paths.
 * @returns {string[]} Absolute app paths to try.
 */
export function antigravityAppCandidates(platform = process.platform, homedir = os.homedir(), env: NodeJS.ProcessEnv = process.env) {
    if (platform === 'darwin') {
        return [
            '/Applications/Antigravity.app',
            path.join(homedir, 'Applications', 'Antigravity.app'),
        ];
    }
    if (platform === 'win32' && env.LOCALAPPDATA) {
        return [
            path.join(env.LOCALAPPDATA, 'Programs', 'Antigravity', 'Antigravity.exe'),
            path.join(env.LOCALAPPDATA, 'Antigravity', 'Antigravity.exe'),
        ];
    }
    return [];
}

/**
 * First installed desktop app path.
 *
 * @param {string} [platform=process.platform] Node platform id.
 * @param {string} [homedir=os.homedir()] User home directory.
 * @param {NodeJS.ProcessEnv} [env=process.env] Environment for Windows paths.
 * @param {(file: string) => boolean} [exists=fs.existsSync] Install check.
 * @returns {string | null} App path, or null when none of the candidates exist.
 */
export function resolveAntigravityApp(platform = process.platform, homedir = os.homedir(), env: NodeJS.ProcessEnv = process.env, exists: (file: string) => boolean = fs.existsSync) {
    return antigravityAppCandidates(platform, homedir, env).find((candidate) => exists(candidate)) ?? null;
}

/**
 * Parse Electron's `DevToolsActivePort` file.
 *
 * Boundary: the first line is the port and the second is the browser websocket path. A blank or non-numeric port
 * returns null so a stale file does not send the prompt to a random local port.
 *
 * @param {string} text File contents.
 * @returns {{ port: number, browserPath: string } | null} Parsed endpoint, or null when the file is unusable.
 */
export function parseDevToolsActivePort(text: string) {
    const [portLine = '', browserPath = ''] = String(text ?? '').split(/\r?\n/);
    const port = Number(portLine.trim());
    if (!Number.isInteger(port) || port <= 0 || port > 65535)
        return null;
    return { port, browserPath: browserPath.trim() };
}

/**
 * Build the in-app URL that prefills the Antigravity composer.
 *
 * Boundary: the Antigravity window reads `q` into its input and `ws` as the workspace, then strips `q` from the
 * address bar. The result stays on the page's own loopback origin. Any other host is rejected so a tampered page URL
 * cannot be used to navigate somewhere else. `workspaceDir` must be an absolute filesystem path; it is encoded as a
 * `file:` URL.
 *
 * @param {string} pageUrl Current Antigravity page URL (`https://127.0.0.1:<port>/`).
 * @param {string} prompt Prompt text placed in the composer. An empty string still navigates, but the app ignores an empty `q`.
 * @param {string} [workspaceDir] Project directory the composer should bind to.
 * @returns {string} Absolute URL on the same origin.
 */
export function buildAntigravityComposerUrl(pageUrl: string, prompt: string, workspaceDir?: string) {
    const current = new URL(pageUrl);
    if (current.protocol !== 'https:' && current.protocol !== 'http:')
        throw new Error('Unexpected Antigravity page URL');
    if (current.hostname !== '127.0.0.1' && current.hostname !== 'localhost')
        throw new Error('Refusing to navigate a non-local Antigravity page');
    const next = new URL('/', current.origin);
    next.searchParams.set('q', String(prompt ?? ''));
    if (typeof workspaceDir === 'string' && workspaceDir.trim())
        next.searchParams.set('ws', pathToFileURL(workspaceDir).href);
    return next.toString();
}

/**
 * Pick the Antigravity composer page out of a DevTools `/json/list` payload.
 *
 * Boundary: only an `https`/`http` page on loopback is eligible. Extension pages, devtools pages, and remote URLs
 * are ignored. When several local pages exist, the first one is used.
 *
 * @param {unknown} list Parsed `/json/list` body.
 * @returns {{ url: string, webSocketDebuggerUrl: string } | null} Page to navigate, or null.
 */
export function selectAntigravityPage(list: unknown) {
    if (!Array.isArray(list))
        return null;
    for (const entry of list) {
        if (!entry || entry.type !== 'page' || typeof entry.url !== 'string' || typeof entry.webSocketDebuggerUrl !== 'string')
            continue;
        try {
            const url = new URL(entry.url);
            if ((url.protocol === 'https:' || url.protocol === 'http:')
                && (url.hostname === '127.0.0.1' || url.hostname === 'localhost'))
                return { url: entry.url, webSocketDebuggerUrl: entry.webSocketDebuggerUrl };
        }
        catch {
            // Skip malformed targets.
        }
    }
    return null;
}

/**
 * JavaScript that navigates the Antigravity window onto the composer URL.
 *
 * Boundary: `targetUrl` is embedded with `JSON.stringify`, so the prompt cannot break out of the string. The
 * expression only assigns `location.href`.
 *
 * @param {string} targetUrl URL from {@link buildAntigravityComposerUrl}.
 * @returns {string} Expression for `Runtime.evaluate`.
 */
export function antigravityNavigateExpression(targetUrl: string) {
    return `location.href = ${JSON.stringify(targetUrl)}`;
}
