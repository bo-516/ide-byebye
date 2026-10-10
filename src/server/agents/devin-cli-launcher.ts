import os from 'node:os';
import path from 'node:path';
import { DEVIN_SESSION_ID_PATTERN } from '../sessions/types.js';
import { resolvePromptPathStyleOptions } from '../config.js';
import { buildPrompt } from '../prompt.js';
import {
    buildAgentFilePrompt,
    buildAgentPrompt,
    resolveAgentProjectRoot,
    shouldWriteLauncherPromptFile,
    withAgentPathRoot,
} from './launch-prompt.js';
import {
    buildPosixLauncherScript,
    buildWindowsLauncherScript,
    launcherExtension,
    type LaunchArg,
    type LauncherInput,
} from './launch-script.js';

/** Default argv budget before switching to `--prompt-file` handoff. */
export const DEFAULT_DEVIN_CLI_PROMPT_ARG_LIMIT = 12000;
/** Default CLI binary name when no absolute path / override is configured. */
export const DEFAULT_DEVIN_CLI_COMMAND = 'devin';

/**
 * macOS CLI bundled inside Devin Desktop. Works after a normal app install without a separate CLI install.
 *
 * @type {string}
 */
const DARWIN_APP_CLI = '/Applications/Devin.app/Contents/Resources/app/extensions/windsurf/devin/bin/devin';

/** Launcher fields for a Devin session. `resumeSessionId` must match {@link DEVIN_SESSION_ID_PATTERN} when set. */
export interface DevinCliLauncherInput {
    command: string;
    cwd: string;
    promptPath: string;
    permissionMode?: string;
    model?: string;
    cloud?: boolean;
    resumeSessionId?: string;
    /** `--prompt-file` target: replaces the inline prompt when set. */
    promptFile?: string;
}

/**
 * Resolve `@` path formatting for Devin from agent config.
 *
 * Boundary: reads `devinCli.pathStyle` / `devinCli.artifactPathStyle` only (same defaults as the top-level plugin):
 * source **relative**, artifacts **absolute**. Relative source refs are rooted at Devin's cwd
 * ({@link resolveDevinCliProjectRoot}), so monorepos that set `projectRoot` to the repo root get short chips like
 * `@apps/desktop/src/App.tsx`. Screenshots stay absolute so Devin can open them regardless of cwd.
 *
 * @param {Record<string, unknown>} [config] Devin CLI adapter config.
 * @returns {{ pathStyle: 'relative' | 'absolute', artifactPathStyle: 'relative' | 'absolute' }} Path options for prompts.
 */
export function resolveDevinCliPathStyleOptions(config: Record<string, unknown> = {}) {
    return resolvePromptPathStyleOptions(config);
}

/**
 * Resolve the directory Devin should start in.
 *
 * Boundary: `devinCli.projectRoot` overrides the bundler root only when it is a non-blank string. Relative values
 * resolve from the Node process cwd. Blank / non-string values fall back to `context.projectRoot`. Devin has no
 * `--cwd` flag — the launcher `cd`s into this directory, so the wrong root starts the session in a different project.
 *
 * @param {{ projectRoot?: unknown } | null | undefined} config Devin CLI adapter config.
 * @param {{ projectRoot?: string }} context Agent context carrying the bundler project root. A string `projectRoot` makes the return a string.
 * @returns {string | undefined} Absolute working directory for the launcher `cd`, or `context.projectRoot` when no override is set.
 */
export function resolveDevinCliProjectRoot(config: { projectRoot?: unknown } | null | undefined, context: { projectRoot: string }): string;
export function resolveDevinCliProjectRoot(config: { projectRoot?: unknown } | null | undefined, context: { projectRoot?: string }): string | undefined;
export function resolveDevinCliProjectRoot(config: { projectRoot?: unknown } | null | undefined, context: { projectRoot?: string }) {
    return resolveAgentProjectRoot(config, context);
}

/**
 * Rewrite `request.projectRoot` to Devin's working directory so `@` refs are relative to its cwd.
 *
 * Boundary: only the root used by path formatters is swapped. Source / screenshot absolute file paths stay as-is;
 * `buildPrompt` strips the new root when `pathStyle` is relative. Omitting `request.projectRoot` falls through to
 * {@link resolveDevinCliProjectRoot}'s context fallback and may yield a wrong strip base.
 *
 * @param {Record<string, unknown>} request Normalized intent request (`projectRoot` = bundler package root).
 * @param {{ projectRoot?: unknown }} [config] Devin CLI adapter config (optional `projectRoot` override).
 * @returns {Record<string, unknown>} Request view whose `projectRoot` matches Devin's cwd.
 */
