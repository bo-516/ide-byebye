/**
 * Server-side handling for the optional rendered-style capture attached to an intent request.
 *
 * Boundary: style values are plain strings produced by the browser's `getComputedStyle`, so there is no filesystem path
 * to validate here — only size/shape caps to keep the prompt context bounded. The captured node labels (e.g.
 * `button.cii-btn`) are display context for the agent; each node's `data-insp-path` is rendered as a project-relative
 * `@path` reference (see {@link buildStyleContextLines}). Absolute or out-of-root paths are dropped rather than emitted,
 * so no absolute disk path leaks into the prompt.
 */
import path from 'node:path';

/**
 * Max captured nodes kept (tree scopes are already capped client-side, this is a server-side backstop). Sits above the
 * client `MAX_NODE_LIMIT` (16) with headroom for the `both` scope, which can emit `maxNodes + 1` nodes, so a legitimate
 * capture is never clipped here.
 */
const MAX_NODES = 20;
/** Max distinct property names recorded for the header summary. */
const MAX_PROPERTIES = 120;
/** Max characters kept for a single computed value. */
const MAX_VALUE_LENGTH = 240;
/** Max characters kept for a node label. */
const MAX_LABEL_LENGTH = 200;
/** Control characters (CR/LF/TAB and friends) collapsed to a space so a value cannot forge extra prompt lines. */
// eslint-disable-next-line no-control-regex -- deliberate: sanitizes control characters out of untrusted values.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;

/** One browser node before normalization. Fields are untrusted client JSON. */
type RawStyleNode = {
    label?: unknown;
    inspPath?: unknown;
    /** Computed style map. Non-objects are dropped before `Object.entries`. */
    styles?: Record<string, unknown> | null;
    parent?: unknown;
    selected?: unknown;
};

/**
 * Untrusted `payload.styles` object.
 * Boundary: `scope`, `properties`, and `nodes` are checked before use. Other client fields are ignored.
 */
type RawStyleCapture = {
    scope?: unknown;
    properties?: unknown;
    nodes?: RawStyleNode[] | null;
};

/** One node kept after dropping empty or non-object style maps, still keyed by its original index. */
type CleanedStyleNode = {
    entry: {
        label: string;
        inspPath?: string;
        styles: Record<string, string>;
        selected?: boolean;
    };
    originalIndex: number;
    /** `Number.isInteger` does not narrow, so this stays `unknown` until the index remap. */
    originalParent: unknown;
};

/** Node shape `buildStyleContextLines` walks. A missing `parent` is a root. */
type RenderedStyleNode = {
    label?: string;
    inspPath?: string;
    styles?: Record<string, string> | null;
    parent?: number;
    selected?: boolean;
};

/** Normalized capture, or a partial request that still has a scope and a node list. */
type RenderedStyleCapture = {
    scope: 'self' | 'children' | 'ancestors' | 'both';
    nodes: RenderedStyleNode[];
    properties?: string[];
};

/** Intent request fields the style block reads. Other prompt fields are ignored. */
type StyleContextRequest = {
    projectRoot?: string;
    styles?: RenderedStyleCapture | null;
    intent?: unknown;
};

/**
 * Collapse control characters in an untrusted client string into single spaces.
 *
 * Boundary: the captured `styles` payload is arbitrary client JSON (only the normal flow fills it from
 * `getComputedStyle`), so a crafted value containing a newline would otherwise render as a second, forged
 * `key: value` prompt line. Collapsing control chars keeps each captured value on one line.
 *
 * @param {string} value Raw client-supplied string.
 * @returns {string} Single-line string with control characters replaced by spaces.
 */
function oneLine(value: string) {
    return value.replace(CONTROL_CHARS, ' ');
}

/**
 * Normalize the browser-supplied `styles` payload into a safe, bounded shape.
 *
 * Boundary: returns `null` for missing, malformed, or empty captures so the request simply omits styles. Non-string
 * keys/values are dropped and oversized values are truncated; the scope is clamped to the two supported modes.
 *
 * @param {RawStyleCapture | null | undefined} raw Raw `payload.styles` value from the client. Non-objects and captures with no usable nodes return null.
 * @returns {{ scope: 'self' | 'children' | 'ancestors' | 'both', properties: string[], nodes: Array<{ label: string, inspPath?: string, styles: Record<string, string>, parent: number, selected?: boolean }> } | null} Normalized capture, or null.
 */
