import path from 'node:path';

/**
 * One argv entry after the CLI binary in a Terminal launcher.
 *
 * - `flag`: a static option name such as `--cwd`, written bare. It must match {@link SAFE_LAUNCH_TOKEN}.
 * - `value`: literal data (paths, ids, modes), single-quoted for the target shell.
 * - `prompt`: the prompt file's contents, read when the script runs. `prefix` is glued in front (`--prompt=`), so a
 *   prompt that starts with `-` is still that option's value. The prefix must match {@link SAFE_LAUNCH_TOKEN}.
 * - `endOfOptions`: `--`. Bare in bash; quoted in PowerShell, where a bare `--` is a parser token of its own.
 *
 * Boundary: only `value` and the prompt may carry page-derived text, and the prompt never enters the script itself.
 */
export type LaunchArg =
    | { flag: string }
    | { value: string }
    | { prompt: true, prefix?: string }
    | { endOfOptions: true };

/** Inputs shared by the bash and PowerShell launcher builders. */
export interface LauncherInput {
    /** CLI binary (absolute path or PATH name). */
    command: string;
    /** Directory the script changes into before running the binary. */
    cwd: string;
    /** Absolute prompt file the script reads at run time. */
    promptPath: string;
    /** Arguments after `command`, in order. */
    args: LaunchArg[];
}

/** How one shell writes quoted values, the prompt expression, and `--`. */
interface ShellSyntax {
    quote: (value: string) => string;
    prompt: (prefix: string) => string;
    endOfOptions: string;
}

/**
 * Characters allowed in a bare `flag` token or a prompt `prefix`.
 *
 * Boundary: no whitespace, quotes, `$`, backticks, or other shell metacharacters, so a bare token cannot change the
 * command in bash or PowerShell. Anything else throws while the script is built.
 */
const SAFE_LAUNCH_TOKEN = /^-{1,2}[A-Za-z0-9][A-Za-z0-9-]*=?$/;

/**
 * Single-quote a string for safe inclusion in a bash script.
 *
 * Boundary: this only escapes for POSIX single-quoted strings. Passing a value then embedding it outside quotes still
 * lets the shell interpret metacharacters — callers must wrap the result as the sole token.
 *
 * @param {string} value Raw path or literal to quote.
 * @returns {string} Bash single-quoted literal.
 */
export function shellSingleQuote(value: string) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Single-quote a string for PowerShell so paths survive `-EncodedCommand` decoding.
 *
 * Boundary: only `'` is doubled. The result must be used as a complete single-quoted token.
 *
 * @param {string} value Raw path or literal.
 * @returns {string} PowerShell single-quoted literal.
 */
export function powershellSingleQuote(value: string) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Throw unless `token` is safe to write unquoted.
 *
 * @param {string} token Flag or prompt prefix.
 * @returns {string} The same token.
 */
function safeToken(token: string) {
    if (!SAFE_LAUNCH_TOKEN.test(token))
        throw new Error(`Unsafe launcher token: ${JSON.stringify(token)}`);
    return token;
}

/**
 * Render the argv after the binary for one shell.
 *
 * @param {LaunchArg[]} args Launcher arguments.
 * @param {ShellSyntax} shell Quoting, prompt expression, and `--` for the target shell.
 * @returns {string} Tokens joined by single spaces, each with a leading space; `''` when `args` is empty.
 */
function renderArgs(args: LaunchArg[], shell: ShellSyntax) {
    return args.map((arg) => {
        if ('flag' in arg)
            return ` ${safeToken(arg.flag)}`;
        if ('value' in arg)
            return ` ${shell.quote(arg.value)}`;
        if ('prompt' in arg)
            return ` ${shell.prompt(arg.prefix ? safeToken(arg.prefix) : '')}`;
        return ` ${shell.endOfOptions}`;
    }).join('');
}

/**
 * Build the bash launcher that runs one interactive CLI session in a new Terminal window.
 *
 * Boundary: the binary, cwd, and values are single-quoted; the prompt body is never interpolated — it is read at run
 * time with `cat` from `promptPath`. A wrong binary or cwd fails visibly in the Terminal window.
 *
 * @param {LauncherInput} input Binary, cwd, prompt file, and arguments.
 * @returns {string} Executable bash script, shebang first, ending with a newline.
 */
