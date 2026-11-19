import path from 'node:path';
import { retainPathsInsideRoots } from './antigravity-ide-cli.js';
import type { LaunchArg } from './launch-script.js';
import type { HandoffPromptRequest } from './prompt-handoff.js';

/** Default URL scheme declared by Qoder IDE / Desktop (`qoder://`). */
export const DEFAULT_QODER_SCHEME = 'qoder';

/** Default Qoder deeplink handler authority (`aicoding.aicoding-deeplink`). */
export const DEFAULT_QODER_AUTHORITY = 'aicoding.aicoding-deeplink';

/** Default Qoder chat deeplink path (`/chat`). */
export const DEFAULT_QODER_ROUTE = 'chat';

/** Default encoded URL length cap before switching to a file-pointer prompt. */
export const DEFAULT_QODER_PROMPT_URL_LIMIT = 8000;

/** Availability reason when Qoder IDE / Desktop is not installed. */
export const QODER_APP_NOT_FOUND = 'Qoder not found. Install Qoder (https://qoder.com) or set agents.qoderApp.appPath.';

/** Availability reason when `qodercli` is not installed. */
export const QODER_CLI_NOT_FOUND = 'Qoder CLI (`qodercli`) not found. Install Qoder CLI (https://qoder.com/cli) and ensure `qodercli` is on PATH.';

/** URL scheme syntax check (RFC 3986). */
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*$/i;

/** Deeplink authority syntax check. */
const AUTHORITY_PATTERN = /^[a-z0-9.-]+$/i;

/** Deeplink route path syntax check. */
const ROUTE_PATTERN = /^[a-z][a-z0-9/_-]*$/i;

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
 * Normalize and validate the Qoder deeplink scheme.
 *
 * @param {unknown} scheme Optional configured scheme.
 * @returns {string} Validated scheme without trailing colon.
 */
export function normalizeQoderScheme(scheme: unknown): string {
    const value = (trimmedString(scheme) ?? DEFAULT_QODER_SCHEME).replace(/:$/, '');
    if (!SCHEME_PATTERN.test(value))
        throw new Error(`Invalid Qoder URL scheme: ${String(scheme)}`);
    return value;
}

/**
 * Installed Qoder desktop / IDE bundle paths to probe on macOS and Windows.
 *
 * Boundary: `config.appPath` overrides the defaults so a custom install path fails visibly when wrong.
 *
 * @param {{ appPath?: unknown }} config Adapter config.
 * @param {{ platform: string, homedir: string, env?: NodeJS.ProcessEnv }} host Platform, home directory, and env.
 * @returns {string[]} Absolute bundle paths to check with `fs.existsSync`.
 */
export function qoderAppCandidates(
    config: { appPath?: unknown } = {},
    host: { platform: string; homedir: string; env?: NodeJS.ProcessEnv },
): string[] {
    const custom = trimmedString(config.appPath);
    if (custom)
        return [path.resolve(custom)];
    if (host.platform === 'darwin') {
        return [
            '/Applications/Qoder.app',
            path.join(host.homedir, 'Applications', 'Qoder.app'),
        ];
    }
    const localAppData = trimmedString(host.env?.LOCALAPPDATA);
    if (host.platform === 'win32' && localAppData) {
        return [
            path.win32.join(localAppData, 'Programs', 'Qoder', 'Qoder.exe'),
            path.win32.join(localAppData, 'Qoder', 'Qoder.exe'),
        ];
    }
    return [];
}

/**
 * Build the Qoder chat deeplink (`qoder://aicoding.aicoding-deeplink/chat?text=…`).
 *
 * Boundary: `text` is required by Qoder's `/chat` handler; Qoder displays a review prompt and prefills the composer
 * without auto-sending. Invalid `scheme`, `authority`, or `route` values throw before any external opener runs.
 *
 * @param {{ scheme?: unknown, authority?: unknown, route?: unknown, prompt: string, mode?: unknown,
 *          isNewChat?: unknown }} input Deeplink fields.
 * @returns {string} Encoded Qoder deeplink URL.
 */