export function normalizeStyles(raw: RawStyleCapture | null | undefined) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const scope: 'self' | 'children' | 'ancestors' | 'both' = raw.scope === 'ancestors' || raw.scope === 'children' || raw.scope === 'both' ? raw.scope : 'self';
    const properties = Array.isArray(raw.properties)
        ? raw.properties.filter((property) => typeof property === 'string' && property).slice(0, MAX_PROPERTIES)
        : [];
    const rawNodes: RawStyleNode[] = Array.isArray(raw.nodes) ? raw.nodes.slice(0, MAX_NODES) : [];
    const cleaned: CleanedStyleNode[] = [];
    rawNodes.forEach((node, originalIndex) => {
        if (!node || typeof node !== 'object' || !node.styles || typeof node.styles !== 'object') {
            return;
        }
        const styles: Record<string, string> = {};
        for (const [key, value] of Object.entries(node.styles)) {
            if (typeof key !== 'string' || typeof value !== 'string') {
                continue;
            }
            const clean = oneLine(value);
            styles[oneLine(key)] = clean.length > MAX_VALUE_LENGTH ? clean.slice(0, MAX_VALUE_LENGTH) : clean;
        }
        if (!Object.keys(styles).length) {
            return;
        }
        const entry: CleanedStyleNode['entry'] = {
            label: typeof node.label === 'string' ? oneLine(node.label).slice(0, MAX_LABEL_LENGTH) : '',
            inspPath: typeof node.inspPath === 'string' ? node.inspPath : undefined,
            styles,
        };
        if (node.selected === true) {
            entry.selected = true;
        }
        cleaned.push({ entry, originalIndex, originalParent: Number.isInteger(node.parent) ? node.parent as number : -1 });
    });
    if (!cleaned.length) {
        return null;
    }
    // Re-map parent references onto the compacted array so a dropped or truncated node cannot leave a dangling index; a
    // parent that did not survive (or was never present) becomes a tree root (-1).
    const newIndexByOriginal = new Map<unknown, number>(cleaned.map((item, newIndex) => [item.originalIndex, newIndex]));
    const nodes = cleaned.map((item) => ({
        ...item.entry,
        parent: newIndexByOriginal.has(item.originalParent) ? newIndexByOriginal.get(item.originalParent)! : -1,
    }));
    return { scope, properties, nodes };
}

/**
 * Split a raw `data-insp-path` value into its file and source line.
 *
 * Boundary: mirrors the client `parseInspPathLite` shape — supports `file:line:column`, `file?line=..&column=..`,
 * `file:line`, and bare `file`, stripping any `file://` prefix. The line lets the reference point the agent at the exact
 * source line; a missing/invalid line is returned as 0 so the caller can omit it.
 *
 * @param {string} raw Raw insp-path string.
 * @returns {{ file: string, line: number }} File path portion (possibly absolute) and 1-based line (0 when unknown).
 */
function inspPathParts(raw: string) {
    const value = raw.trim().replace(/^file:\/\//, '');
    if (!value) {
        return { file: '', line: 0 };
    }
    const query = value.indexOf('?');
    if (query !== -1) {
        let file: string;
        try {
            file = decodeURIComponent(value.slice(0, query));
        }
        catch {
            file = value.slice(0, query);
        }
        const line = Number(new URLSearchParams(value.slice(query + 1)).get('line'));
        return { file, line: Number.isInteger(line) && line > 0 ? line : 0 };
    }
    const withColumn = value.match(/^(.*?):(\d+):(\d+)(?::.*)?$/);
    if (withColumn) {
        return { file: withColumn[1], line: Number(withColumn[2]) };
    }
    const withLine = value.match(/^(.*?):(\d+)$/);
    if (withLine) {
        return { file: withLine[1], line: Number(withLine[2]) };
    }
    return { file: value, line: 0 };
}

/**
 * Build the compact source reference appended to a captured node's label, e.g. `@src/Toolbar.tsx:14`.
 *
 * Boundary: the browser sends the raw `data-insp-path` (from the built-in stamper), an ABSOLUTE `file:line:column`
 * string. Only the file (made project-relative, so no absolute disk path leaks) and the line are kept — the line is what
 * points the agent at the exact source location. A path outside `projectRoot`, an absolute leftover, or a missing root
 * yields an empty string so nothing unsafe reaches the label — this is opportunistic context, not a required reference.
 *
 * @param {unknown} inspPath Raw `data-insp-path` value carried on the node. Non-strings yield ''.
 * @param {string} projectRoot Project root used to relativize the reference.
 * @returns {string} `@<relative-path>:<line>` reference (line omitted when unknown), or '' when none can be rendered.
 */
function styleNodeRef(inspPath: unknown, projectRoot: string) {
    if (typeof inspPath !== 'string' || !inspPath || !projectRoot) {
        return '';
    }
    const { file, line } = inspPathParts(inspPath);
    if (!file) {
        return '';
    }
    const rel = path.relative(projectRoot, file);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        return '';
    }
    const posix = rel.split(path.sep).join('/');
    return line ? `@${posix}:${line}` : `@${posix}`;
}

