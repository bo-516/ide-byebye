import path from 'node:path';
import { resolvePromptPathStyleOptions } from './config.js';
import { buildStyleContextLines } from './styles.js';

/**
 * Convert an absolute project file path into a POSIX-style path relative to the project root.
 *
 * Boundary: files outside `projectRoot` fall back to their original path because this helper formats references only;
 * path trust is enforced earlier by source and screenshot writers. Passing a wrong root keeps absolute paths in prompts.
 *
 * @param {string} filePath Absolute or relative file path to reference.
 * @param {string} projectRoot Project root that should be stripped from in-repo paths.
 * @returns {string} Project-relative POSIX path, or the original path when it is outside the root.
 */
function repoRelativePath(filePath, projectRoot) {
    const rel = path.relative(projectRoot, filePath);
    const value = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : filePath;
    return value.split(path.sep).join('/');
}

/**
 * Format a filesystem path as a POSIX absolute path for prompt `@` references.
 *
 * Boundary: always `path.resolve`s first. Relative inputs resolve against the Node process cwd — callers should pass
 * absolute paths from screenshot / source writers. Prefer rewriting `request.projectRoot` to the agent cwd (Grok Build
 * does this via `withGrokBuildPathRoot`) so relative `@` refs stay short; absolute is only for files outside that root.
 *
 * @param {string} filePath Absolute or relative filesystem path.
 * @returns {string} Absolute POSIX path (forward slashes).
 */
function absolutePosixPath(filePath) {
    return path.resolve(filePath).split(path.sep).join('/');
}

/**
 * Format a path for a prompt `@` reference.
 *
 * Boundary: `absolute` always wins with a resolved path. `relative` strips `projectRoot` when the file is inside it;
 * outside paths stay absolute so callers still get a usable reference.
 *
 * @param {string} filePath Absolute or relative filesystem path.
 * @param {string} projectRoot Project root used when `pathStyle` is `relative`.
 * @param {'relative' | 'absolute'} pathStyle How to present the path in the prompt.
 * @returns {string} Path text after `@` (no leading `@`).
 */
function formatRefPath(filePath, projectRoot, pathStyle) {
    if (pathStyle === 'absolute')
        return absolutePosixPath(filePath);
    return repoRelativePath(filePath, projectRoot);
}

/**
 * Build a source-code reference line for the generated prompt.
 *
 * Boundary: line numbers are trusted from source resolution. Missing or wrong ranges still render a prompt reference,
 * but downstream agents may open the wrong location.
 *
 * @param {string} filePath Source file path.
 * @param {string} projectRoot Project root used for relative `@` references.
 * @param {number} startLine First source line to reference.
 * @param {number | undefined} endLine Last source line to reference, if different.
 * @param {'relative' | 'absolute'} [pathStyle='relative'] How to present the file path.
 * @returns {string} Prompt source reference such as `@src/App.jsx #10-20`.
 */
function lineRef(filePath, projectRoot, startLine, endLine, pathStyle = 'relative') {
    const formatted = formatRefPath(filePath, projectRoot, pathStyle);
    return endLine != null && endLine !== startLine
        ? `@${formatted} #${startLine}-${endLine}`
        : `@${formatted} #${startLine}`;
}

/**
 * Build a screenshot / still-frame reference line for the generated prompt.
 *
 * Boundary: style defaults to **absolute** so agents can open the image regardless of `--cwd` / monorepo layout.
 * Pass `pathStyle: 'relative'` only when the artifact lives under the same root as source chips and you want short
 * `@.intent-inspector/…` refs.
 *
 * @param {{ filePath: string }} screenshot Persisted screenshot metadata (`filePath` should be absolute on disk).
 * @param {string} projectRoot Project root used when `pathStyle` is `relative`.
 * @param {'relative' | 'absolute'} [pathStyle='absolute'] How to present the artifact path.
 * @returns {string} Prompt screenshot reference such as `@/abs/project/.intent-inspector/screenshots/a1b2c3d.webp`.
 */
function screenshotRef(screenshot, projectRoot, pathStyle = 'absolute') {
    return `@${formatRefPath(screenshot.filePath, projectRoot, pathStyle)}`;
}

/**
 * Pick the source range that should be referenced for one resolved selection.
 *
 * Boundary: prefer the clicked element's AST span (`selectedNodeRange`, including single-line nodes) so the chip /
 * `@path #range` matches `data-insp-path` rather than the whole containing component. Fall back to the insp-path line,
 * then the containing component / context window, then the clicked line so prompt generation never emits an empty
 * reference.
 *
 * @param {Record<string, unknown>} selection Resolved browser selection with line information.
 * @param {Record<string, unknown>} source Extracted source context for that selection.
 * @returns {{ startLine: number, endLine: number }} Inclusive source line range.
 */
function pickSourceRange(selection, source) {
    const selected = source.selectedNodeRange;
    if (selected) {
        return selected;
    }
    if (selection.line != null) {
        return { startLine: selection.line, endLine: selection.line };
    }
    if (source.containingComponentRange) {
        return source.containingComponentRange;
    }
    if (source.startLine != null) {
        return { startLine: source.startLine, endLine: source.endLine };
    }
    return { startLine: selection.line, endLine: selection.line };
}