export function buildQoderAppDeepLink(input: {
    scheme?: unknown;
    authority?: unknown;
    route?: unknown;
    prompt: string;
    mode?: unknown;
    isNewChat?: unknown;
}): string {
    const scheme = normalizeQoderScheme(input.scheme);
    const authority = trimmedString(input.authority) ?? DEFAULT_QODER_AUTHORITY;
    if (!AUTHORITY_PATTERN.test(authority))
        throw new Error(`Invalid Qoder deeplink authority: ${String(input.authority)}`);
    const route = (trimmedString(input.route) ?? DEFAULT_QODER_ROUTE).replace(/^\/+|\/+$/g, '');
    if (!ROUTE_PATTERN.test(route))
        throw new Error(`Invalid Qoder deeplink route: ${String(input.route)}`);
    const url = new URL(`${scheme}://${authority}/${route}`);
    url.searchParams.set('text', input.prompt);
    const mode = trimmedString(input.mode);
    if (mode)
        url.searchParams.set('mode', mode);
    if (typeof input.isNewChat === 'boolean')
        url.searchParams.set('isNewChat', String(input.isNewChat));
    return url.toString();
}

/**
 * Ordered CLI candidates for `qoder-cli` (at most 4, matching `MAX_COMMAND_CANDIDATES`).
 *
 * Boundary: probes `qodercli` (not bare `qoder`, which can point at the Qoder IDE window launcher), plus user install
 * locations under `~/.local/bin` and `~/.qoder/bin` and `QODERCLI_PATH`.
 *
 * @param {{ command?: unknown }} config Adapter config.
 * @param {{ platform: string, homedir: string, env?: NodeJS.ProcessEnv }} host Platform, home directory, and env.
 * @returns {string[]} Up to 4 executable paths or PATH names.
 */
export function resolveQoderCliCommandCandidates(
    config: { command?: unknown } = {},
    host: { platform: string; homedir: string; env?: NodeJS.ProcessEnv },
): string[] {
    const custom = trimmedString(config.command);
    if (custom)
        return [custom];
    const envPath = trimmedString(host.env?.QODERCLI_PATH);
    const ext = host.platform === 'win32' ? '.exe' : '';
    const join = host.platform === 'win32' ? path.win32.join : path.posix.join;
    const candidates: string[] = [];
    if (envPath)
        candidates.push(envPath);
    candidates.push(
        'qodercli',
        join(host.homedir, '.local', 'bin', `qodercli${ext}`),
        join(host.homedir, '.qoder', 'bin', `qodercli${ext}`),
    );
    return candidates.slice(0, 4);
}

/**
 * Collect image artifacts (screenshots, pasted images, recording stills) contained inside trusted roots for
 * `qodercli --attachment`.
 *
 * Boundary: paths outside `roots` are dropped via {@link retainPathsInsideRoots}. Duplicates are skipped.
 *
 * @param {HandoffPromptRequest} request Normalized intent request.
 * @param {string[]} roots Trusted directories (`context.projectRoot`, `context.outputDir`, agent `cwd`).
 * @returns {string[]} Validated absolute image paths.
 */
export function collectQoderCliAttachments(request: HandoffPromptRequest, roots: string[]): string[] {
    const files: string[] = [];
    const add = (candidate: unknown) => {
        if (typeof candidate === 'string' && candidate && !files.includes(candidate))
            files.push(candidate);
    };
    const singleShot = request.screenshot ? [request.screenshot] : [];
    const screenshots = request.screenshots?.length ? request.screenshots : singleShot;
    for (const shot of screenshots)
        add(shot?.filePath);
    if (Array.isArray(request.recordings)) {
        for (const clip of request.recordings)
            add(clip?.stillFramePath);
    }
    return retainPathsInsideRoots(files, roots);
}

/**
 * Build argv entries for `qodercli` in interactive TUI mode (`--prompt-interactive=…`).
 *
 * Boundary: bare positional prompts run Qoder CLI in non-interactive mode and exit; `--prompt-interactive=` executes
 * the initial prompt and keeps the interactive TUI open.
 *
 * @param {{ permissionMode?: unknown, model?: unknown, attachments?: readonly string[] }} [options] CLI options.
 * @returns {LaunchArg[]} Ordered launcher arguments for `buildLauncherFile`.
 */
export function qoderCliLauncherArgs(options: {
    permissionMode?: unknown;
    model?: unknown;
    attachments?: readonly string[];
} = {}): LaunchArg[] {
    const args: LaunchArg[] = [];
    const permissionMode = trimmedString(options.permissionMode);
    if (permissionMode)
        args.push({ flag: '--permission-mode' }, { value: permissionMode });
    const model = trimmedString(options.model);
    if (model)
        args.push({ flag: '--model' }, { value: model });
    for (const file of options.attachments ?? [])
        args.push({ flag: '--attachment' }, { value: file });
    args.push({ prompt: true, prefix: '--prompt-interactive=' });
    return args;
}
