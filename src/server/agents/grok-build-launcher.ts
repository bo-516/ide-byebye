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
    type LaunchArg,
    type LauncherInput,
} from './launch-script.js';

export { formatHandoffPath as formatGrokBuildHandoffPath, powershellSingleQuote, shellSingleQuote } from './launch-script.js';

/** Default interactive argv budget before switching to a short file-pointer prompt. */
export const DEFAULT_GROK_BUILD_PROMPT_ARG_LIMIT = 12000;
/** Default CLI binary name when no absolute path / override is configured. */
export const DEFAULT_GROK_BUILD_COMMAND = 'grok';

/** Launcher fields for a Grok Build session. `resumeSessionId` must be a UUID when set. */
interface GrokBuildLauncherInput {
    command: string;
    cwd: string;
    promptPath: string;
    permissionMode?: string;
    resumeSessionId?: string;
}

/**
 * Resolve `@` path formatting for Grok Build from agent config.
 *
 * Boundary: reads `grokBuild.pathStyle` / `grokBuild.artifactPathStyle` only (same defaults as the top-level plugin):
 * source **relative**, artifacts **absolute**. Relative source refs are rooted at Grok's `--cwd`
 * ({@link resolveGrokBuildProjectRoot}), so monorepos that set `projectRoot` to the repo root get short chips like
 * `@apps/desktop/src/App.tsx`. Screenshots stay absolute so Grok can open them even when cwd / monorepo layout would
 * break `@.intent-inspector/…`. Override either knob when needed.
 *
 * @param {Record<string, unknown>} [config] Grok Build adapter config.
 * @returns {{ pathStyle: 'relative' | 'absolute', artifactPathStyle: 'relative' | 'absolute' }} Path options for prompts.
 */
export function resolveGrokBuildPathStyleOptions(config: Record<string, unknown> = {}) {
    return resolvePromptPathStyleOptions(config);
}

/**
 * Resolve the project directory Grok Build should start in.
 *
 * Boundary: `grokBuild.projectRoot` overrides the Vite project root only when it is a non-blank string. Relative
 * configured paths are resolved against the current Node process; blank / non-string values fall back to
 * `context.projectRoot`. Shared with the other CLI agents through {@link resolveAgentProjectRoot}.
 *
 * @param {{ projectRoot?: unknown } | null | undefined} config Grok Build adapter config.
 * @param {{ projectRoot?: string }} context Agent context carrying the Vite project root. A string `projectRoot` makes the return a string.
 * @returns {string | undefined} Absolute working directory for `--cwd` and the launcher `cd`, or `context.projectRoot` when no override is set.
 */
export function resolveGrokBuildProjectRoot(config: { projectRoot?: unknown } | null | undefined, context: { projectRoot: string }): string;
export function resolveGrokBuildProjectRoot(config: { projectRoot?: unknown } | null | undefined, context: { projectRoot?: string }): string | undefined;
export function resolveGrokBuildProjectRoot(config: { projectRoot?: unknown } | null | undefined, context: { projectRoot?: string }) {
    return resolveAgentProjectRoot(config, context);
}

/**
 * Rewrite `request.projectRoot` to Grok Build's working directory so `@` refs are relative to `--cwd`.
 *
 * Boundary: only the root used by path formatters is swapped. Source / screenshot absolute file paths stay as-is;
 * `buildPrompt` strips the new root when `pathStyle` is relative. Omitting `request.projectRoot` falls through to
 * {@link resolveGrokBuildProjectRoot}'s context fallback and may yield a wrong strip base.
 *
 * @param {Record<string, unknown>} request Normalized intent request (`projectRoot` = Vite package root).
 * @param {Record<string, unknown>} [config] Grok Build adapter config (optional `projectRoot` override).
 * @returns {Record<string, unknown>} Request view whose `projectRoot` matches Grok's cwd.
 */
export function withGrokBuildPathRoot(request: Parameters<typeof buildPrompt>[0], config: { projectRoot?: unknown } = {}) {
    return withAgentPathRoot(request, config);
}

