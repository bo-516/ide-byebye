import path from 'node:path';
import type { LaunchArg } from './launch-script.js';

/** Default URL scheme registered by `WorkBuddy AI.app` (`CFBundleURLSchemes`). */
export const DEFAULT_WORKBUDDY_SCHEME = 'workbuddy-ai';

/** Legacy URL scheme registered by older `WorkBuddy.app` builds without the `AI` suffix. */
export const LEGACY_WORKBUDDY_SCHEME = 'workbuddy';

/** Deeplink host parsed by WorkBuddy's `parseTaskUrl` (`<scheme>://task?action=start&…`). */
export const WORKBUDDY_TASK_HOST = 'task';

/** Required `action` query value for WorkBuddy's task-prefill deeplink. */
export const WORKBUDDY_TASK_ACTION = 'start';

/** Character cap enforced by WorkBuddy's `parseDeeplink` (`prompt.length > 8000` is truncated by the app). */
export const WORKBUDDY_PROMPT_TEXT_LIMIT = 8000;

/** Default encoded URL length cap before switching to a file-pointer prompt (leaves room for Windows `cmd /c start`). */
export const DEFAULT_WORKBUDDY_PROMPT_URL_LIMIT = 8000;

/** Availability reason when no WorkBuddy desktop app is found. */
export const WORKBUDDY_APP_NOT_FOUND = 'WorkBuddy desktop app not found. Install WorkBuddy (https://workbuddy.cn) or set agents.workbuddyApp.appPath.';

/** Availability reason when neither `codebuddy` nor a WorkBuddy desktop bundle CLI is found. */
export const WORKBUDDY_CLI_NOT_FOUND = 'WorkBuddy CLI (`codebuddy`) not found. Install WorkBuddy or `@tencent-ai/codebuddy-code` and ensure `codebuddy` is on PATH.';

/** Valid `welcomeMode` values accepted by WorkBuddy's `parseDeeplink`. */
const WORKBUDDY_WELCOME_MODES = new Set(['code', 'work', 'design']);

/** Valid `permissionMode` values accepted by WorkBuddy's `parseDeeplink`. */
const WORKBUDDY_PERMISSION_MODES = new Set(['default', 'fullAccess']);

/** URL scheme syntax check (RFC 3986). */
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*$/i;

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
 * Normalize and validate a WorkBuddy URL scheme.
 *
 * Boundary: strips a trailing colon and rejects malformed schemes before any external opener runs.
 *
 * @param {string | undefined} scheme Optional scheme override.
 * @param {string} fallback Default scheme when `scheme` is omitted.
 * @returns {string} Validated scheme without a trailing colon.
 */
export function normalizeWorkBuddyScheme(scheme: string | undefined, fallback = DEFAULT_WORKBUDDY_SCHEME): string {
    const value = (scheme ?? fallback).trim().replace(/:$/, '');
    if (!SCHEME_PATTERN.test(value))
        throw new Error(`Invalid WorkBuddy URL scheme: ${scheme}`);
    return value;
}

/**
 * Installed WorkBuddy desktop app paths to probe, in priority order.
 *
 * Boundary: `config.appPath` wins and replaces the defaults so a custom path fails visibly when wrong. Newer builds
 * install as `WorkBuddy AI.app` / `WorkBuddy AI.exe`; older builds install as `WorkBuddy.app` / `WorkBuddy.exe`.
 *
 * @param {{ appPath?: unknown }} config Adapter config.
 * @param {{ platform: string, homedir: string, env?: NodeJS.ProcessEnv }} host Platform, home directory, and env.
 * @returns {string[]} Absolute app paths to check with `fs.existsSync`.
 */
export function workBuddyAppCandidates(
    config: { appPath?: unknown } = {},
    host: { platform: string; homedir: string; env?: NodeJS.ProcessEnv },
): string[] {
    const custom = trimmedString(config.appPath);
    if (custom)
        return [path.resolve(custom)];
    if (host.platform === 'darwin') {
        return [
            '/Applications/WorkBuddy AI.app',
            path.join(host.homedir, 'Applications', 'WorkBuddy AI.app'),
            '/Applications/WorkBuddy.app',
            path.join(host.homedir, 'Applications', 'WorkBuddy.app'),
        ];
    }
    const localAppData = trimmedString(host.env?.LOCALAPPDATA);
    if (host.platform === 'win32' && localAppData) {
        return [
            path.win32.join(localAppData, 'Programs', 'WorkBuddy AI', 'WorkBuddy AI.exe'),
            path.win32.join(localAppData, 'WorkBuddy AI', 'WorkBuddy AI.exe'),
            path.win32.join(localAppData, 'Programs', 'WorkBuddy', 'WorkBuddy.exe'),
            path.win32.join(localAppData, 'WorkBuddy', 'WorkBuddy.exe'),
        ];
    }
    return [];
}

/**
 * Infer the URL scheme for an installed WorkBuddy bundle when `config.scheme` is not set.
 *
 * Boundary: `WorkBuddy AI.app` / `WorkBuddy AI.exe` registers `workbuddy-ai`; legacy `WorkBuddy.app` / `WorkBuddy.exe`
 * registers `workbuddy`. Unknown or missing bundle paths default to `workbuddy-ai`.
 *
 * @param {{ scheme?: unknown }} config Adapter config.
 * @param {string | null} appPath Resolved desktop bundle path, if any.
 * @returns {string} Validated URL scheme.
 */
