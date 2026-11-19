import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** URL scheme the Antigravity desktop app registers (`CFBundleURLSchemes`). Antigravity IDE uses `antigravity-ide`. */
export const ANTIGRAVITY_SCHEME = 'antigravity';

/**
 * Default length budget for the prompt deep link.
 *
 * Boundary: Windows opens links through `cmd /c start`, whose whole command line is capped at 8191 characters, so the
 * default leaves room for the opener prefix. Longer links switch to a file pointer.
 */
export const DEFAULT_ANTIGRAVITY_PROMPT_URL_LIMIT = 8000;

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
 * Build the deep link that opens the Antigravity home composer with `prompt` in it.
 *
 * Boundary: the desktop app (2.33.0 checked) handles `antigravity://open?prompt=&project=`: it focuses or launches the
 * window, switches to the project, and appends the prompt to the home draft. It strips control and bidi characters but
 * keeps newlines. A blank `projectId` leaves the app on its current project. An app with a blocking dialog open
 * ignores the link.
 *
 * @param {{ prompt: string, projectId?: string }} input Prompt text and optional Antigravity project id
 *        (see `resolveAntigravityProject`).
 * @returns {string} Deep link URL.
 */
export function buildAntigravityDeepLink(input: { prompt: string, projectId?: string }) {
    let url = `${ANTIGRAVITY_SCHEME}://open?prompt=${encodeURIComponent(String(input.prompt ?? ''))}`;
    const projectId = typeof input.projectId === 'string' ? input.projectId.trim() : '';
    if (projectId)
        url += `&project=${encodeURIComponent(projectId)}`;
    return url;
}