/**
 * Build the full Grok Build prompt with configurable `@` file path style.
 *
 * Boundary: prefers agent-local `pathStyle` / `artifactPathStyle` (default relative). Relative paths are stripped
 * against Grok's `--cwd` ({@link withGrokBuildPathRoot}), not the Vite package root, so monorepo handoffs stay short
 * (`@apps/desktop/src/App.tsx`) and match what Grok's file chips expect. Prefer this over reusing a shared
 * `context.prompt` built for another agent when Grok's style or cwd differs from the top-level plugin defaults.
 *
 * @param {Record<string, unknown>} request Normalized intent request.
 * @param {Record<string, unknown>} [config] Grok Build adapter config (path style + optional `projectRoot`).
 * @returns {string} Final prompt text ending with a trailing newline.
 */
export function buildGrokBuildPrompt(request: Parameters<typeof buildPrompt>[0], config: Record<string, unknown> = {}) {
    return buildAgentPrompt(request, config);
}

/**
 * Build the short interactive prompt used when the full context is written to disk.
 *
 * Boundary: the prompt path should come from a written handoff file; an empty path would remove the handoff target and
 * leave Grok Build with only the original intent. Path style and relative root follow {@link resolveGrokBuildPathStyleOptions}
 * and {@link withGrokBuildPathRoot}; the handoff path itself is formatted via `formatGrokBuildHandoffPath`.
 *
 * @param {Record<string, unknown>} request Normalized intent request.
 * @param {string} promptPath Absolute prompt file path written under the inspector output directory.
 * @param {Record<string, unknown>} [config] Grok Build adapter config (path style + optional `projectRoot`).
 * @returns {string} Grok Build handoff prompt ending with a newline.
 */
export function buildGrokBuildFilePrompt(request: Parameters<typeof buildPrompt>[0], promptPath: string, config: Record<string, unknown> = {}) {
    return buildAgentFilePrompt(request, promptPath, config);
}

/**
 * Decide whether Grok Build should receive a short file-pointer prompt.
 *
 * Boundary: `promptMode: "file"` always writes the full request first. In `auto`, prompts whose character length exceeds
 * the configured argv budget switch to file handoff so Terminal/`exec` stays under ARG_MAX; invalid limits fall back to
 * the default budget.
 *
 * @param {Record<string, unknown>} config Grok Build adapter config.
 * @param {string} prompt Rendered prompt text.
 * @returns {boolean} True when the request should be written to disk and replaced by a short pointer prompt.
 */
export function shouldWriteGrokBuildPromptFile(config: { promptMode?: unknown, promptArgLimit?: unknown }, prompt: unknown) {
    return shouldWriteLauncherPromptFile(config, prompt, DEFAULT_GROK_BUILD_PROMPT_ARG_LIMIT);
}

/**
 * `--resume <uuid>` arguments, or none when the send is a new session.
 *
 * Boundary: the id is checked against the UUID pattern before it reaches the script. Anything else throws, so a
 * page-supplied string cannot change the shell command.
 *
 * @param {string | undefined} sessionId Target session id, omitted for a new session.
 * @returns {LaunchArg[]} Zero or two launcher arguments.
 */
function resumeArgs(sessionId: string | undefined): LaunchArg[] {
    if (sessionId == null || sessionId === '')
        return [];
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(sessionId)))
        throw new Error('Invalid resume session id');
    return [{ flag: '--resume' }, { value: String(sessionId) }];
}

/**
 * Map Grok launcher fields onto the shared launcher input:
 * `grok --cwd <cwd> [--resume <id>] [--permission-mode <mode>] --verbatim <prompt>`.
 *
 * @param {GrokBuildLauncherInput} input Launcher fields. A bad `resumeSessionId` throws.
 * @returns {LauncherInput} Input for the bash or PowerShell builder.
 */
