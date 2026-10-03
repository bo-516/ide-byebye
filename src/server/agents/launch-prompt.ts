import path from 'node:path';
import { resolvePromptPathStyleOptions } from '../config.js';
import { buildPrompt, buildPromptReferenceLines, filterInlineReferenceLines } from '../prompt.js';
import { formatHandoffPath } from './launch-script.js';

/** Default argv budget, in characters, before a Terminal launcher switches to a file-pointer prompt. */
export const DEFAULT_PROMPT_ARG_LIMIT = 12000;

/** Request shape the prompt builders read. */
type PromptRequest = Parameters<typeof buildPrompt>[0];

/**
 * Read a positive number from config, else `fallback`.
 *
 * Boundary: strings that parse as numbers are accepted (config files are loosely typed). Zero, negatives, `NaN`,
 * and missing values all return `fallback`.
 *
 * @param {unknown} raw Configured value.
 * @param {number} fallback Default limit.
 * @returns {number} The limit to apply.
 */
export function readPositiveLimit(raw: unknown, fallback: number) {
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Resolve the directory a CLI agent starts in.
 *
 * Boundary: the agent's `projectRoot` overrides the bundler root only when it is a non-blank string; relative values
 * resolve from the Node process cwd. Blank or non-string values fall back to `context.projectRoot`.
 *
 * @param {{ projectRoot?: unknown } | null | undefined} config Agent config.
 * @param {{ projectRoot?: string }} context Agent context carrying the bundler project root. A string `projectRoot`
 *        makes the return a string.
 * @returns {string | undefined} Absolute working directory, or `context.projectRoot` when no override is set.
 */
export function resolveAgentProjectRoot(config: { projectRoot?: unknown } | null | undefined, context: { projectRoot: string }): string;
export function resolveAgentProjectRoot(config: { projectRoot?: unknown } | null | undefined, context: { projectRoot?: string }): string | undefined;
export function resolveAgentProjectRoot(config: { projectRoot?: unknown } | null | undefined, context: { projectRoot?: string }) {
    const configured = typeof config?.projectRoot === 'string' ? config.projectRoot.trim() : '';
    return configured ? path.resolve(configured) : context.projectRoot;
}

/**
 * Rewrite `request.projectRoot` to the agent's working directory so relative `@` refs strip against it.
 *
 * Boundary: only the root used by path formatters changes; absolute file paths on the request stay as-is. Omitting
 * `request.projectRoot` falls through to the context fallback and can strip against the wrong directory.
 *
 * @param {PromptRequest} request Normalized intent request (`projectRoot` = bundler package root).
 * @param {{ projectRoot?: unknown }} [config] Agent config (optional `projectRoot` override).
 * @returns {PromptRequest} The same request when nothing changes, else a copy rooted at the agent's cwd.
 */
export function withAgentPathRoot(request: PromptRequest, config: { projectRoot?: unknown } = {}) {
    const pathRoot = resolveAgentProjectRoot(config, { projectRoot: request.projectRoot });
    if (pathRoot === request.projectRoot)
        return request;
    return { ...request, projectRoot: pathRoot };
}

/**
 * Build the full plain-`@` prompt for a CLI agent.
 *
 * Boundary: path style is agent-local (`pathStyle` / `artifactPathStyle`, default relative source and absolute
 * artifacts), and relative paths strip against the agent's cwd, not the bundler root. Prefer this over the shared
 * `context.prompt` when either differs from the plugin defaults.
 *
 * @param {PromptRequest} request Normalized intent request.
 * @param {Record<string, unknown>} [config] Agent config (path style plus optional `projectRoot`).
 * @returns {string} Prompt text ending with a newline.
 */
export function buildAgentPrompt(request: PromptRequest, config: Record<string, unknown> = {}) {
    return buildPrompt(withAgentPathRoot(request, config), resolvePromptPathStyleOptions(config));
}

/**
 * Build the short prompt used once the full request was written to disk: reference lines, the handoff path, the intent.
 *
 * Boundary: `promptPath` should be a written handoff file; an empty path drops the pointer and leaves only the intent.
 * Path style and root follow {@link buildAgentPrompt}; the handoff path is formatted by {@link formatHandoffPath}.
 *
 * @param {PromptRequest} request Normalized intent request.
 * @param {string} promptPath Absolute handoff file path under the inspector output directory.
 * @param {Record<string, unknown>} [config] Agent config (path style plus optional `projectRoot`).
 * @returns {string} File-pointer prompt ending with a newline.
 */
export function buildAgentFilePrompt(request: PromptRequest, promptPath: string, config: Record<string, unknown> = {}) {
    const intent = String(request.intent ?? '').trim();
    const rooted = withAgentPathRoot(request, config);
    const pathOptions = resolvePromptPathStyleOptions(config);
    const refs = filterInlineReferenceLines(buildPromptReferenceLines(rooted, pathOptions), intent);
    const handoffPath = formatHandoffPath(promptPath, rooted.projectRoot, pathOptions.pathStyle);
    return [...refs, handoffPath, '', intent].join('\n').trim() + '\n';
}

/**
 * Decide whether a Terminal launcher should receive a short file-pointer prompt.
 *
 * Boundary: `promptMode: "file"` always writes the full request first; any value other than `auto` / `file` never
 * does. In `auto`, prompts longer than `promptArgLimit` switch to the pointer so the command stays under ARG_MAX;
 * invalid limits use `defaultLimit`.
 *
 * @param {{ promptMode?: unknown, promptArgLimit?: unknown } | null | undefined} config Agent config.
 * @param {unknown} prompt Rendered prompt text (stringified for the length check).
 * @param {number} [defaultLimit=DEFAULT_PROMPT_ARG_LIMIT] Budget when `promptArgLimit` is unset or invalid.
 * @returns {boolean} True when the request should be written to disk first.
 */
export function shouldWriteLauncherPromptFile(config: { promptMode?: unknown, promptArgLimit?: unknown } | null | undefined, prompt: unknown, defaultLimit = DEFAULT_PROMPT_ARG_LIMIT) {
    const mode = config?.promptMode ?? 'auto';
    if (mode === 'file')
        return true;
    if (mode !== 'auto')
        return false;
    return String(prompt).length > readPositiveLimit(config?.promptArgLimit, defaultLimit);
}
