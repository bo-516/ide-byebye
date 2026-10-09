import os from 'node:os';
import path from 'node:path';
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
    type LauncherInput,
} from './launch-script.js';

/** Default interactive argv budget before switching to a short file-pointer prompt. */
export const DEFAULT_ANTIGRAVITY_PROMPT_ARG_LIMIT = 12000;
/** CLI binary name when `antigravity.command` is omitted. */
export const DEFAULT_ANTIGRAVITY_COMMAND = 'agy';

/**
 * Resolve `@` path formatting for the Antigravity CLI prompt.
 *
 * Boundary: reads `antigravity.pathStyle` / `antigravity.artifactPathStyle` only. Defaults match the plugin: source
 * relative, artifacts absolute. Invalid tokens fall back through {@link resolvePromptPathStyleOptions}.
 *
 * @param {Record<string, unknown>} [config] Antigravity adapter config.
 * @returns {{ pathStyle: 'relative' | 'absolute', artifactPathStyle: 'relative' | 'absolute' }} Prompt path options.
 */
export function resolveAntigravityPathStyleOptions(config: Record<string, unknown> = {}) {
    return resolvePromptPathStyleOptions(config);
}

/**
 * Resolve the directory `agy` should start in.
 *
 * Boundary: `antigravity.projectRoot` overrides the bundler root only when it is a non-blank string. Relative paths
 * resolve from the Node process cwd. Blank values fall back to `context.projectRoot`.
 *
 * @param {{ projectRoot?: unknown } | null | undefined} config Antigravity adapter config.
 * @param {{ projectRoot?: string }} context Agent context carrying the bundler project root. A string `projectRoot` makes the return a string.
 * @returns {string | undefined} Absolute working directory for the launcher `cd`, or `context.projectRoot` when no override is set.
 */
export function resolveAntigravityProjectRoot(config: { projectRoot?: unknown } | null | undefined, context: { projectRoot: string }): string;
export function resolveAntigravityProjectRoot(config: { projectRoot?: unknown } | null | undefined, context: { projectRoot?: string }): string | undefined;
export function resolveAntigravityProjectRoot(config: { projectRoot?: unknown } | null | undefined, context: { projectRoot?: string }) {
    return resolveAgentProjectRoot(config, context);
}

/**
 * Rewrite `request.projectRoot` so relative `@` refs strip against the CLI cwd.
 *
 * Boundary: only the formatter root changes. Absolute file paths on the request stay as-is. Omitting
 * `request.projectRoot` falls through to the context root and can strip against the wrong directory.
 *
 * @param {Parameters<typeof buildPrompt>[0]} request Normalized intent request.
 * @param {Record<string, unknown>} [config] Antigravity adapter config.
 * @returns {Parameters<typeof buildPrompt>[0]} Request view whose `projectRoot` matches the CLI cwd.
 */
export function withAntigravityPathRoot(request: Parameters<typeof buildPrompt>[0], config: { projectRoot?: unknown } = {}) {
    return withAgentPathRoot(request, config);
}

/**
 * Build the full Antigravity CLI prompt.
 *
 * Boundary: path style is agent-local (default relative source, absolute artifacts). Relative paths strip against
 * the CLI cwd, not the bundler package root. Prefer this over reusing `context.prompt` when those differ.
 *
 * @param {Parameters<typeof buildPrompt>[0]} request Normalized intent request.
 * @param {Record<string, unknown>} [config] Antigravity adapter config.
 * @returns {string} Prompt text ending with a newline.
 */
export function buildAntigravityPrompt(request: Parameters<typeof buildPrompt>[0], config: Record<string, unknown> = {}) {
    return buildAgentPrompt(request, config);
}

/**
 * Short prompt used when the full request was written to disk.
 *
 * Boundary: an empty `promptPath` drops the handoff target. Path style follows {@link resolveAntigravityPathStyleOptions}.
 * The handoff path itself is plain text, not an `@` chip.
 *
 * @param {Parameters<typeof buildPrompt>[0]} request Normalized intent request.
 * @param {string} promptPath Absolute handoff file path.
 * @param {Record<string, unknown>} [config] Antigravity adapter config.
 * @returns {string} Prompt ending with a newline.
 */
export function buildAntigravityFilePrompt(request: Parameters<typeof buildPrompt>[0], promptPath: string, config: Record<string, unknown> = {}) {
    return buildAgentFilePrompt(request, promptPath, config);
}

/**
 * Decide whether `agy` should receive a short file-pointer prompt.
 *
 * Boundary: `promptMode: "file"` always writes the full request first. In `auto`, prompts longer than the argv budget
 * switch to the pointer so the Terminal command stays under ARG_MAX. Invalid limits fall back to the default budget.
 *
 * @param {{ promptMode?: unknown, promptArgLimit?: unknown } | null | undefined} config Antigravity adapter config.
 * @param {string} prompt Rendered prompt text.
 * @returns {boolean} True when the request should be written to disk first.
 */
export function shouldWriteAntigravityPromptFile(config: { promptMode?: unknown, promptArgLimit?: unknown } | null | undefined, prompt: string) {
    return shouldWriteLauncherPromptFile(config, prompt, DEFAULT_ANTIGRAVITY_PROMPT_ARG_LIMIT);
}