function grokLauncherInput(input: GrokBuildLauncherInput): LauncherInput {
    const permissionMode = typeof input.permissionMode === 'string' ? input.permissionMode.trim() : '';
    return {
        command: input.command,
        cwd: input.cwd,
        promptPath: input.promptPath,
        args: [
            { flag: '--cwd' },
            { value: input.cwd },
            ...resumeArgs(input.resumeSessionId),
            ...(permissionMode ? [{ flag: '--permission-mode' }, { value: permissionMode }] : []),
            { flag: '--verbatim' },
            { prompt: true },
        ],
    };
}

/**
 * Build the bash launcher script that opens an interactive Grok Build session.
 *
 * Boundary: paths and the CLI binary are embedded as single-quoted literals; the prompt body is never interpolated into
 * the script — it is read at runtime via `cat` from `promptPath`. A wrong `command` / cwd makes the Terminal session
 * fail visibly instead of running a different tool.
 *
 * @param {{ command: string, cwd: string, promptPath: string, permissionMode?: string, resumeSessionId?: string }} input Launcher fields.
 *        `resumeSessionId` must be a UUID; a bad value throws before the script is returned.
 * @returns {string} Executable bash script contents (including shebang).
 */
export function buildGrokBuildLauncherScript(input: GrokBuildLauncherInput) {
    return buildPosixLauncherScript(grokLauncherInput(input));
}

/**
 * Build a cmd.exe wrapper that launches interactive Grok Build via PowerShell.
 *
 * Purpose: Windows has no Terminal.app for `.command` bash scripts. `start file.cmd` opens a console;
 * the prompt is read from disk so argv never hits cmd's ~8191 character limit.
 * Boundary: the PowerShell program is UTF-16LE base64 (`-EncodedCommand`) so cwd / grok / prompt
 * paths are not subject to cmd metacharacters. The prompt body is still read at runtime from `promptPath`.
 *
 * @param {{ command: string, cwd: string, promptPath: string, permissionMode?: string, resumeSessionId?: string }} input Launcher fields.
 * @returns {string} `.cmd` file contents (CRLF).
 */
export function buildGrokBuildWindowsLauncherScript(input: GrokBuildLauncherInput) {
    return buildWindowsLauncherScript(grokLauncherInput(input));
}

/**
 * Launcher file suffix for the current (or injected) platform.
 *
 * Boundary: Windows uses `.cmd` so `cmd /c start` can run it; other platforms keep macOS `.command`.
 *
 * @param {string} [platform=process.platform] Node platform id.
 * @returns {'.cmd' | '.command'} File suffix including the dot.
 */
export function grokBuildLauncherExtension(platform = process.platform) {
    return launcherExtension(platform);
}

/**
 * Build the launcher file body for the given platform.
 *
 * @param {{ command: string, cwd: string, promptPath: string, permissionMode?: string, resumeSessionId?: string }} input Launcher fields.
 * @param {string} [platform=process.platform] Node platform id.
 * @returns {string} Script contents to write.
 */
export function buildGrokBuildLauncherFile(input: GrokBuildLauncherInput, platform = process.platform) {
    return platform === 'win32'
        ? buildGrokBuildWindowsLauncherScript(input)
        : buildGrokBuildLauncherScript(input);
}

/**
 * Candidate absolute/relative paths used to locate the Grok Build CLI.
 *
 * Boundary: `config.command` wins when set. Otherwise the bare `grok` name is tried first (inherits the Vite process
 * PATH), then the default user install at `~/.grok/bin/grok` so availability checks work before the user's login PATH is
 * visible to Node.
 *
 * @param {Record<string, unknown>} config Grok Build adapter config.
 * @returns {string[]} Ordered command candidates to probe.
 */
export function resolveGrokBuildCommandCandidates(config: { command?: unknown }) {
    if (typeof config.command === 'string' && config.command.trim())
        return [config.command.trim()];
    return [DEFAULT_GROK_BUILD_COMMAND, path.join(os.homedir(), '.grok', 'bin', DEFAULT_GROK_BUILD_COMMAND)];
}
