import path from 'node:path';
import type { LaunchArg } from './launch-script.js';

/** URL scheme registered by the global TRAE IDE (`Trae.app`). */
export const TRAE_SCHEME_INTL = 'trae';

/** URL scheme registered by the domestic TRAE CN IDE (`Trae CN.app`, `product.json` `urlProtocol`). */
export const TRAE_SCHEME_CN = 'trae-cn';

/** Default TRAE deeplink host (`product.json` `deeplinkHost`). */
export const DEFAULT_TRAE_AUTHORITY = 'trae.ai-ide';

/** Default TRAE Side AI Chat deeplink path (`workbench.action.chat.icube.open.fromUri`). */
export const DEFAULT_TRAE_ROUTE = 'side-chat';

/** Character cap enforced by TRAE's URI chat handler (`AI.chat.uriQuery.maxLength = 2000`). */
export const TRAE_URI_QUERY_LIMIT = 2000;

/** Default encoded URL length cap before switching to a file-pointer prompt. */
export const DEFAULT_TRAE_PROMPT_URL_LIMIT = 8000;

/** Availability reason when neither TRAE nor TRAE CN is installed. */
export const TRAE_APP_NOT_FOUND = 'TRAE IDE not found. Install TRAE (https://trae.ai or https://trae.cn) or set agents.traeApp.appPath.';

/** Availability reason when `traecli` is not installed. */
export const TRAE_CLI_NOT_FOUND = 'TRAE CLI (`traecli`) not found. Install TRAE CLI (https://trae.cn) and ensure `traecli` is on PATH.';

/** URL scheme syntax check (RFC 3986). */
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*$/i;

/** Deeplink authority syntax check. */
const AUTHORITY_PATTERN = /^[a-z0-9.-]+$/i;

/** Deeplink route path syntax check. */
const ROUTE_PATTERN = /^[a-z][a-z0-9/_-]*$/i;

/** Installed TRAE bundle candidate paired with the URL scheme that build registers. */
export interface TraeBundleCandidate {
    appPath: string;
    scheme: string;
}

/**
 * Trim a config value when it is a non-empty string, else return `undefined`.
 *
 * @param {unknown} raw Raw option value.
 * @returns {string | undefined} Trimmed string, or `undefined` when blank or non-string.
 */
function trimmedString(raw: unknown): string | undefined {
    if (typeof raw !== 'string')
        return undefined;
    const value = raw.trim();
    return value || undefined;
}

/**
 * Normalize the TRAE edition filter (`'auto'`, `'cn'`, or `'intl'`).
 *
 * @param {unknown} raw Raw `edition` option.
 * @returns {'auto' | 'cn' | 'intl'} Normalized edition selector.
 */
export function readTraeEdition(raw: unknown): 'auto' | 'cn' | 'intl' {
    if (raw === 'cn' || raw === 'intl')
        return raw;
    return 'auto';
}

/**
 * Validate a TRAE deeplink scheme (`trae` or `trae-cn`, or a custom build scheme).
 *
 * @param {string | undefined} scheme Candidate scheme.
 * @param {string} [fallback=TRAE_SCHEME_INTL] Default when `scheme` is omitted.
 * @returns {string} Validated scheme without trailing colon.
 */
export function normalizeTraeScheme(scheme: string | undefined, fallback = TRAE_SCHEME_INTL): string {
    const value = (scheme ?? fallback).trim().replace(/:$/, '');
    if (!SCHEME_PATTERN.test(value))
        throw new Error(`Invalid TRAE URL scheme: ${scheme}`);
    return value;
}

/**
 * Infer whether a custom `appPath` points at a `Trae CN` build or a global `Trae` build.
 *
 * @param {string} appPath Configured bundle path.
 * @param {'auto' | 'cn' | 'intl'} edition Configured edition preference.
 * @returns {string} Default URL scheme for that bundle.
 */
function schemeForPath(appPath: string, edition: 'auto' | 'cn' | 'intl'): string {
    if (edition === 'cn')
        return TRAE_SCHEME_CN;
    if (edition === 'intl')
        return TRAE_SCHEME_INTL;
    return /trae[\s_-]*cn/i.test(path.basename(appPath)) ? TRAE_SCHEME_CN : TRAE_SCHEME_INTL;
}

/**
 * Ordered TRAE desktop bundle candidates to probe on macOS and Windows.
 *
 * Boundary: `config.appPath` replaces the built-in list. `edition: 'cn'` probes only `Trae CN`; `edition: 'intl'`
 * probes only global `Trae`; `'auto'` probes global `Trae` and `Trae CN` so whichever is installed is found.
 *
 * @param {{ appPath?: unknown, edition?: unknown }} config Adapter config.
 * @param {{ platform: string, homedir: string, env?: NodeJS.ProcessEnv }} host Platform, home directory, and env.
 * @returns {TraeBundleCandidate[]} Bundle candidates paired with their registered URL scheme.
 */
