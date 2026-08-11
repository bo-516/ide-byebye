import crypto from 'node:crypto';
import { parseInspPath } from './insp-path.js';
import { assertPathInsideRoot } from './security.js';
import { extractSourceContext } from './source-context.js';
import { normalizeStyles } from './styles.js';
/**
 * Resolve one browser selection into a validated source selection and context.
 *
 * Boundary: `selection` must carry a `data-insp-path` value from code-inspector-plugin. The path must stay inside the
 * current Vite project root; invalid or out-of-root values throw user-facing errors before any prompt is built.
 *
 * @param {Record<string, unknown>} selection Browser selection payload from the client.
 * @param {string} projectRoot Absolute Vite project root.
 * @param {Record<string, unknown>} options Resolved inspector options.
 * @param {string} label Error label for primary or additional selections.
 * @returns {{ selection: Record<string, unknown>, source: Record<string, unknown> }} Validated selection and extracted source context.
 */
export function resolveSourceSelection(selection, projectRoot, options, label) {
    if (!selection?.inspPath) {
        throw new Error(`${label} is missing a data-insp-path value`);
    }
    const parsed = parseInspPath(selection.inspPath);
    const absFile = assertPathInsideRoot(parsed.file, projectRoot);
    const source = extractSourceContext({
        file: absFile,
        line: parsed.line,
        column: parsed.column,
        maxContextLines: options.maxSourceContextLines,
    });
    const resolvedSelection = {
        ...selection,
        file: absFile,
        line: parsed.line,
        column: parsed.column,
    };
    return { selection: resolvedSelection, source };
}

/**
 * Resolve additional code references selected from inside an open dialog.
 *
 * Boundary: non-array payloads are ignored. Every provided reference must be valid; a bad extra reference blocks the
 * request so the generated prompt cannot silently omit context the user expected.
 *
 * @param {unknown} references Raw `payload.references` value.
 * @param {string} projectRoot Absolute Vite project root.
 * @param {Record<string, unknown>} options Resolved inspector options.
 * @returns {Array<{ selection: Record<string, unknown>, source: Record<string, unknown> }>} Validated extra references.
 */
function resolveReferenceSelections(references, projectRoot, options) {
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
 * @param {Record<string, unknown>} payload Browser payload sent to resolve or send routes.
 * @param {string} projectRoot Absolute Vite project root.
 * @param {Record<string, unknown>} options Resolved inspector options.
 * @returns {{ selection: Record<string, unknown>, source: Record<string, unknown>, references: Array<Record<string, unknown>> }} Resolved source payload.
 */
export function resolveSelection(payload, projectRoot, options) {
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
 * @param {Record<string, unknown>} payload Browser payload from the client.
 * @param {{ selection: Record<string, unknown>, source: Record<string, unknown>, references?: Array<Record<string, unknown>> }} resolved Resolved primary and extra source context.
 * @param {string} projectRoot Absolute Vite project root.
 * @param {Record<string, unknown>} options Resolved inspector options.
 * @returns {Record<string, unknown>} Intent request consumed by prompts and adapters.
 */
export function buildIntentRequest(payload, resolved, projectRoot, options): any {
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