/**
 * Candidate executables for the Antigravity CLI, in probe order.
 *
 * Boundary: `config.command` replaces the defaults. Otherwise `agy` on PATH, then the documented user install
 * (`~/.local/bin/agy` on macOS / Linux, `%LOCALAPPDATA%\\agy\\bin\\agy.exe` on Windows).
 *
 * @param {Record<string, unknown>} [config] Antigravity adapter config.
 * @param {{ platform?: string, env?: NodeJS.ProcessEnv, homedir?: string }} [options] Overrides for tests.
 * @returns {string[]} Ordered command candidates.
 */
export function resolveAntigravityCommandCandidates(config: Record<string, unknown> = {}, options: { platform?: string, env?: NodeJS.ProcessEnv, homedir?: string } = {}) {
    if (typeof config.command === 'string' && config.command.trim())
        return [config.command.trim()];
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    const homedir = options.homedir ?? os.homedir();
    if (platform === 'win32' && env.LOCALAPPDATA)
        return [DEFAULT_ANTIGRAVITY_COMMAND, path.join(env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe')];
    return [DEFAULT_ANTIGRAVITY_COMMAND, path.join(homedir, '.local', 'bin', DEFAULT_ANTIGRAVITY_COMMAND)];
}

/**
 * Error text when no `agy` candidate responds to `--version`.
 *
 * @param {Record<string, unknown>} [config] Antigravity adapter config.
 * @returns {string} Message safe to return to the page.
 */
export function antigravityMissingMessage(config: Record<string, unknown> = {}) {
    const name = resolveAntigravityCommandCandidates(config)[0];
    return `"${name}" not found. Install the Antigravity CLI (https://antigravity.google/docs/cli/getting-started) and ensure \`${DEFAULT_ANTIGRAVITY_COMMAND}\` is on PATH.`;
}

/**
 * Optional `--mode` token, or empty when unset.
 *
 * @param {unknown} mode Raw `antigravity.mode`.
 * @returns {string} Trimmed mode, or empty.
 */
function optionalMode(mode: unknown) {
    return typeof mode === 'string' ? mode.trim() : '';
}

/**
 * Map Antigravity launcher fields onto the shared launcher input: `agy [--mode <mode>] --prompt-interactive <prompt>`.
 *
 * @param {{ command: string, cwd: string, promptPath: string, mode?: string }} input Launcher fields.
 * @returns {LauncherInput} Input for the bash or PowerShell builder.
 */
function agyLauncherInput(input: { command: string, cwd: string, promptPath: string, mode?: string }): LauncherInput {
    const mode = optionalMode(input.mode);
    return {
        command: input.command,
        cwd: input.cwd,
        promptPath: input.promptPath,
        args: [
            ...(mode ? [{ flag: '--mode' }, { value: mode }] : []),
            { flag: '--prompt-interactive' },
            { prompt: true },
        ],
    };
}

/**
 * Build the bash launcher that opens an interactive `agy` session with the prompt prefilled.
 *
 * Boundary: the prompt body is read at runtime via `cat`. Paths and the binary are single-quoted. `--mode` is omitted
 * when blank so `agy` keeps the user's saved permission preset. A wrong binary fails in the Terminal window.
 *
 * @param {{ command: string, cwd: string, promptPath: string, mode?: string }} input Launcher fields.
 * @returns {string} Bash script including the shebang.
 */
export function buildAntigravityLauncherScript(input: { command: string, cwd: string, promptPath: string, mode?: string }) {
    return buildPosixLauncherScript(agyLauncherInput(input));
}

/**
 * Build a `.cmd` wrapper that launches interactive `agy` via PowerShell.
 *
 * Boundary: the prompt is read from disk inside `-EncodedCommand`, so cmd never parses the prompt text. `--mode` is
 * omitted when blank.
 *
 * @param {{ command: string, cwd: string, promptPath: string, mode?: string }} input Launcher fields.
 * @returns {string} `.cmd` contents (CRLF).
 */
export function buildAntigravityWindowsLauncherScript(input: { command: string, cwd: string, promptPath: string, mode?: string }) {
    return buildWindowsLauncherScript(agyLauncherInput(input));
}

/**
 * Launcher suffix for the platform.
 *
 * @param {string} [platform=process.platform] Node platform id.
 * @returns {'.cmd' | '.command'} Suffix including the dot.
 */
export function antigravityLauncherExtension(platform = process.platform) {
    return launcherExtension(platform);
}

/**
 * Launcher body for the platform.
 *
 * @param {{ command: string, cwd: string, promptPath: string, mode?: string }} input Launcher fields.
 * @param {string} [platform=process.platform] Node platform id.
 * @returns {string} Script contents.
 */
export function buildAntigravityLauncherFile(input: { command: string, cwd: string, promptPath: string, mode?: string }, platform = process.platform) {
    return platform === 'win32'
        ? buildAntigravityWindowsLauncherScript(input)
        : buildAntigravityLauncherScript(input);
}