export function traeAppCandidates(
    config: { appPath?: unknown; edition?: unknown } = {},
    host: { platform: string; homedir: string; env?: NodeJS.ProcessEnv },
): TraeBundleCandidate[] {
    const edition = readTraeEdition(config.edition);
    const custom = trimmedString(config.appPath);
    if (custom) {
        const resolved = path.resolve(custom);
        return [{ appPath: resolved, scheme: schemeForPath(resolved, edition) }];
    }
    if (host.platform === 'darwin') {
        const intl: TraeBundleCandidate[] = [
            { appPath: '/Applications/Trae.app', scheme: TRAE_SCHEME_INTL },
            { appPath: path.join(host.homedir, 'Applications', 'Trae.app'), scheme: TRAE_SCHEME_INTL },
        ];
        const cn: TraeBundleCandidate[] = [
            { appPath: '/Applications/Trae CN.app', scheme: TRAE_SCHEME_CN },
            { appPath: path.join(host.homedir, 'Applications', 'Trae CN.app'), scheme: TRAE_SCHEME_CN },
        ];
        if (edition === 'cn')
            return cn;
        if (edition === 'intl')
            return intl;
        return [...intl, ...cn];
    }
    const localAppData = trimmedString(host.env?.LOCALAPPDATA);
    if (host.platform === 'win32' && localAppData) {
        const intl: TraeBundleCandidate[] = [
            { appPath: path.win32.join(localAppData, 'Programs', 'Trae', 'Trae.exe'), scheme: TRAE_SCHEME_INTL },
            { appPath: path.win32.join(localAppData, 'Trae', 'Trae.exe'), scheme: TRAE_SCHEME_INTL },
        ];
        const cn: TraeBundleCandidate[] = [
            { appPath: path.win32.join(localAppData, 'Programs', 'Trae CN', 'Trae CN.exe'), scheme: TRAE_SCHEME_CN },
            { appPath: path.win32.join(localAppData, 'Trae CN', 'Trae CN.exe'), scheme: TRAE_SCHEME_CN },
        ];
        if (edition === 'cn')
            return cn;
        if (edition === 'intl')
            return intl;
        return [...intl, ...cn];
    }
    return [];
}

/**
 * Build the TRAE Side AI Chat deeplink (`<scheme>://trae.ai-ide/side-chat?query=…`).
 *
 * Boundary: TRAE's `workbench.action.chat.icube.open.fromUri` handler reads the `query` parameter (capped at 2000
 * characters) and opens the Side AI Chat composer with `addToChat: true` so the text is prefilled, not auto-sent.
 *
 * @param {{ scheme?: string, authority?: unknown, route?: unknown, prompt: string }} input Deeplink fields.
 * @returns {string} Encoded TRAE deeplink URL.
 */
export function buildTraeAppDeepLink(input: {
    scheme?: string;
    authority?: unknown;
    route?: unknown;
    prompt: string;
}): string {
    const scheme = normalizeTraeScheme(input.scheme);
    const authority = trimmedString(input.authority) ?? DEFAULT_TRAE_AUTHORITY;
    if (!AUTHORITY_PATTERN.test(authority))
        throw new Error(`Invalid TRAE deeplink authority: ${String(input.authority)}`);
    const route = (trimmedString(input.route) ?? DEFAULT_TRAE_ROUTE).replace(/^\/+|\/+$/g, '');
    if (!ROUTE_PATTERN.test(route))
        throw new Error(`Invalid TRAE deeplink route: ${String(input.route)}`);
    const url = new URL(`${scheme}://${authority}/${route}`);
    url.searchParams.set('query', input.prompt);
    return url.toString();
}

/**
 * Ordered CLI candidates for `trae-cli` (at most 4, matching `MAX_COMMAND_CANDIDATES`).
 *
 * Boundary: aligns with TRAE CLI 2.0's `install_v2.sh` layout (`$XDG_BIN_HOME/traecli` or `~/.local/bin/traecli`, plus
 * `~/.local/share/traecli/current/traex`).
 *
 * @param {{ command?: unknown }} config Adapter config.
 * @param {{ platform: string, homedir: string, env?: NodeJS.ProcessEnv }} host Platform, home directory, and env.
 * @returns {string[]} Up to 4 executable paths or PATH names.
 */
export function resolveTraeCliCommandCandidates(
    config: { command?: unknown } = {},
    host: { platform: string; homedir: string; env?: NodeJS.ProcessEnv },
): string[] {
    const custom = trimmedString(config.command);
    if (custom)
        return [custom];
    if (host.platform === 'win32') {
        const candidates = ['traecli', path.win32.join(host.homedir, '.local', 'bin', 'traecli.exe')];
        const localAppData = trimmedString(host.env?.LOCALAPPDATA);
        if (localAppData)
            candidates.push(path.win32.join(localAppData, 'traecli', 'bin', 'traecli.exe'));
        return candidates;
    }
    const binDir = trimmedString(host.env?.XDG_BIN_HOME) ?? path.posix.join(host.homedir, '.local', 'bin');
    const dataHome = trimmedString(host.env?.XDG_DATA_HOME) ?? path.posix.join(host.homedir, '.local', 'share');
    return [
        'traecli',
        path.posix.join(binDir, 'traecli'),
        path.posix.join(dataHome, 'traecli', 'current', 'traex'),
    ];
}

/**
 * Build argv entries for `traecli` in interactive TUI mode rooted at `cwd`.
 *
 * Boundary: `--print` is omitted so `traecli` stays in interactive TUI mode after sending the initial prompt.
 *
 * @param {string} cwd Working directory passed to `--cd`.
 * @param {{ permissionMode?: unknown }} [options] Optional CLI flags from adapter config.
 * @returns {LaunchArg[]} Ordered launcher arguments for `buildLauncherFile`.
 */
export function traeCliLauncherArgs(cwd: string, options: { permissionMode?: unknown } = {}): LaunchArg[] {
    const args: LaunchArg[] = [{ flag: '--cd' }, { value: cwd }];
    const permissionMode = trimmedString(options.permissionMode);
    if (permissionMode)
        args.push({ flag: '--permission-mode' }, { value: permissionMode });
    args.push({ endOfOptions: true }, { prompt: true });
    return args;
}
