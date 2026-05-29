import path from 'node:path';

/**
 * Convert a source path to the project-relative POSIX form used in Markdown links.
 *
 * Boundary: files outside `projectRoot` keep their original path, matching the plain prompt formatter. Passing the
 * wrong root can therefore expose absolute paths in app prompts instead of hiding invalid source data.
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
 * Build the line-anchor suffix used by Codex App Markdown file links.
 *
 * Boundary: line numbers are passed through as provided by source resolution; invalid values still produce a visible
 * anchor so bad upstream range data is easy to spot instead of being silently dropped.
 *
 * @param {number} startLine First source line to reference.
 * @param {number | undefined} endLine Last source line to reference, if different.
 * @returns {string} Anchor suffix such as `#10-#20` or `#10`.
 */
function lineAnchor(startLine, endLine) {
    return endLine != null && endLine !== startLine
        ? `#${startLine}-#${endLine}`
        : `#${startLine}`;
}

/**
 * Escape text used between Markdown link brackets.
 *
 * Boundary: this is for display text only. Passing non-string values coerces them to text; callers should still pass
 * project-relative paths so the visible label stays useful.
 *
 * @param {string} value Raw Markdown label text.
 * @returns {string} Label text safe for a simple Markdown link.
 */
function escapeMarkdownLabel(value) {
    return String(value ?? '').replace(/([\\\[\]])/g, '\\$1');
}

/**
 * Escape a Markdown parenthesized link destination without changing path separators.
 *
 * Boundary: this only protects spaces and closing parentheses, the two cases that break the simple `(href)` form used
 * by Codex App prompts. Passing a fully qualified URL is allowed, but this helper is tuned for repository paths.
 *
 * @param {string} value Raw Markdown destination.
 * @returns {string} Destination safe for a simple Markdown link.
 */
function escapeMarkdownDestination(value) {
    return String(value ?? '')
        .replace(/ /g, '%20')
        .replace(/\)/g, '%29');
}

/**
 * Build the visible label for a Codex App Markdown file link.
 *
 * Boundary: the label includes line numbers because Codex App hides link destinations in the composer. Passing invalid
 * range data keeps it visible in the label so users can spot upstream source-resolution problems.
 *
 * @param {string} rel Project-relative POSIX source path.
 * @param {number} startLine First source line to reference.
 * @param {number | undefined} endLine Last source line to reference, if different.
 * @returns {string} Link label such as `src/App.jsx #10-20`.
 */
function lineLabel(rel, startLine, endLine) {
    const range = endLine != null && endLine !== startLine
        ? `#${startLine}-${endLine}`
        : `#${startLine}`;
    return `${rel} ${range}`;
}

/**
 * Build a Codex App Markdown file link for a source-code range.
 *
 * Boundary: SDK prompts keep `@path #range`, while app prompts need a Markdown link so the editor does not rewrite
 * labels into `path#line` self-links. Passing an invalid range still produces visible but possibly non-clickable text.
 *
 * @param {string} filePath Source file path.
 * @param {string} projectRoot Project root used for relative link labels.
 * @param {number} startLine First source line to reference.
 * @param {number | undefined} endLine Last source line to reference, if different.
 * @returns {string} Markdown file reference such as `[src/App.jsx #10-20](src/App.jsx#10-#20)`.
 */
function markdownLineRef(filePath, projectRoot, startLine, endLine) {
    const rel = repoRelativePath(filePath, projectRoot);
    return `[${escapeMarkdownLabel(lineLabel(rel, startLine, endLine))}](${escapeMarkdownDestination(`${rel}${lineAnchor(startLine, endLine)}`)})`;
}

/**
 * Pick the source range for a Markdown app reference.
 *
 * Boundary: this mirrors the plain prompt formatter so SDK and App prompts point at the same source span. Missing
 * source range data falls back to the clicked line; missing selection line data can still emit an undefined anchor.
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
 * Build a screenshot reference line for Codex App prompts.
 *
 * Boundary: screenshots are generated WebP artifacts without line ranges, so the Markdown label and destination are
 * the same project-relative path. Outside-project paths remain absolute to expose bad input instead of hiding it.
 *
 * @param {{ filePath: string }} screenshot Persisted screenshot metadata.
 * @param {string} projectRoot Project root used for relative Markdown links.
 * @returns {string} Prompt screenshot reference such as `[.intent-inspector/screenshots/a1b2c3d.webp](.intent-inspector/screenshots/a1b2c3d.webp)`.
 */
function screenshotRef(screenshot, projectRoot) {
    const rel = repoRelativePath(screenshot.filePath, projectRoot);
    return `[${escapeMarkdownLabel(rel)}](${escapeMarkdownDestination(rel)})`;
}

/**
 * Build one Codex App Markdown link for a resolved source selection.
 *
 * Boundary: callers should use only server-resolved selections. Passing unresolved source data can still render a
 * malformed path because this formatter does not revalidate files or ranges.
 *
 * @param {Record<string, unknown>} selection Resolved browser selection.
 * @param {Record<string, unknown>} source Extracted source context.
 * @param {string} projectRoot Absolute Vite project root.
 * @returns {string} Markdown file reference line.
 */
function sourceReferenceMarkdownLine(selection, source, projectRoot) {
    const range = pickSourceRange(selection, source);
    return markdownLineRef(source.filePath, projectRoot, range.startLine, range.endLine);
}

/**
 * Build Codex App Markdown reference lines for the primary selection and extra source chips.
 *
 * Boundary: source and screenshot references become Markdown links. Malformed request objects can still emit wrong
 * paths; callers should pass normalized requests produced by the pipeline.
 *
 * @param {Record<string, unknown>} request Normalized intent request.
 * @returns {string[]} Prompt reference lines for Codex App deeplinks.
 */
export function buildPromptMarkdownReferenceLines(request) {
    const refs = [];
    if (request.selection && request.source) {
        refs.push(sourceReferenceMarkdownLine(request.selection, request.source, request.projectRoot));
    }
    if (Array.isArray(request.references)) {
        refs.push(...request.references.map((reference) => sourceReferenceMarkdownLine(reference.selection, reference.source, request.projectRoot)));
    }
    const screenshots = request.screenshots?.length
        ? request.screenshots
        : request.screenshot
            ? [request.screenshot]
            : [];
    refs.push(...screenshots.map((screenshot) => screenshotRef(screenshot, request.projectRoot)));
    return refs;
}
