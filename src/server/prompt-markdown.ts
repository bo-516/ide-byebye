import fs from 'node:fs';
import path from 'node:path';

/** Inclusive line span. A missing start still renders in the link label. */
type PromptLineRange = {
    startLine?: number;
    endLine?: number;
};

/** Selection fields this formatter reads. */
type PromptSelection = {
    line?: number;
};

/** Source-context fields this formatter reads. */
type PromptSource = {
    filePath?: string;
    selectedNodeRange?: PromptLineRange | null;
    containingComponentRange?: PromptLineRange | null;
    startLine?: number;
    endLine?: number;
};

/** One extra source chip. */
type PromptReference = {
    selection?: PromptSelection | null;
    source?: PromptSource | null;
};

/** Screenshot or recording still used as a Markdown link target. */
type PromptArtifact = {
    filePath?: string;
};

/** Recording metadata. Only the still frame becomes a link. */
type PromptRecording = {
    stillFramePath?: string;
};

/**
 * Intent fields the Markdown prompt reads.
 * Boundary: `projectRoot` is optional so a request with only screenshots or only an intent still typechecks.
 */
type PromptRequest = {
    projectRoot?: string;
    selection?: PromptSelection | null;
    source?: PromptSource | null;
    references?: readonly (PromptReference | null | undefined)[] | null;
    screenshots?: readonly PromptArtifact[] | null;
    screenshot?: PromptArtifact | null;
    recordings?: readonly (PromptRecording | null | undefined)[] | null;
};

/**
 * Convert a source path to the project-relative POSIX form used in Markdown links.
 *
 * Boundary: files outside `projectRoot` keep their original path, matching the plain prompt formatter. Passing the
 * wrong root can therefore expose absolute paths in app prompts instead of hiding invalid source data.
 *
 * @param {string | undefined} filePath Absolute or relative file path to reference.
 * @param {string | undefined} projectRoot Project root that should be stripped from in-repo paths.
 * @returns {string} Project-relative POSIX path, or the original path when it is outside the root.
 */
function repoRelativePath(filePath: string | undefined, projectRoot: string | undefined) {
    // Same realpath pairing as the plain prompt formatter: session cwd and insp-path can disagree on /var vs /private/var.
    const root = canonical(projectRoot);
    const file = canonical(filePath);
    const rel = path.relative(root, file);
    const value: string = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : filePath!;
    // `filePath` may be omitted; `path` still receives a string at runtime when a chip is rendered.
    return value.split(path.sep).join('/');
}

/**
 * Realpath when the path exists. Missing paths stay `path.resolve` so fixture roots that were never created still format.
 *
 * @param {string | undefined} input File or directory. `path.resolve` requires a string, so a missing value is asserted.
 * @returns {string} Canonical or resolved path.
 */
function canonical(input: string | undefined) {
    const resolved = path.resolve(input as string);
    try {
        return fs.realpathSync.native(resolved);
    }
    catch {
        return resolved;
    }
}

/**
 * Build the line-anchor suffix used by Codex App Markdown file links.
 *
 * Boundary: line numbers are passed through as provided by source resolution; invalid values still produce a visible
 * anchor so bad upstream range data is easy to spot instead of being silently dropped.
 *
 * @param {number | undefined} startLine First source line to reference. A missing line still renders.
 * @param {number | undefined} endLine Last source line to reference, if different.
 * @returns {string} Anchor suffix such as `#10-#20` or `#10`.
 */
