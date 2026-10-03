import path from 'node:path';
import type { LaunchArg } from './launch-script.js';

/** URL scheme the OpenCode desktop app registers. */
export const OPENCODE_SCHEME = 'opencode';

/**
 * Desktop major versions whose `opencode://new-session` deeplink is handled.
 *
 * Boundary: 2.x (beta, 2.0.6) still registers the scheme but its renderer has no listener, so the URL is dropped
 * silently; `auto` sends 2.x to the Terminal route. Add a major here once its desktop handles the link again.
 */
export const OPENCODE_DEEPLINK_MAJORS: readonly number[] = [1];

/** App route: an encoded deeplink longer than this switches to a file-pointer prompt. */
export const DEFAULT_OPENCODE_PROMPT_URL_LIMIT = 8000;

/** Most bytes of `Info.plist` read while looking for the version. */
export const OPENCODE_PLIST_READ_LIMIT = 64 * 1024;

/** Default CLI binary name when `opencode.command` is omitted. */
export const DEFAULT_OPENCODE_COMMAND = 'opencode';

/** Tooltip when neither a deeplink-capable desktop app nor a CLI is found. */
export const OPENCODE_NOT_FOUND = 'OpenCode not found. Install the desktop app or the "opencode" CLI (https://opencode.ai/download)';

/** How a send reaches OpenCode: the desktop deeplink (prefilled), or a Terminal launcher (submitted). */
export type OpenCodeLaunch = 'auto' | 'app' | 'terminal';

/** Outcome of {@link pickOpenCodeRoute}. */
export type OpenCodeRoute = { route: 'app' } | { route: 'terminal' } | { route: 'unavailable' };

/**
 * Normalize `launch` from config. Anything other than `app` / `terminal` is `auto`.
 *
 * @param {unknown} value `opencode.launch`.
 * @returns {OpenCodeLaunch} The route policy.
 */
export function readOpenCodeLaunch(value: unknown): OpenCodeLaunch {
    return value === 'app' || value === 'terminal' ? value : 'auto';
}

/**
 * Major version from the start of an app bundle's `Info.plist`.
 *
 * Boundary: only XML plists are read; a binary plist (`bplist…`), a missing key, or a non-numeric version is null,
 * which `auto` treats like an unknown version (Terminal route).
 *
 * @param {string} plist File text (the first {@link OPENCODE_PLIST_READ_LIMIT} bytes are enough).
 * @returns {number | null} `CFBundleShortVersionString` major, or null.
 */
export function parseOpenCodeBundleMajor(plist: string) {
    if (plist.startsWith('bplist'))
        return null;
    const match = /<key>CFBundleShortVersionString<\/key>\s*<string>(\d+)\./.exec(plist);
    return match ? Number(match[1]) : null;
}

/**
 * Choose how this send reaches OpenCode.
 *
 * Boundary: pure. `auto` uses the desktop deeplink only on macOS with a desktop major in
 * {@link OPENCODE_DEEPLINK_MAJORS} (other platforms are not version-checked), else the Terminal launcher. `app` sends
 * the deeplink without any check (for 1.x desktops on Windows / Linux); `terminal` only uses the launcher.
 *
 * @param {{ launch: OpenCodeLaunch, platform: string, desktopMajor: number | null, cliAvailable: boolean }} input
 *        Policy plus what was detected. `desktopMajor` is null when no app or no readable version was found.
 * @returns {OpenCodeRoute} The route, or `unavailable`.
 */
export function pickOpenCodeRoute(input: { launch: OpenCodeLaunch, platform: string, desktopMajor: number | null, cliAvailable: boolean }): OpenCodeRoute {
    if (input.launch === 'app')
        return { route: 'app' };
    const linkable = input.launch === 'auto' && input.platform === 'darwin'
        && input.desktopMajor !== null && OPENCODE_DEEPLINK_MAJORS.includes(input.desktopMajor);
    if (linkable)
        return { route: 'app' };
    return input.cliAvailable ? { route: 'terminal' } : { route: 'unavailable' };
}

/**
 * Build `opencode://new-session?directory=<dir>&prompt=<prompt>`.
 *
 * Boundary: values go through `encodeURIComponent` (`%20` for a space, `%2B` for `+`), so they decode the same with
 * `decodeURIComponent` and `URLSearchParams`. The desktop prefills the prompt and ignores the link unless it is
 * connected to a local server. `directory` must be absolute.
 *
 * @param {{ directory: string, prompt: string }} input Project folder and prompt to prefill.
 * @returns {string} Deeplink URL.
 */
export function buildOpenCodeDeepLink(input: { directory: string, prompt: string }) {
    return `${OPENCODE_SCHEME}://new-session?directory=${encodeURIComponent(input.directory)}&prompt=${encodeURIComponent(input.prompt)}`;
}

/**
 * Arguments after the binary for the Terminal route: `<directory> --prompt=<prompt>`.
 *
 * Boundary: the prompt is glued to `--prompt=` as one argument, so a prompt that starts with `-` cannot be read as a
 * flag by either CLI generation (effect/cli in 2.x, yargs in 1.x). Both TUIs submit it once the model is ready.
 *
 * @param {string} directory Project folder the session opens in.
 * @returns {LaunchArg[]} Launcher arguments.
 */
export function openCodeLauncherArgs(directory: string): LaunchArg[] {
    return [{ value: directory }, { prompt: true, prefix: '--prompt=' }];
}

/**
 * Desktop app bundles to look for, in order. Only macOS bundles are checked.
 *
 * Boundary: a non-blank `appPath` replaces the defaults (`/Applications/OpenCode.app`, `~/Applications/OpenCode.app`).
 * Other platforms return `[]`: their desktop version is not detected, so `auto` uses the CLI there.
 *
 * @param {{ appPath?: unknown }} config OpenCode config.
 * @param {{ platform: string, homedir: string }} host Platform and home directory.
 * @returns {string[]} Absolute bundle paths.
 */
export function openCodeAppCandidates(config: { appPath?: unknown }, host: { platform: string, homedir: string }) {
    if (host.platform !== 'darwin')
        return [];
    if (typeof config.appPath === 'string' && config.appPath.trim())
        return [path.resolve(config.appPath.trim())];
    return ['/Applications/OpenCode.app', path.join(host.homedir, 'Applications', 'OpenCode.app')];
}

/**
 * CLI candidates for the Terminal route, in probe order.
 *
 * Boundary: a non-blank `command` replaces the defaults. Otherwise `opencode` on PATH, the install script's
 * `~/.opencode/bin/opencode`, then the CLI bundled inside the desktop app (2.x ships `Contents/Resources/opencode-cli`),
 * so a desktop-only install is still usable.
 *
 * @param {{ command?: unknown }} config OpenCode config.
 * @param {{ homedir: string, appPath?: string | null }} host Home directory and the installed bundle, if any.
 * @returns {string[]} Ordered candidates (at most three).
 */
export function resolveOpenCodeCommandCandidates(config: { command?: unknown }, host: { homedir: string, appPath?: string | null }) {
    if (typeof config.command === 'string' && config.command.trim())
        return [config.command.trim()];
    const candidates = [DEFAULT_OPENCODE_COMMAND, path.join(host.homedir, '.opencode', 'bin', DEFAULT_OPENCODE_COMMAND)];
    if (host.appPath)
        candidates.push(path.join(host.appPath, 'Contents', 'Resources', 'opencode-cli'));
    return candidates;
}
