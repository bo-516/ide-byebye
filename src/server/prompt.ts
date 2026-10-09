import { resolvePromptPathStyleOptions } from './config.js';
import { formatRefPath } from './prompt-paths.js';
import { buildRenderChainLines } from './render-chain.js';
import { buildStyleContextLines } from './styles.js';

/** Inclusive line span. Missing ends mean a single line; a missing start still renders. */
type PromptLineRange = {
    startLine?: number;
    endLine?: number;
};

/** Selection fields this formatter reads. Other client fields are ignored. */
type PromptSelection = {
    line?: number;
};

/** Source-context fields this formatter reads. `filePath` is omitted only for a partial request. */
type PromptSource = {
    filePath?: string;
    selectedNodeRange?: PromptLineRange | null;
    containingComponentRange?: PromptLineRange | null;
    startLine?: number;
    endLine?: number;
};

/** One extra source chip. Both halves are present on pipeline output. */
type PromptReference = {
    selection?: PromptSelection | null;
    source?: PromptSource | null;
};

/** Screenshot or recording still. `filePath` is absolute on disk when the writer succeeded. */
type PromptArtifact = {
    filePath?: string;
};

/** Recording metadata. Only the still frame is turned into an `@` reference. */
type PromptRecording = {
    stillFramePath?: string;
};

/**
 * Intent fields the plain prompt reads.
 * Boundary: `projectRoot` and `planMode` are optional. Callers that only have an intent still render;
 * `planMode` is accepted and ignored so a stale client flag is not a type error.
 */
type PromptRequest = {
    projectRoot?: string;
    intent?: unknown;
    planMode?: unknown;
    selection?: PromptSelection | null;
    source?: PromptSource | null;
    references?: readonly (PromptReference | null | undefined)[] | null;
    screenshots?: readonly PromptArtifact[] | null;
    screenshot?: PromptArtifact | null;
    recordings?: readonly (PromptRecording | null | undefined)[] | null;
    styles?: {
        scope: 'self' | 'children' | 'ancestors' | 'both';
        nodes: Array<{
            label?: string;
            inspPath?: string;
            styles?: Record<string, string> | null;
            parent?: number;
            selected?: boolean;
        }>;
        properties?: string[];
    } | null;
};

/**
 * Build a source-code reference line for the generated prompt.
 *
 * Boundary: line numbers are trusted from source resolution. Missing or wrong ranges still render a prompt reference,
 * but downstream agents may open the wrong location.
 *
 * @param {string | undefined} filePath Source file path.
 * @param {string | undefined} projectRoot Project root used for relative `@` references.
 * @param {number | undefined} startLine First source line to reference. A missing line still renders.
 * @param {number | undefined} endLine Last source line to reference, if different.
 * @param {'relative' | 'absolute'} [pathStyle='relative'] How to present the file path.
 * @returns {string} Prompt source reference such as `@src/App.jsx #10-20`.
 */
function lineRef(filePath: string | undefined, projectRoot: string | undefined, startLine: number | undefined, endLine: number | undefined, pathStyle: 'relative' | 'absolute' = 'relative') {
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
 * @param {{ filePath?: string }} screenshot Persisted screenshot metadata (`filePath` should be absolute on disk).
 * @param {string | undefined} projectRoot Project root used when `pathStyle` is `relative`.
 * @param {'relative' | 'absolute'} [pathStyle='absolute'] How to present the artifact path.
 * @returns {string} Prompt screenshot reference such as `@/abs/project/.intent-inspector/screenshots/a1b2c3d.webp`.
 */
function screenshotRef(screenshot: PromptArtifact, projectRoot: string | undefined, pathStyle: 'relative' | 'absolute' = 'absolute') {
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
 * @param {PromptSelection} selection Resolved browser selection with line information. Callers pass a selection that exists.
 * @param {PromptSource} source Extracted source context for that selection. Callers pass a source object that exists.
 * @returns {PromptLineRange} Inclusive source line range. `startLine` may be missing when the selection had no line.
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
 * Build one compact `@path #line` prompt reference for a resolved source selection.
 *
 * Boundary: `source.filePath` must already be validated inside the project root. Passing unresolved selections can emit
 * wrong paths or line numbers, so callers should only use data returned by `resolveSelection`.
 *
 * @param {PromptSelection} selection Resolved browser selection.
 * @param {PromptSource} source Extracted source context.
 * @param {string | undefined} projectRoot Absolute Vite project root. Omitted when the caller has no root.
 * @param {'relative' | 'absolute'} [pathStyle='relative'] How to present the source file path.
 * @returns {string} Compact prompt reference line.
 */
function sourceReferenceLine(selection: PromptSelection, source: PromptSource, projectRoot: string | undefined, pathStyle: 'relative' | 'absolute' = 'relative') {
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
 * @param {PromptRequest} request Normalized intent request. `projectRoot` may be omitted when there are no paths.
 * @param {{ pathStyle?: 'relative' | 'absolute', artifactPathStyle?: 'relative' | 'absolute' }} [options] Path formatting.
 *   - `pathStyle`: source-file refs (default `relative`).
 *   - `artifactPathStyle`: screenshots / recording stills (default `absolute`).
 * @returns {string[]} Prompt reference lines.
 */
export function buildPromptReferenceLines(request: PromptRequest, options: any = {}) {
    const { pathStyle, artifactPathStyle } = resolvePromptPathStyleOptions(options);
    const refs: string[] = [];
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
    // `Array.isArray` widens the element type; keep the still-frame field the filter reads.
    const recordings: readonly PromptRecording[] = Array.isArray(request.recordings) ? request.recordings : [];
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
export function filterInlineReferenceLines(refs: string[], intent: string) {
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
 * root to its `--cwd` before calling this); screenshot / still paths default to absolute. A portal pick adds one
 * `Rendered via portal:` line after the references (see `render-chain.ts`); other prompts are unchanged.
 *
 * @param {PromptRequest} request Intent request with source references, screenshots, and user intent.
 * @param {{ pathStyle?: 'relative' | 'absolute', artifactPathStyle?: 'relative' | 'absolute' }} [options] Path formatting for `@` refs.
 * @returns {string} Final prompt text ending with a trailing newline.
 */
export function buildPrompt(request: PromptRequest, options: any = {}) {
    const intent = String(request.intent ?? '').trim();
    const chainLines = buildRenderChainLines(request, resolvePromptPathStyleOptions(options).pathStyle);
    const refs = [...filterInlineReferenceLines(buildPromptReferenceLines(request, options), intent), ...chainLines];
    const styleLines = buildStyleContextLines(request);
    const top = refs.length && styleLines.length ? [...refs, '', ...styleLines] : [...refs, ...styleLines];
    return [...top, ...(top.length ? [''] : []), intent].join('\n').trim() + '\n';
}