export function resolveWorkBuddyScheme(config: { scheme?: unknown } = {}, appPath: string | null = null): string {
    const explicit = trimmedString(config.scheme);
    if (explicit)
        return normalizeWorkBuddyScheme(explicit);
    const base = appPath ? path.basename(appPath).toLowerCase() : '';
    const fallback = base === 'workbuddy.app' || base === 'workbuddy.exe'
        ? LEGACY_WORKBUDDY_SCHEME
        : DEFAULT_WORKBUDDY_SCHEME;
    return normalizeWorkBuddyScheme(undefined, fallback);
}

/**
 * Build a WorkBuddy task-prefill deeplink (`<scheme>://task?action=start&…`).
 *
 * Boundary: WorkBuddy's `TaskDeeplinkCoordinator` prepares a new task in `cwd` with `prompt` prefilled in the composer
 * (not auto-submitted). `welcomeMode` defaults to `'code'` so coding workspace controls are shown; invalid enum values
 * are omitted rather than triggering renderer warnings.
 *
 * @param {{ scheme?: string, prompt: string, cwd?: string, welcomeMode?: unknown, mode?: unknown, model?: unknown,
 *          permissionMode?: unknown }} input Deeplink fields.
 * @returns {string} Encoded WorkBuddy task deeplink.
 */
export function buildWorkBuddyAppDeepLink(input: {
    scheme?: string;
    prompt: string;
    cwd?: string;
    welcomeMode?: unknown;
    mode?: unknown;
    model?: unknown;
    permissionMode?: unknown;
}): string {
    const scheme = normalizeWorkBuddyScheme(input.scheme);
    const url = new URL(`${scheme}://${WORKBUDDY_TASK_HOST}`);
    url.searchParams.set('action', WORKBUDDY_TASK_ACTION);
    url.searchParams.set('prompt', input.prompt);
    if (input.cwd)
        url.searchParams.set('cwd', input.cwd);
    const rawWelcome = trimmedString(input.welcomeMode);
    const welcomeMode = rawWelcome && WORKBUDDY_WELCOME_MODES.has(rawWelcome) ? rawWelcome : 'code';
    url.searchParams.set('welcomeMode', welcomeMode);
    const mode = trimmedString(input.mode);
    if (mode)
        url.searchParams.set('mode', mode);
    const model = trimmedString(input.model);
    if (model)
        url.searchParams.set('model', model);
    const perm = trimmedString(input.permissionMode);
    if (perm && WORKBUDDY_PERMISSION_MODES.has(perm))
        url.searchParams.set('permissionMode', perm);
    return url.toString();
}

/**
 * Ordered CLI candidates for `workbuddy-cli` (at most 4, matching `MAX_COMMAND_CANDIDATES`).
 *
 * Boundary: an explicit `config.command` replaces the fallback chain. Otherwise `codebuddy` on PATH is tried first,
 * followed by `~/.local/bin/codebuddy`, `~/.codebuddy/bin/codebuddy`, and the CLI unpacked inside the WorkBuddy app.
 *
 * @param {{ command?: unknown }} config Adapter config.
 * @param {{ platform: string, homedir: string, appPath?: string | null }} host Platform, home directory, and found app.
 * @returns {string[]} Up to 4 executable paths or PATH names.
 */
export function resolveWorkBuddyCliCommandCandidates(
    config: { command?: unknown } = {},
    host: { platform: string; homedir: string; appPath?: string | null },
): string[] {
    const custom = trimmedString(config.command);
    if (custom)
        return [custom];
    const ext = host.platform === 'win32' ? '.exe' : '';
    const join = host.platform === 'win32' ? path.win32.join : path.posix.join;
    const candidates = [
        'codebuddy',
        join(host.homedir, '.local', 'bin', `codebuddy${ext}`),
        join(host.homedir, '.codebuddy', 'bin', `codebuddy${ext}`),
    ];
    if (host.appPath) {
        const bundled = host.platform === 'win32'
            ? path.win32.join(path.win32.dirname(host.appPath), 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.exe')
            : path.posix.join(host.appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy');
        candidates.push(bundled);
    }
    return candidates;
}

/**
 * Build argv entries for `codebuddy` in interactive REPL mode with an initial prompt.
 *
 * Boundary: `-p` / `--print` is intentionally omitted so `codebuddy` stays interactive after the initial turn. `--`
 * separates flags from a prompt that might start with `-`.
 *
 * @param {{ permissionMode?: unknown, model?: unknown }} options Optional CLI flags from adapter config.
 * @returns {LaunchArg[]} Ordered launcher arguments for `buildLauncherFile`.
 */
export function workBuddyCliLauncherArgs(options: { permissionMode?: unknown; model?: unknown } = {}): LaunchArg[] {
    const args: LaunchArg[] = [];
    const permissionMode = trimmedString(options.permissionMode);
    if (permissionMode)
        args.push({ flag: '--permission-mode' }, { value: permissionMode });
    const model = trimmedString(options.model);
    if (model)
        args.push({ flag: '--model' }, { value: model });
    args.push({ endOfOptions: true }, { prompt: true });
    return args;
}