export function withDevinCliPathRoot(request: Parameters<typeof buildPrompt>[0], config: { projectRoot?: unknown } = {}) {
    return withAgentPathRoot(request, config);
}

/**
 * Build the full Devin prompt with configurable `@` file path style.
 *
 * Boundary: prefers agent-local `pathStyle` / `artifactPathStyle` (default relative). Relative paths are stripped
 * against Devin's cwd ({@link withDevinCliPathRoot}), not the bundler root, so monorepo handoffs stay short.
 *
 * @param {Record<string, unknown>} request Normalized intent request.
 * @param {Record<string, unknown>} [config] Devin CLI adapter config (path style + optional `projectRoot`).
 * @returns {string} Final prompt text ending with a trailing newline.
 */
export function buildDevinCliPrompt(request: Parameters<typeof buildPrompt>[0], config: Record<string, unknown> = {}) {
    return buildAgentPrompt(request, config);
}

/**
 * Build the short prompt used once the full request was written to disk.
 *
 * Boundary: `promptPath` should come from a written handoff file; an empty path would remove the handoff target.
 *
 * @param {Record<string, unknown>} request Normalized intent request.
 * @param {string} promptPath Absolute prompt file path written under the inspector output directory.
 * @param {Record<string, unknown>} [config] Devin CLI adapter config (path style + optional `projectRoot`).
 * @returns {string} Devin handoff prompt ending with a newline.
 */
export function buildDevinCliFilePrompt(request: Parameters<typeof buildPrompt>[0], promptPath: string, config: Record<string, unknown> = {}) {
    return buildAgentFilePrompt(request, promptPath, config);
}

/**
 * Decide whether Devin should receive the request through `--prompt-file` instead of an inline prompt.
 *
 * Boundary: `promptMode: "file"` always writes the handoff. In `auto`, prompts whose character length exceeds the
 * configured argv budget switch to `--prompt-file` so the message keeps the full text rather than a pointer.
 *
 * @param {Record<string, unknown>} config Devin CLI adapter config.
 * @param {unknown} prompt Rendered prompt text.
 * @returns {boolean} True when the request should be written to disk and passed via `--prompt-file`.
 */
export function shouldWriteDevinCliPromptFile(config: { promptMode?: unknown, promptArgLimit?: unknown } | null | undefined, prompt: unknown) {
    return shouldWriteLauncherPromptFile(config, prompt, DEFAULT_DEVIN_CLI_PROMPT_ARG_LIMIT);
}

/**
 * `-r <id>` arguments, or none when the send is a new session.
 *
 * Boundary: the id is checked against {@link DEVIN_SESSION_ID_PATTERN} before it reaches the script. Anything else
 * throws, so a page-supplied string cannot change the shell command.
 *
 * @param {string | undefined} sessionId Target session id, omitted for a new session.
 * @returns {LaunchArg[]} Zero or two launcher arguments.
 */
function resumeArgs(sessionId: string | undefined): LaunchArg[] {
    if (sessionId == null || sessionId === '')
        return [];
    if (!DEVIN_SESSION_ID_PATTERN.test(String(sessionId)))
        throw new Error('Invalid resume session id');
    return [{ flag: '-r' }, { value: String(sessionId) }];
}

/**
 * Map Devin launcher fields onto the shared launcher input:
 * `devin [-r <id>] [--permission-mode <mode>] [--model <m>] [--cloud] (--prompt-file <file> | -- "<prompt>")`.
 *
 * Boundary: a positional PATH is never passed — `devin <path>` opens Devin Desktop, not a terminal session — the
 * working directory comes from the script's `cd` instead.
 *
 * @param {DevinCliLauncherInput} input Launcher fields. A bad `resumeSessionId` throws.
 * @returns {LauncherInput} Input for the bash or PowerShell builder.
 */