export function buildPosixLauncherScript(input: LauncherInput) {
    const promptPath = shellSingleQuote(input.promptPath);
    const args = renderArgs(input.args, {
        quote: shellSingleQuote,
        prompt: (prefix) => `${prefix}"$(cat ${promptPath})"`,
        endOfOptions: '--',
    });
    return [
        '#!/bin/bash',
        'set -euo pipefail',
        `cd ${shellSingleQuote(input.cwd)} || exit 1`,
        `exec ${shellSingleQuote(input.command)}${args}`,
        '',
    ].join('\n');
}

/**
 * Build a cmd.exe wrapper that runs one interactive CLI session through PowerShell.
 *
 * Purpose: Windows has no Terminal.app for `.command` bash scripts; `start file.cmd` opens a console instead, and the
 * prompt is read from disk so argv never hits cmd's ~8191 character limit.
 * Boundary: the PowerShell program is UTF-16LE base64 (`-EncodedCommand`), so paths are not subject to cmd
 * metacharacters. A prefixed prompt becomes one double-quoted argument (`"--prompt=$prompt"`).
 *
 * @param {LauncherInput} input Binary, cwd, prompt file, and arguments.
 * @returns {string} `.cmd` file contents (CRLF).
 */
export function buildWindowsLauncherScript(input: LauncherInput) {
    const args = renderArgs(input.args, {
        quote: powershellSingleQuote,
        prompt: (prefix) => (prefix ? `"${prefix}$prompt"` : '$prompt'),
        endOfOptions: powershellSingleQuote('--'),
    });
    const program = [
        `Set-Location -LiteralPath ${powershellSingleQuote(input.cwd)}`,
        `$prompt = Get-Content -LiteralPath ${powershellSingleQuote(input.promptPath)} -Raw -Encoding UTF8`,
        `& ${powershellSingleQuote(input.command)}${args}`,
    ].join('; ');
    const encoded = Buffer.from(program, 'utf16le').toString('base64');
    return `@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}\r\n`;
}

/**
 * Launcher file suffix for the current (or injected) platform.
 *
 * Boundary: Windows uses `.cmd` so `cmd /c start` can run it; other platforms keep macOS `.command`.
 *
 * @param {string} [platform=process.platform] Node platform id.
 * @returns {'.cmd' | '.command'} File suffix including the dot.
 */
export function launcherExtension(platform: string = process.platform) {
    return platform === 'win32' ? '.cmd' : '.command';
}

/**
 * Launcher body for the platform: a `.cmd` PowerShell wrapper on Windows, a bash script elsewhere.
 *
 * @param {LauncherInput} input Binary, cwd, prompt file, and arguments.
 * @param {string} [platform=process.platform] Node platform id.
 * @returns {string} Script contents to write.
 */
export function buildLauncherFile(input: LauncherInput, platform: string = process.platform) {
    return platform === 'win32' ? buildWindowsLauncherScript(input) : buildPosixLauncherScript(input);
}

/**
 * Format a handoff file path for inclusion in a short file-pointer prompt.
 *
 * Boundary: mirrors prompt `@` path style so the pointer stays openable from the CLI's cwd. Relative mode strips
 * `pathRoot` when the file is inside it; outside files and absolute mode keep a resolved absolute path. The path is
 * plain text (no leading `@`) — it is a file pointer, not a source selection chip.
 *
 * @param {string} promptPath Absolute path of the written handoff file.
 * @param {string | undefined} pathRoot The CLI's working directory. Undefined only reaches `path.relative` in relative mode.
 * @param {'relative' | 'absolute'} pathStyle How to present the path.
 * @returns {string} Path text for the short prompt line, with `/` separators.
 */
export function formatHandoffPath(promptPath: string, pathRoot: string | undefined, pathStyle: 'relative' | 'absolute') {
    if (pathStyle === 'absolute')
        return path.resolve(promptPath).split(path.sep).join('/');
    // `pathRoot` is the cwd string at runtime. The assertion is erased; `path.relative` still receives the original value.
    const rel = path.relative(pathRoot as string, promptPath);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel))
        return rel.split(path.sep).join('/');
    return path.resolve(promptPath).split(path.sep).join('/');
}
