import { MAX_RENDER_CHAIN_ENTRIES, MAX_RENDER_CHAIN_ENTRY_LENGTH } from '../shared/constants.js';
import { parseInspPath } from './insp-path.js';
import { formatRefPath } from './prompt-paths.js';
import { assertPathInsideRoot } from './security.js';

/**
 * Render chain of a portal pick: where the picked element lives, then where it was mounted from.
 *
 * Purpose: a dialog rendered with `createPortal` / `<Teleport>` is located in its own file, and the page sends the
 * component-tree path that mounted it (`selection.renderChain`, innermost first) so the prompt can name it too.
 * Boundary: the chain is page-supplied, so every entry is re-parsed and must resolve inside the project root; bad
 * entries are dropped silently. Entries are paths only — nothing here reads their files.
 */

/** One validated chain entry: an absolute in-root file, its 1-based position, and the stamped tag when it is safe. */
export interface RenderChainEntry {
    file: string;
    line: number;
    column: number;
    tag?: string;
}

/**
 * Raw entries inspected per request. The page never sends more than `MAX_RENDER_CHAIN_ENTRIES`; this bounds the work
 * an oversized array can cause.
 */
const MAX_RENDER_CHAIN_SCAN = 32;
/** Tags kept for the prompt line: identifiers and member names such as `DialogPrimitive.Content`. */
const CHAIN_TAG = /^[A-Za-z_$][\w$.-]{0,63}$/;
/** Control characters (a decoded `%0A`, say) a file path must not carry into the single prompt line. */
const CONTROL_CHAR = /[\u0000-\u001f\u007f]/;
/** Separator between chain entries in the prompt line, innermost first. */
const CHAIN_SEPARATOR = ' ← ';

/**
 * Validate one page-supplied entry.
 *
 * @param {unknown} raw Candidate `data-insp-path` string.
 * @param {string} projectRoot Absolute project root the entry must stay inside.
 * @returns {RenderChainEntry | null} The entry, or `null` for a non-string, over-long, unparsable or out-of-root value,
 *          or one whose path holds control characters.
 */
function parseChainEntry(raw: unknown, projectRoot: string): RenderChainEntry | null {
    if (typeof raw !== 'string' || raw.length > MAX_RENDER_CHAIN_ENTRY_LENGTH)
        return null;
    try {
        const parsed = parseInspPath(raw);
        if (CONTROL_CHAR.test(parsed.file))
            return null;
        const file = assertPathInsideRoot(parsed.file, projectRoot);
        const tag = raw.trim().match(/:\d+:\d+:([^:]+)$/)?.[1];
        return { file, line: parsed.line, column: parsed.column, ...(tag && CHAIN_TAG.test(tag) ? { tag } : {}) };
    }
    catch {
        return null;
    }
}

/**
 * Keep the valid entries of a page-supplied render chain.
 *
 * Boundary: a non-array yields `[]`. Each entry must be a string of at most `MAX_RENDER_CHAIN_ENTRY_LENGTH`
 * characters that parses as a `data-insp-path` and resolves inside `projectRoot`; anything else is dropped without
 * an error. At most `MAX_RENDER_CHAIN_ENTRIES` valid entries are kept, in page order, and only the first
 * `MAX_RENDER_CHAIN_SCAN` raw entries are looked at.
 *
 * @param {unknown} raw `selection.renderChain` from the page.
 * @param {string} projectRoot Absolute project root.
 * @returns {RenderChainEntry[]} Validated entries (possibly empty).
 */
export function normalizeRenderChain(raw: unknown, projectRoot: string): RenderChainEntry[] {
    if (!Array.isArray(raw))
        return [];
    const entries: RenderChainEntry[] = [];
    for (const item of raw.slice(0, MAX_RENDER_CHAIN_SCAN)) {
        const entry = parseChainEntry(item, projectRoot);
        if (entry)
            entries.push(entry);
        if (entries.length >= MAX_RENDER_CHAIN_ENTRIES)
            break;
    }
    return entries;
}

/**
 * Whether a resolved selection's chain entry has the shape {@link normalizeRenderChain} produces.
 *
 * @param {unknown} value Entry from `request.selection.renderChain`.
 * @returns {boolean} True for an object with a string `file`, a positive `line`, and a safe `tag` when present.
 */
function isChainEntry(value: unknown): value is RenderChainEntry {
    const entry = value as Partial<RenderChainEntry> | null;
    return !!entry && typeof entry.file === 'string' && Number.isInteger(entry.line) && entry.line! >= 1
        && (entry.tag === undefined || (typeof entry.tag === 'string' && CHAIN_TAG.test(entry.tag)));
}

/**
 * Prompt line naming where a portal pick was mounted from, e.g.
 * `Rendered via portal: src/HandDialog.tsx:5 <div> ← src/App.tsx:24 <ModalHost> ← src/main.tsx:4 <App>`.
 *
 * Boundary: plain paths with no `@`, so agents do not attach the mount-point files; they are formatted like the `@`
 * refs (`pathStyle`, relative to `request.projectRoot`). Returns `[]` unless `selection.portal` is `true` and the
 * chain holds at least two entries shaped like {@link normalizeRenderChain} output, so non-portal prompts are
 * unchanged. Text is language-neutral on purpose (prompts never follow the UI locale).
 *
 * @param {{ selection?: unknown, projectRoot?: string }} request Normalized intent request.
 * @param {'relative' | 'absolute'} pathStyle How to present the paths.
 * @returns {string[]} Zero or one prompt line.
 */
export function buildRenderChainLines(request: { selection?: unknown; projectRoot?: string }, pathStyle: 'relative' | 'absolute'): string[] {
    const selection = request.selection as { portal?: unknown; renderChain?: unknown } | null | undefined;
    if (selection?.portal !== true || !Array.isArray(selection.renderChain))
        return [];
    const entries = selection.renderChain.filter(isChainEntry);
    if (entries.length < 2)
        return [];
    const parts = entries.map((entry) => `${formatRefPath(entry.file, request.projectRoot, pathStyle)}:${entry.line}${entry.tag ? ` <${entry.tag}>` : ''}`);
    return [`Rendered via portal: ${parts.join(CHAIN_SEPARATOR)}`];
}