function devinLauncherInput(input: DevinCliLauncherInput): LauncherInput {
    const permissionMode = typeof input.permissionMode === 'string' ? input.permissionMode.trim() : '';
    const model = typeof input.model === 'string' ? input.model.trim() : '';
    const promptFile = typeof input.promptFile === 'string' ? input.promptFile.trim() : '';
    const args: LaunchArg[] = [...resumeArgs(input.resumeSessionId)];
    if (permissionMode)
        args.push({ flag: '--permission-mode' }, { value: permissionMode });
    if (model)
        args.push({ flag: '--model' }, { value: model });
    if (input.cloud === true)
        args.push({ flag: '--cloud' });
    if (promptFile)
        args.push({ flag: '--prompt-file' }, { value: promptFile });
    else
        args.push({ endOfOptions: true }, { prompt: true });
    return {
        command: input.command,
        cwd: input.cwd,
        promptPath: input.promptPath,
        args,
    };
}

/**
 * Build the bash launcher that opens an interactive Devin session.
 *
 * Boundary: paths and the CLI binary are single-quoted literals; the prompt body is never interpolated into the
 * script — it is read at runtime via `cat` from `promptPath`, or passed to `--prompt-file` when `input.promptFile`
 * is set. A wrong `command` / cwd makes the Terminal session fail visibly instead of running a different tool.
 *
 * @param {DevinCliLauncherInput} input Launcher fields. `resumeSessionId` must be a slug id; a bad value throws.
 * @returns {string} Executable bash script contents (including shebang).
 */
export function buildDevinCliLauncherScript(input: DevinCliLauncherInput) {
    return buildPosixLauncherScript(devinLauncherInput(input));
}

/**
 * Build a cmd.exe wrapper that launches interactive Devin via PowerShell.
 *
 * Boundary: the PowerShell program is UTF-16LE base64 (`-EncodedCommand`) so cwd / devin / prompt paths are not
 * subject to cmd metacharacters. The prompt body is still read at runtime from `promptPath`.
 *
 * @param {DevinCliLauncherInput} input Launcher fields.
 * @returns {string} `.cmd` file contents (CRLF).
 */
export function buildDevinCliWindowsLauncherScript(input: DevinCliLauncherInput) {
    return buildWindowsLauncherScript(devinLauncherInput(input));
}

/**
 * Launcher file suffix for the current (or injected) platform.
 *
 * @param {string} [platform=process.platform] Node platform id.
 * @returns {'.cmd' | '.command'} File suffix including the dot.
 */
export function devinCliLauncherExtension(platform = process.platform) {
    return launcherExtension(platform);
}

/**
 * Build the launcher file body for the given platform.
 *
 * @param {DevinCliLauncherInput} input Launcher fields.
 * @param {string} [platform=process.platform] Node platform id.
 * @returns {string} Script contents to write.
 */
export function buildDevinCliLauncherFile(input: DevinCliLauncherInput, platform = process.platform) {
    return platform === 'win32'
        ? buildDevinCliWindowsLauncherScript(input)
        : buildDevinCliLauncherScript(input);
}

/**
 * Candidate absolute/relative paths used to locate the Devin CLI.
 *
 * Boundary: `config.command` wins when set. Otherwise the bare `devin` name is tried first (inherits the dev-server
 * process PATH), then the CLI bundled inside Devin Desktop on macOS, then the common user installs (`~/.local/bin`,
 * Homebrew). `platform` / `env` / `homedir` are injectable so tests do not depend on the host machine.
 *
 * @param {Record<string, unknown>} [config] Devin CLI adapter config.
 * @param {{ platform?: string, env?: NodeJS.ProcessEnv, homedir?: string }} [options] Overrides for tests.
 * @returns {string[]} Ordered command candidates to probe.
 */
export function resolveDevinCliCommandCandidates(config: { command?: unknown } = {}, options: { platform?: string, env?: NodeJS.ProcessEnv, homedir?: string } = {}) {
    if (typeof config.command === 'string' && config.command.trim())
        return [config.command.trim()];
    const platform = options.platform ?? process.platform;
    const homedir = options.homedir ?? os.homedir();
    const candidates = [DEFAULT_DEVIN_CLI_COMMAND];
    if (platform === 'darwin')
        candidates.push(DARWIN_APP_CLI, '/opt/homebrew/bin/devin', '/usr/local/bin/devin');
    else
        candidates.push(path.join(homedir, '.local', 'bin', DEFAULT_DEVIN_CLI_COMMAND));
    return candidates;
}
