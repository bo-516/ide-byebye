import path from 'node:path';

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
 * Build a source-code reference line for the generated prompt.
 *
 * Boundary: line numbers are trusted from source resolution. Missing or wrong ranges still render a prompt reference,
 * but downstream agents may open the wrong location.
 *
 * @param {string} filePath Source file path.
 * @param {string} projectRoot Project root used for relative `@` references.
 * @param {number} startLine First source line to reference.
 * @param {number | undefined} endLine Last source line to reference, if different.
 * @returns {string} Prompt source reference such as `@src/App.jsx #10-20`.
 */
function lineRef(filePath, projectRoot, startLine, endLine) {
    const rel = repoRelativePath(filePath, projectRoot);
    return endLine != null && endLine !== startLine
        ? `@${rel} #${startLine}-${endLine}`
        : `@${rel} #${startLine}`;
}

/**
 * Build a screenshot reference line for the generated prompt.
 *
 * Boundary: screenshots are expected to have been written under `projectRoot`. If a caller passes an outside path, the
 * resulting reference remains absolute after `@`, which exposes the bad input instead of silently truncating it.
 *
 * @param {{ filePath: string }} screenshot Persisted screenshot metadata.
 * @param {string} projectRoot Project root used for relative `@` references.
 * @returns {string} Prompt screenshot reference such as `@.intent-inspector/screenshots/a1b2c3d.webp`.
 */
function screenshotRef(screenshot, projectRoot) {
    return `@${repoRelativePath(screenshot.filePath, projectRoot)}`;
}

/**
 * Pick the source range that should be referenced for one resolved selection.
 *
 * Boundary: the selected JSX node wins when it spans multiple lines, then the containing component, then the selected
 * line/context fallback. Missing range data falls back to the exact clicked line so prompt generation never emits an
 * empty reference.
 *
 * @param {Record<string, unknown>} selection Resolved browser selection with line information.
 * @param {Record<string, unknown>} source Extracted source context for that selection.
 * @returns {{ startLine: number, endLine: number }} Inclusive source line range.
 */
function pickSourceRange(selection, source) {
    const selected = source.selectedNodeRange;
    if (selected && selected.endLine > selected.startLine) {
        return selected;
    }
    if (source.containingComponentRange) {
        return source.containingComponentRange;
    }
    if (selected) {
        return selected;
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
 * @returns {string} Compact prompt reference line.
 */
function sourceReferenceLine(selection, source, projectRoot) {
    const range = pickSourceRange(selection, source);
    return lineRef(source.filePath, projectRoot, range.startLine, range.endLine);
}

/**
 * Build source reference lines for the primary selection and any extra `@code` chips.
 *
 * Boundary: screenshot paths are appended after all code references so app prompts keep code context grouped together
 * before visual artifacts.
 *
 * @param {Record<string, unknown>} request Normalized intent request.
 * @returns {string[]} Prompt reference lines.
 */
export function buildPromptReferenceLines(request) {
    const refs = [];
    if (request.selection && request.source) {
        refs.push(sourceReferenceLine(request.selection, request.source, request.projectRoot));
    }
    if (Array.isArray(request.references)) {
        refs.push(...request.references.map((reference) => sourceReferenceLine(reference.selection, reference.source, request.projectRoot)));
    }
    const screenshots = request.screenshots?.length
        ? request.screenshots
        : request.screenshot
            ? [request.screenshot]
            : [];
    refs.push(...screenshots.map((screenshot) => screenshotRef(screenshot, request.projectRoot)));
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
 * references should have been rejected before this renderer is called.
 *
 * @param {Record<string, unknown>} request Intent request with source references, screenshots, and user intent.
 * @returns {string} Final prompt text ending with a trailing newline.
 */
export function buildPrompt(request) {
    const intent = String(request.intent ?? '').trim();
    const refs = filterInlineReferenceLines(buildPromptReferenceLines(request), intent);
    return [...refs, ...(refs.length ? [''] : []), intent].join('\n').trim() + '\n';
}
