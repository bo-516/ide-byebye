import type { LaunchArg } from './launch-script.js';

/** URL scheme the Claude Code CLI registers for itself. */
export const CLAUDE_CLI_SCHEME = 'claude-cli';

/**
 * Longest `q` the `claude-cli://open` handler accepts, in UTF-16 units after its own clean-up (trim, NFKC, format
 * characters removed). Longer links are rejected, not truncated (Claude Code 2.1.286).
 */
export const CLAUDE_CLI_QUERY_LIMIT = 5000;

/** Longest `cwd` the handler accepts. */
export const CLAUDE_CLI_CWD_LIMIT = 4096;

/**
 * Longest deeplink sent through `cmd /c start` on Windows. cmd's command line stops at 8191 characters, so a longer
 * link would be cut before the handler sees it; `auto` uses the Terminal route instead.
 */
export const WINDOWS_START_URL_LIMIT = 8000;

/** Default CLI binary name when `claudeCli.command` is omitted. */
export const DEFAULT_CLAUDE_CLI_COMMAND = 'claude';

/** How a send reaches Claude Code: the prefilled deeplink, or a Terminal launcher that submits the prompt. */
export type ClaudeCliLaunch = 'auto' | 'deeplink' | 'terminal';

/**
 * Outcome of {@link pickClaudeCliRoute}. `pointer` means the prompt must first become a file pointer. `unavailable`
 * names what is missing: the handler, the CLI, both (`missing`), or a cwd the handler would reject.
 */
export type ClaudeCliRoute =
    | { route: 'deeplink', pointer: boolean }
    | { route: 'terminal' }
    | { route: 'unavailable', reason: 'handler' | 'cli' | 'missing' | 'cwd' };

/** Control characters the handler rejects in `q`; `\t` and `\n` are allowed, `\r` becomes `\n` first. */
// eslint-disable-next-line no-control-regex -- deliberate: enumerates exactly the control range the deeplink handler rejects.
const QUERY_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;
/** Characters the handler strips from `q` before measuring it: format, private-use, and unassigned code points. */
const QUERY_STRIPPED = /[\p{Cf}\p{Co}\p{Cn}]/gu;
/** Characters the handler rejects in `cwd`: controls, invisible and bidirectional marks, and similar blanks. */
const CWD_FORBIDDEN = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029\u2800\uFFF9-\uFFFB]/u;

/**
 * Normalize `launch` from config. Anything other than `deeplink` / `terminal` is `auto`.
 *
 * @param {unknown} value `claudeCli.launch`.
 * @returns {ClaudeCliLaunch} The route policy.
 */
export function readClaudeCliLaunch(value: unknown): ClaudeCliLaunch {
    return value === 'deeplink' || value === 'terminal' ? value : 'auto';
}

/**
 * Whether the handler would reject `prompt` as `q`, mirroring its checks.
 *
 * Boundary: the length is measured the way the handler does (trim, CR/CRLF → LF, NFKC, format characters dropped),
 * so it can only overestimate. The prompt itself is sent unchanged; the handler does its own clean-up.
 *
 * @param {string} prompt Prompt that would become `q`.
 * @returns {'length' | 'control' | null} The first problem found, or null when the handler accepts it.
 */
export function claudeCliQueryProblem(prompt: string): 'length' | 'control' | null {
    const cleaned = prompt.trim().replace(/\r\n?/g, '\n').normalize('NFKC').replace(QUERY_STRIPPED, '');
    if (QUERY_CONTROL.test(cleaned))
        return 'control';
    return cleaned.length > CLAUDE_CLI_QUERY_LIMIT ? 'length' : null;
}

/**
 * Whether the handler accepts `cwd`: absolute (`/…` or `X:\…`), not UNC, no `..` segment, no control or invisible
 * characters, at most {@link CLAUDE_CLI_CWD_LIMIT} characters.
 *
 * Boundary: the handler also rejects a path that resolves through a network link; that needs the filesystem and is not
 * checked here. A rejected cwd makes `auto` use the Terminal route.
 *
 * @param {string} cwd Working directory for the new session.
 * @returns {boolean} True when the deeplink may carry it.
 */
export function isClaudeCliCwdAllowed(cwd: string) {
    if (!cwd || cwd.length > CLAUDE_CLI_CWD_LIMIT)
        return false;
    if (cwd.startsWith('\\\\') || cwd.startsWith('//'))
        return false;
    if (!cwd.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(cwd))
        return false;
    if (cwd.split(/[\\/]/).includes('..'))
        return false;
    return !CWD_FORBIDDEN.test(cwd);
}