/**
 * Build one compact `@path #line` prompt reference for a resolved source selection.
 *
 * Boundary: `source.filePath` must already be validated inside the project root. Passing unresolved selections can emit
 * wrong paths or line numbers, so callers should only use data returned by `resolveSelection`.
 *
 * @param {Record<string, unknown>} selection Resolved browser selection.
 * @param {Record<string, unknown>} source Extracted source context.
 * @param {string} projectRoot Absolute Vite project root.
 * @param {'relative' | 'absolute'} [pathStyle='relative'] How to present the source file path.
 * @returns {string} Compact prompt reference line.
 */
function sourceReferenceLine(selection, source, projectRoot, pathStyle = 'relative') {
    const range = pickSourceRange(selection, source);
    return lineRef(source.filePath, projectRoot, range.startLine, range.endLine, pathStyle);
}

/**
 * Build source reference lines for the primary selection and any extra `@code` chips.
 *
 * Boundary: screenshot / still-frame paths are appended after all code references so app prompts keep code context
 * grouped together before visual artifacts. Source defaults to **relative** (`request.projectRoot`); artifacts default
 * to **absolute** so images stay openable when the agent cwd differs from the Vite package root. Override either via
 * `pathStyle` / `artifactPathStyle` (same knobs as the top-level plugin and Grok Build agent config).
 *
 * @param {Record<string, unknown>} request Normalized intent request.
 * @param {{ pathStyle?: 'relative' | 'absolute', artifactPathStyle?: 'relative' | 'absolute' }} [options] Path formatting.
 *   - `pathStyle`: source-file refs (default `relative`).
 *   - `artifactPathStyle`: screenshots / recording stills (default `absolute`).
 * @returns {string[]} Prompt reference lines.
 */
export function buildPromptReferenceLines(request, options: any = {}) {
    const { pathStyle, artifactPathStyle } = resolvePromptPathStyleOptions(options);
    const refs = [];
    if (request.selection && request.source) {
        refs.push(sourceReferenceLine(request.selection, request.source, request.projectRoot, pathStyle));
    }
    if (Array.isArray(request.references)) {
        refs.push(...request.references.map((reference) => sourceReferenceLine(reference.selection, reference.source, request.projectRoot, pathStyle)));
    }
    const screenshots = request.screenshots?.length
        ? request.screenshots
        : request.screenshot
            ? [request.screenshot]
            : [];
    refs.push(...screenshots.map((screenshot) => screenshotRef(screenshot, request.projectRoot, artifactPathStyle)));
    const recordings = Array.isArray(request.recordings) ? request.recordings : [];
    refs.push(...recordings
        .filter((recording) => recording && recording.stillFramePath)
        .map((recording) => screenshotRef({ filePath: recording.stillFramePath }, request.projectRoot, artifactPathStyle)));
    return refs;
}
/**
 * Drop reference lines the user already placed inline inside the intent text.
 *
 * Boundary: the intent now comes from a mention editor that serializes extra `@code` references inline at the user's
 * cursor, so the same `@path #range` would otherwise appear both in the top context block and in the sentence. Matching
 * is exact full-line text; a reference whose resolved line range changed between picking and sending no longer matches
 * and is kept in the top block instead of being silently dropped.
 *
 * @param {string[]} refs Reference lines built for the top context block.
 * @param {string} intent User intent text that may already contain inline references.
 * @returns {string[]} Reference lines that are not already inline in the intent.
 */
export function filterInlineReferenceLines(refs, intent) {
    const text = String(intent ?? '');
    return refs.filter((ref) => !(ref && text.includes(ref)));
}

/**
 * Build the compact app prompt. Keep this deliberately terse so Codex/Claude
 * receive source references, visual references, and the user intent without
 * verbose wrapper instructions.
 *
 * Boundary: execution-control flags are intentionally ignored so stale clients
 * cannot inject wrapper instructions into the prompt. References already inlined
 * in the intent are removed from the top context block so they are not duplicated.
 * Missing `intent` becomes an empty trailing prompt line, while malformed
 * references should have been rejected before this renderer is called. Source path
 * style defaults to relative against `request.projectRoot` (Grok Build rewrites that
 * root to its `--cwd` before calling this); screenshot / still paths default to absolute.
 *
 * @param {Record<string, unknown>} request Intent request with source references, screenshots, and user intent.
 * @param {{ pathStyle?: 'relative' | 'absolute', artifactPathStyle?: 'relative' | 'absolute' }} [options] Path formatting for `@` refs.
 * @returns {string} Final prompt text ending with a trailing newline.
 */
export function buildPrompt(request, options: any = {}) {
    const intent = String(request.intent ?? '').trim();
    const refs = filterInlineReferenceLines(buildPromptReferenceLines(request, options), intent);
    const styleLines = buildStyleContextLines(request);
    const top = refs.length && styleLines.length ? [...refs, '', ...styleLines] : [...refs, ...styleLines];
    return [...top, ...(top.length ? [''] : []), intent].join('\n').trim() + '\n';
}