function lineAnchor(startLine: number | undefined, endLine: number | undefined) {
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
function escapeMarkdownLabel(value: string) {
    return String(value ?? '').replace(/([\\[\]])/g, '\\$1');
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
function escapeMarkdownDestination(value: string) {
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
 * @param {number | undefined} startLine First source line to reference.
 * @param {number | undefined} endLine Last source line to reference, if different.
 * @returns {string} Link label such as `src/App.jsx #10-20`.
 */
function lineLabel(rel: string, startLine: number | undefined, endLine: number | undefined) {
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
 * @param {string | undefined} filePath Source file path.
 * @param {string | undefined} projectRoot Project root used for relative link labels.
 * @param {number | undefined} startLine First source line to reference.
 * @param {number | undefined} endLine Last source line to reference, if different.
 * @returns {string} Markdown file reference such as `[src/App.jsx #10-20](src/App.jsx#10-#20)`.
 */
function markdownLineRef(filePath: string | undefined, projectRoot: string | undefined, startLine: number | undefined, endLine: number | undefined) {
    const rel = repoRelativePath(filePath, projectRoot);
    return `[${escapeMarkdownLabel(lineLabel(rel, startLine, endLine))}](${escapeMarkdownDestination(`${rel}${lineAnchor(startLine, endLine)}`)})`;
}

/**
 * Pick the source range for a Markdown app reference.
 *
 * Boundary: mirrors the plain prompt formatter so SDK and App prompts share the same span. Prefer the clicked element's
 * AST range (including single-line nodes) over the containing component, then the insp-path line, so labels stay aligned
 * with `data-insp-path`. Missing selection line data can still emit an undefined anchor.
 *
 * @param {PromptSelection} selection Resolved browser selection with line information. Callers pass a selection that exists.
 * @param {PromptSource} source Extracted source context for that selection. Callers pass a source object that exists.
 * @returns {PromptLineRange} Inclusive source line range.
 */
function pickSourceRange(selection: PromptSelection, source: PromptSource) {
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
 * Build a screenshot reference line for Codex App prompts.
 *
 * Boundary: screenshots are generated WebP artifacts without line ranges, so the Markdown label and destination are
 * the same project-relative path. Outside-project paths remain absolute to expose bad input instead of hiding it.
 *
 * @param {PromptArtifact} screenshot Persisted screenshot metadata.
 * @param {string | undefined} projectRoot Project root used for relative Markdown links.
 * @returns {string} Prompt screenshot reference such as `[.intent-inspector/screenshots/a1b2c3d.webp](.intent-inspector/screenshots/a1b2c3d.webp)`.
 */
function screenshotRef(screenshot: PromptArtifact, projectRoot: string | undefined) {
    const rel = repoRelativePath(screenshot.filePath, projectRoot);
    return `[${escapeMarkdownLabel(rel)}](${escapeMarkdownDestination(rel)})`;
}

/**
 * Build one Codex App Markdown link for a resolved source selection.
 *
 * Boundary: callers should use only server-resolved selections. Passing unresolved source data can still render a
 * malformed path because this formatter does not revalidate files or ranges.
 *
 * @param {PromptSelection} selection Resolved browser selection.
 * @param {PromptSource} source Extracted source context.
 * @param {string | undefined} projectRoot Absolute Vite project root.
 * @returns {string} Markdown file reference line.
 */
function sourceReferenceMarkdownLine(selection: PromptSelection, source: PromptSource, projectRoot: string | undefined) {
    const range = pickSourceRange(selection, source);
    return markdownLineRef(source.filePath, projectRoot, range.startLine, range.endLine);
}

/**
 * Build Codex App Markdown reference lines for the primary selection and extra source chips.
 *
 * Boundary: source and screenshot references become Markdown links. Malformed request objects can still emit wrong
 * paths; callers should pass normalized requests produced by the pipeline.
 *
 * @param {PromptRequest} request Normalized intent request. `projectRoot` may be omitted when there are no paths.
 * @returns {string[]} Prompt reference lines for Codex App deeplinks.
 */
export function buildPromptMarkdownReferenceLines(request: PromptRequest) {
    const refs: string[] = [];
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
    // `Array.isArray` widens the element type; keep the still-frame field the filter reads.
    const recordings: readonly PromptRecording[] = Array.isArray(request.recordings) ? request.recordings : [];
    refs.push(...recordings
        .filter((recording) => recording && recording.stillFramePath)
        .map((recording) => screenshotRef({ filePath: recording.stillFramePath }, request.projectRoot)));
    return refs;
}