/**
 * Build `claude-cli://open?cwd=<cwd>&q=<prompt>`.
 *
 * Boundary: both values go through `encodeURIComponent`, so a space is `%20` and `+` is `%2B`; the handler reads them
 * with `URLSearchParams`, which would turn a raw `+` into a space. The prompt is not trimmed or shortened here — check
 * it with {@link claudeCliQueryProblem} first.
 *
 * @param {{ cwd: string, prompt: string }} input Session directory and prompt to prefill.
 * @returns {string} Deeplink URL.
 */
export function buildClaudeCliDeepLink(input: { cwd: string, prompt: string }) {
    return `${CLAUDE_CLI_SCHEME}://open?cwd=${encodeURIComponent(input.cwd)}&q=${encodeURIComponent(input.prompt)}`;
}

/**
 * Choose how this send reaches Claude Code.
 *
 * Boundary: pure. `auto` prefers the deeplink (the user's own terminal, prefilled, sent by pressing Enter) whenever
 * the handler is registered and both the prompt and cwd are accepted; otherwise the Terminal launcher; with no CLI, a
 * deeplink carrying a file pointer. `deeplink` never falls back to the launcher and `terminal` never opens a link.
 *
 * @param {{ launch: ClaudeCliLaunch, handlerRegistered: boolean, cliAvailable: boolean, cwdAllowed: boolean,
 *         promptFits: boolean }} input Policy plus what was detected. `promptFits` is about the prompt as it would be
 *         sent (already a pointer under `promptMode: "file"`). `cliAvailable` is only read when the deeplink cannot
 *         carry the full prompt.
 * @returns {ClaudeCliRoute} The route, or what is missing.
 */
export function pickClaudeCliRoute(input: {
    launch: ClaudeCliLaunch,
    handlerRegistered: boolean,
    cliAvailable: boolean,
    cwdAllowed: boolean,
    promptFits: boolean,
}): ClaudeCliRoute {
    const linkable = input.handlerRegistered && input.cwdAllowed;
    if (input.launch === 'terminal')
        return input.cliAvailable ? { route: 'terminal' } : { route: 'unavailable', reason: 'cli' };
    if (input.launch === 'deeplink') {
        if (!input.handlerRegistered)
            return { route: 'unavailable', reason: 'handler' };
        return input.cwdAllowed ? { route: 'deeplink', pointer: !input.promptFits } : { route: 'unavailable', reason: 'cwd' };
    }
    if (linkable && input.promptFits)
        return { route: 'deeplink', pointer: false };
    if (input.cliAvailable)
        return { route: 'terminal' };
    if (linkable)
        return { route: 'deeplink', pointer: true };
    return { route: 'unavailable', reason: input.handlerRegistered ? 'cwd' : 'missing' };
}

/**
 * Arguments after the binary for the Terminal route: `[--permission-mode <mode>] -- <prompt>`.
 *
 * Boundary: `--` ends option parsing, so a prompt starting with `-` is still the prompt. A blank mode is omitted and
 * the CLI keeps its own default.
 *
 * @param {unknown} permissionMode `claudeCli.permissionMode`.
 * @returns {LaunchArg[]} Launcher arguments.
 */
export function claudeCliLauncherArgs(permissionMode: unknown): LaunchArg[] {
    const mode = typeof permissionMode === 'string' ? permissionMode.trim() : '';
    return [
        ...(mode ? [{ flag: '--permission-mode' }, { value: mode }] : []),
        { endOfOptions: true },
        { prompt: true },
    ];
}

/** Tooltip when neither the handler nor the CLI is found (`launch: 'auto'`). */
export const CLAUDE_CLI_NOT_FOUND = 'Claude Code CLI not found. Install it (https://code.claude.com), or run "claude" once and send a prompt to register claude-cli://';

/**
 * Text for a send or availability check that has no usable route.
 *
 * @param {'handler' | 'cli' | 'missing' | 'cwd'} reason What is missing (see {@link ClaudeCliRoute}).
 * @param {string} [cwd] Session directory, named when the handler rejects it.
 * @returns {string} Message safe to show on the page.
 */
export function claudeCliUnavailableMessage(reason: 'handler' | 'cli' | 'missing' | 'cwd', cwd = '') {
    if (reason === 'handler')
        return 'claude-cli:// is not registered. Run "claude" once and send a prompt to register it, or set agents.claudeCli.launch to "auto".';
    if (reason === 'cli')
        return '"claude" not found. Install Claude Code (https://code.claude.com) and put it on PATH, or set agents.claudeCli.command.';
    if (reason === 'cwd')
        return `claude-cli:// does not accept this folder (${cwd}). Install the "claude" CLI on PATH or set agents.claudeCli.launch to "terminal".`;
    return CLAUDE_CLI_NOT_FOUND;
}
