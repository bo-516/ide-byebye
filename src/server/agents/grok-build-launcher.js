import os from 'node:os';
import path from 'node:path';
import { resolvePromptPathStyleOptions } from '../config.js';
import { buildPrompt, buildPromptReferenceLines, filterInlineReferenceLines } from '../prompt.js';

/** Default interactive argv budget before switching to a short file-pointer prompt. */
export const DEFAULT_GROK_BUILD_PROMPT_ARG_LIMIT = 12000;
/** Default CLI binary name when no absolute path / override is configured. */
export const DEFAULT_GROK_BUILD_COMMAND = 'grok';

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
export function resolveGrokBuildPathStyleOptions(config = {}) {
    return resolvePromptPathStyleOptions(config);
}

/**
 * Single-quote a string for safe inclusion in a bash script.
 *
 * Boundary: this only escapes for POSIX single-quoted strings. Passing a value then embedding it outside quotes still
 * lets the shell interpret metacharacters — callers must wrap the result as the sole token.
 *
 * @param {string} value Raw path or literal to quote.
 * @returns {string} Bash single-quoted literal.
 */
export function shellSingleQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Resolve the project directory Grok Build should start in.
 *
 * Boundary: `grokBuild.projectRoot` overrides the Vite project root only when it is a non-blank string. Relative
 * configured paths are resolved against the current Node process; blank / non-string values fall back to
 * `context.projectRoot`.
 *
 * @param {Record<string, unknown>} config Grok Build adapter config.
 * @param {{ projectRoot: string }} context Agent context carrying the Vite project root.
 * @returns {string} Absolute working directory for `--cwd` and the launcher `cd`.
 */
export function resolveGrokBuildProjectRoot(config, context) {
    const configuredRoot = typeof config?.projectRoot === 'string' && config.projectRoot.trim()
        ? config.projectRoot.trim()
        : '';
    return configuredRoot ? path.resolve(configuredRoot) : context.projectRoot;
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
export function withGrokBuildPathRoot(request, config = {}) {
    const pathRoot = resolveGrokBuildProjectRoot(config, { projectRoot: request.projectRoot });
    if (pathRoot === request.projectRoot)
        return request;
    return { ...request, projectRoot: pathRoot };
}

/**
 * Format a handoff file path for inclusion in the short Grok Build prompt.
 *
 * Boundary: mirrors prompt `@` path style so the pointer path stays openable from `--cwd`. Relative mode strips the
 * Grok path root when the file is inside it; outside files and absolute mode keep a resolved absolute path. The
 * handoff path is plain text (no leading `@`) — it is a file pointer, not a source selection chip.
 *
 * @param {string} promptPath Absolute path of the written handoff file.
 * @param {string} pathRoot Grok Build working directory (same as `--cwd`).
 * @param {'relative' | 'absolute'} pathStyle How to present the path.
 * @returns {string} Path text for the short prompt line.
 */
export function formatGrokBuildHandoffPath(promptPath, pathRoot, pathStyle) {
    if (pathStyle === 'absolute')
        return path.resolve(promptPath).split(path.sep).join('/');
    const rel = path.relative(pathRoot, promptPath);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel))
        return rel.split(path.sep).join('/');
    return path.resolve(promptPath).split(path.sep).join('/');
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
export function buildGrokBuildPrompt(request, config = {}) {
    return buildPrompt(withGrokBuildPathRoot(request, config), resolveGrokBuildPathStyleOptions(config));
}

/**
 * Build the short interactive prompt used when the full context is written to disk.
 *
 * Boundary: the prompt path should come from a written handoff file; an empty path would remove the handoff target and
 * leave Grok Build with only the original intent. Path style and relative root follow {@link resolveGrokBuildPathStyleOptions}
 * and {@link withGrokBuildPathRoot}; the handoff path itself is formatted via {@link formatGrokBuildHandoffPath}.
 *
 * @param {Record<string, unknown>} request Normalized intent request.
 * @param {string} promptPath Absolute prompt file path written under the inspector output directory.
 * @param {Record<string, unknown>} [config] Grok Build adapter config (path style + optional `projectRoot`).
 * @returns {string} Grok Build handoff prompt ending with a newline.
 */
export function buildGrokBuildFilePrompt(request, promptPath, config = {}) {
    const intent = String(request.intent ?? '').trim();
    const rooted = withGrokBuildPathRoot(request, config);
    const pathOptions = resolveGrokBuildPathStyleOptions(config);
    const refs = filterInlineReferenceLines(buildPromptReferenceLines(rooted, pathOptions), intent);
    const handoffPath = formatGrokBuildHandoffPath(promptPath, rooted.projectRoot, pathOptions.pathStyle);
    return [...refs, handoffPath, '', intent].join('\n').trim() + '\n';
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
export function shouldWriteGrokBuildPromptFile(config, prompt) {
    const mode = config.promptMode ?? 'auto';
    if (mode === 'file')
        return true;
    if (mode !== 'auto')
        return false;
    const rawLimit = Number(config.promptArgLimit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_GROK_BUILD_PROMPT_ARG_LIMIT;
    return String(prompt).length > limit;
}

/**
 * Build the bash launcher script that opens an interactive Grok Build session.
 *
 * Boundary: paths and the CLI binary are embedded as single-quoted literals; the prompt body is never interpolated into
 * the script — it is read at runtime via `cat` from `promptPath`. A wrong `command` / cwd makes the Terminal session
 * fail visibly instead of running a different tool.
 *
 * @param {{ command: string, cwd: string, promptPath: string, permissionMode?: string }} input Launcher fields.
 * @returns {string} Executable bash script contents (including shebang).
 */
export function buildGrokBuildLauncherScript(input) {
    const command = shellSingleQuote(input.command);
    const cwd = shellSingleQuote(input.cwd);
    const promptPath = shellSingleQuote(input.promptPath);
    const permissionArgs = typeof input.permissionMode === 'string' && input.permissionMode.trim()
        ? ` --permission-mode ${shellSingleQuote(input.permissionMode.trim())}`
        : '';
    return [
        '#!/bin/bash',
        'set -euo pipefail',
        `cd ${cwd} || exit 1`,
        `exec ${command} --cwd ${cwd}${permissionArgs} --verbatim "$(cat ${promptPath})"`,
        '',
    ].join('\n');
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
export function resolveGrokBuildCommandCandidates(config) {
    if (typeof config.command === 'string' && config.command.trim())
        return [config.command.trim()];
    return [DEFAULT_GROK_BUILD_COMMAND, path.join(os.homedir(), '.grok', 'bin', DEFAULT_GROK_BUILD_COMMAND)];
}