/**
 * Pick the header line describing which nodes a style capture covers.
 *
 * @param {'self' | 'children' | 'ancestors' | 'both'} scope Normalized capture scope.
 * @returns {string} Header line.
 */
function styleContextHeader(scope: 'self' | 'children' | 'ancestors' | 'both') {
    if (scope === 'ancestors') {
        return 'Rendered styles (selected element and ancestors):';
    }
    if (scope === 'children') {
        return 'Rendered styles (selected element and descendants):';
    }
    if (scope === 'both') {
        return 'Rendered styles (selected element, ancestors and descendants):';
    }
    return 'Rendered styles (selected element):';
}

/**
 * Build the rendered-styles context lines appended to a generated prompt.
 *
 * Boundary: returns an empty array when the request carries no normalized styles, so prompt formatters can splice it in
 * without changing output for requests that never attached styles. Nodes are rendered as an indented tree using each
 * node's `parent` index (2 spaces per depth level, styles indented one step further) so the agent can see which element
 * nests inside which — a flat list loses that. The selected element is tagged ` [selected]`. Each label carries a
 * project-relative `(@path)` source reference when `request.projectRoot` and the node's `data-insp-path` allow one. A
 * node without a `parent` (partial/un-normalized request) is treated as a root, so a flat capture still renders.
 *
 * @param {StyleContextRequest | null | undefined} request Normalized intent request (uses `styles` and, for node references, `projectRoot`). A missing `styles.nodes` list yields no lines.
 * @returns {string[]} Prompt context lines (possibly empty).
 */
export function buildStyleContextLines(request: StyleContextRequest | null | undefined) {
    const styles = request?.styles;
    if (!styles || !Array.isArray(styles.nodes) || !styles.nodes.length) {
        return [];
    }
    const projectRoot = typeof request?.projectRoot === 'string' ? request.projectRoot : '';
    // `Array.isArray` widens the element type; keep the node fields the walk below reads.
    const nodes: RenderedStyleNode[] = styles.nodes;
    // Group children by parent index (in array order) and collect roots. A parent that is -1, out of range, or points
    // at the node itself is treated as a root so a malformed or truncated capture still renders.
    const childrenByParent = new Map<number, number[]>();
    const roots: number[] = [];
    nodes.forEach((node, index) => {
        const parent = Number.isInteger(node?.parent) ? node.parent! : -1;
        if (parent < 0 || parent >= nodes.length || parent === index) {
            roots.push(index);
            return;
        }
        const siblings = childrenByParent.get(parent);
        if (siblings) {
            siblings.push(index);
        }
        else {
            childrenByParent.set(parent, [index]);
        }
    });
    const lines = [styleContextHeader(styles.scope)];
    const seen = new Set<number>();
    const emit = (index: number, depth: number) => {
        if (seen.has(index)) {
            return;
        }
        seen.add(index);
        const node = nodes[index];
        // Guard each node's `styles` object: normalizeStyles guarantees it, but a partial/un-normalized request must not
        // throw on `Object.entries(undefined)`. A node without renderable styles contributes no line, yet its children
        // still render (kept at the same depth) so a valid subtree is not lost.
        const entries = node && node.styles && typeof node.styles === 'object' ? Object.entries(node.styles) : [];
        const children = childrenByParent.get(index) ?? [];
        if (!entries.length) {
            for (const child of children) {
                emit(child, depth);
            }
            return;
        }
        const indent = '  '.repeat(depth);
        const label = node.label || `node ${index + 1}`;
        const ref = styleNodeRef(node?.inspPath, projectRoot);
        const marker = node?.selected === true ? ' [selected]' : '';
        // Space before `(` is required: a Tailwind arbitrary-value class makes labels end in `]` (e.g.
        // `div.mb-[1.05rem]`), and `]` directly followed by `(@path)` is Markdown link syntax `[text](url)`, which a
        // Markdown-rendering client would turn into a link labelled with the bracket contents. The space breaks it.
        lines.push(`${indent}- ${label}${ref ? ` (${ref})` : ''}${marker}`);
        for (const [key, value] of entries) {
            lines.push(`${indent}    ${key}: ${value}`);
        }
        for (const child of children) {
            emit(child, depth + 1);
        }
    };
    for (const root of roots) {
        emit(root, 0);
    }
    // Safety net for cycles/orphans that a root-first DFS could not reach, so no captured node silently disappears.
    nodes.forEach((_, index) => emit(index, 0));
    return lines;
}
