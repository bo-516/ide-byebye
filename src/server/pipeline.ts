import crypto from 'node:crypto';
import { normalizeAngularHint } from '../shared/angular-hint.js';
import { resolveAngularComponentFile } from './angular/component-file.js';
import { parseInspPath } from './insp-path.js';
import { assertPathInsideRoot } from './security.js';
import { extractSourceContext } from './source-context.js';
import { normalizeStyles } from './styles.js';

/**
 * Browser selection before path checks. `inspPath` is the stamper value or the synthetic Angular path;
 * other client fields are copied onto the resolved selection.
 */
type BrowserSelection = {
    inspPath?: unknown;
    angular?: unknown;
    [key: string]: unknown;
};

/** Resolve/send body fields the pipeline reads. Artifact lists are copied through unchanged. */
type IntentPayload = {
    selection?: BrowserSelection | null;
    references?: readonly (BrowserSelection | null | undefined)[] | null;
    pageUrl?: unknown;
    intent?: unknown;
    agent?: unknown;
    applyMode?: unknown;
    resume?: unknown;
    styles?: Parameters<typeof normalizeStyles>[0];
};

/**
 * Inspector options the pipeline reads.
 * Boundary: `maxSourceContextLines` is `unknown` because `resolveOptions` types it that way; it is a number at runtime.
 */
type PipelineOptions = {
    maxSourceContextLines?: unknown;
    applyMode?: unknown;
};

/** Output of {@link resolveSelection}, passed straight into {@link buildIntentRequest}. */
type ResolvedIntent = {
    selection: Record<string, unknown>;
    source: unknown;
    references?: unknown;
};

/**
 * Resolve one browser selection into a validated source selection and context.
 *
 * Boundary: `selection` must carry a `data-insp-path` value from the built-in stamper, or the synthetic Angular path
 * plus `selection.angular` hint (normalized and size-capped here; the raw hint never travels further). The path must
 * stay inside the current project root; invalid or out-of-root values throw user-facing errors before any prompt is
 * built.
 *
 * @param {BrowserSelection | null | undefined} selection Browser selection payload from the client. Missing `inspPath` throws.
 * @param {string} projectRoot Absolute Vite project root.
 * @param {PipelineOptions} options Resolved inspector options. `maxSourceContextLines` is passed through as a number.
 * @param {string} label Error label for primary or additional selections.
 * @returns {{ selection: Record<string, unknown>, source: Record<string, unknown> }} Validated selection and extracted source context.
 */
export function resolveSourceSelection(selection: BrowserSelection | null | undefined, projectRoot: string, options: PipelineOptions, label: string) {
    if (!selection?.inspPath) {
        throw new Error(`${label} is missing a data-insp-path value`);
    }
    const parsed = parseInspPath(selection.inspPath);
    const angular = normalizeAngularHint(selection.angular);
    const absFile = angular
        ? resolveAngularComponentFile(parsed.file, projectRoot)
        : assertPathInsideRoot(parsed.file, projectRoot);
    const source = extractSourceContext({
        file: absFile,
        line: parsed.line,
        column: parsed.column,
        // Typed `unknown` upstream (`resolveOptions`); the runtime value is a number or the numeric default.
        maxContextLines: options.maxSourceContextLines as number | undefined,
        angular,
        projectRoot,
    });
    const resolvedSelection: Record<string, unknown> = {
        ...selection,
        file: absFile,
        line: parsed.line,
        column: parsed.column,
    };
    // Only the normalized hint travels on (prompt files, agents); the raw payload is dropped.
    if (angular)
        resolvedSelection.angular = angular;
    else
        delete resolvedSelection.angular;
    return { selection: resolvedSelection, source };
}

/**
 * Resolve additional code references selected from inside an open dialog.
 *
 * Boundary: non-array payloads are ignored. Every provided reference must be valid; a bad extra reference blocks the
 * request so the generated prompt cannot silently omit context the user expected.
 *
 * @param {readonly (BrowserSelection | null | undefined)[] | null | undefined} references Raw `payload.references` value. Non-arrays are ignored.
 * @param {string} projectRoot Absolute Vite project root.
 * @param {PipelineOptions} options Resolved inspector options.
 * @returns {Array<{ selection: Record<string, unknown>, source: Record<string, unknown> }>} Validated extra references.
 */
function resolveReferenceSelections(references: readonly (BrowserSelection | null | undefined)[] | null | undefined, projectRoot: string, options: PipelineOptions) {
    if (!Array.isArray(references))
        return [];
    return references.map((selection, index) => resolveSourceSelection(selection, projectRoot, options, `Reference ${index + 1}`));
}

/**
 * Parse the primary `data-insp-path`, validate all selected paths, and extract source context.
 *
 * Boundary: the primary selection is required, while additional references are optional but strict when present. Throws
 * user-facing errors on bad input before the request reaches an agent adapter.
 *
 * @param {IntentPayload | null | undefined} payload Browser payload sent to resolve or send routes. A missing primary selection throws.
 * @param {string} projectRoot Absolute Vite project root.
 * @param {PipelineOptions} options Resolved inspector options.
 * @returns {{ selection: Record<string, unknown>, source: Record<string, unknown>, references: Array<Record<string, unknown>> }} Resolved source payload.
 */
export function resolveSelection(payload: IntentPayload | null | undefined, projectRoot: string, options: PipelineOptions) {
    const primary = resolveSourceSelection(payload?.selection, projectRoot, options, 'Selection');
    const references = resolveReferenceSelections(payload?.references, projectRoot, options);
    return { ...primary, references };
}

/**
 * Build the normalized request object passed to prompt rendering and agent adapters.
 *
 * Boundary: `resolved` must already come from `resolveSelection`; this function does not revalidate filesystem paths or
 * source ranges, it only copies normalized data into an immutable request-shaped object.
 *
 * @param {IntentPayload} payload Browser payload from the client. Callers pass the parsed body; a missing body throws on field access.
 * @param {ResolvedIntent} resolved Resolved primary and extra source context. Paths are not revalidated here.
 * @param {string} projectRoot Absolute Vite project root.
 * @param {PipelineOptions} options Resolved inspector options. `applyMode` is copied when the payload omits one.
 * @returns {Record<string, unknown>} Intent request consumed by prompts and adapters.
 */
export function buildIntentRequest(payload: IntentPayload, resolved: ResolvedIntent, projectRoot: string, options: PipelineOptions): any {
    return {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        projectRoot,
        pageUrl: payload.pageUrl,
        intent: payload.intent ?? '',
        agent: payload.agent,
        applyMode: payload.applyMode ?? options.applyMode,
        resume: payload.resume ?? false,
        selection: resolved.selection,
        source: resolved.source,
        references: resolved.references ?? [],
        styles: normalizeStyles(payload.styles),
    };
}

