import { INSP_PATH_ATTR } from '../../shared/constants.js';
import { orderStyleKeys } from './style-keys.js';

/** Smallest node count a tree scope may capture (the selected element itself). */
export const MIN_NODE_LIMIT = 1;
/**
 * Largest node count a tree scope may capture (for `both`, split across both directions). Stays within the server-side
 * backstop (`MAX_NODES` in `server/styles.js`), which keeps headroom for `both` emitting up to `maxNodes + 1` nodes, so
 * a user-chosen cap is never silently truncated after it leaves the browser.
 */
export const MAX_NODE_LIMIT = 16;
/** Node cap used before the user has picked one; also the fallback for a malformed stored preference. */
export const DEFAULT_NODE_LIMIT = 8;
/** Max characters kept for a single computed value so an inherited `font`/`grid-template` cannot bloat the prompt. */
const MAX_VALUE_LENGTH = 240;

/**
 * Clamp an arbitrary node-limit value into the supported range, falling back to the default for non-finite input.
 *
 * Boundary: this is the single source of truth for the node cap bounds, shared by the picker UI, the persistence layer,
 * and the capture itself, so a stale preference or a hand-edited storage value cannot widen the capture past the range
 * the server also enforces.
 *
 * @param {unknown} value Requested node limit.
 * @returns {number} Integer node limit in [{@link MIN_NODE_LIMIT}, {@link MAX_NODE_LIMIT}].
 */
export function clampNodeLimit(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n))
        return DEFAULT_NODE_LIMIT;
    return Math.min(MAX_NODE_LIMIT, Math.max(MIN_NODE_LIMIT, n));
}

/**
 * Build a short, human-readable label for one node, e.g. `button.cii-btn.primary#submit`.
 *
 * Boundary: at most the first two class names are kept to stay compact; this is display/context only, not a selector.
 *
 * @param {Element} el Element to label.
 * @returns {string} Compact node label.
 */
function nodeLabel(el) {
    let label = el.tagName.toLowerCase();
    if (el.id)
        label += `#${el.id}`;
    const raw = typeof el.className === 'string' ? el.className : el.getAttribute('class');
    const classes = (raw ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
    if (classes.length)
        label += `.${classes.join('.')}`;
    return label;
}

/**
 * Read the requested computed-style values from a single element.
 *
 * Boundary: values come from `getComputedStyle`, i.e. the resolved/rendered values (e.g. `rgb(...)`, pixel lengths), not
 * the authored CSS. Empty values are omitted so the captured map only carries properties that actually resolved. Each
 * value is truncated to {@link MAX_VALUE_LENGTH}.
 *
 * @param {Element} el Element to read.
 * @param {string[]} properties Ordered computed-style property names.
 * @returns {{ label: string, inspPath: string | undefined, styles: Record<string, string> }} Captured node entry.
 */
function captureNode(el, properties) {
    const computed = window.getComputedStyle(el);
    const styles = {};
    for (const property of properties) {
        const value = computed.getPropertyValue(property);
        const trimmed = typeof value === 'string' ? value.trim() : '';
        if (trimmed) {
            // Keep the final length <= MAX_VALUE_LENGTH so the server-side cap (same limit) does not slice off the
            // ellipsis marker we add here.
            styles[property] = trimmed.length > MAX_VALUE_LENGTH
                ? `${trimmed.slice(0, MAX_VALUE_LENGTH - 1)}…`
                : trimmed;
        }
    }
    return {
        label: nodeLabel(el),
        inspPath: el.getAttribute(INSP_PATH_ATTR) ?? undefined,
        styles,
    };
}

/**
 * Walk up the parent chain, element first, stopping below `<html>` and at `max` nodes.
 *
 * @param {Element} el Start element (included as the first node).
 * @param {number} max Node cap.
 * @returns {Element[]} Element then ancestors, nearest first.
 */
function ancestorNodes(el, max) {
    const nodes = [];
    let current = el;
    while (current && current.nodeType === 1 && current !== document.documentElement && nodes.length < max) {
        nodes.push(current);
        current = current.parentElement;
    }
    return nodes;
}

/**
 * Walk the subtree breadth-first, element first, at `max` nodes.
 *
 * Boundary: level-order traversal keeps the closest descendants when truncated instead of diving into one deep branch.
 *
 * @param {Element} el Start element (included as the first node).
 * @param {number} max Node cap.
 * @returns {Element[]} Element then descendants, level by level in document order.
 */
function descendantNodes(el, max) {
    const nodes = [];
    const queue = [el];
    while (queue.length && nodes.length < max) {
        const current = queue.shift();
        nodes.push(current);
        for (const child of current.children)
            queue.push(child);
    }
    return nodes;
}

/**
 * Resolve the ordered node list a capture should read, starting from the selected element.
 *
 * Boundary: `self` returns just the element and ignores `maxNodes`. `ancestors` walks up the parent chain and `children`
 * walks the subtree breadth-first, each element-first and capped at `maxNodes`. `both` splits `maxNodes` evenly between
 * the two directions — `floor(maxNodes/2)` ancestor levels above the element and the rest as descendant levels below it
 * — so a cap of 8 reads 4 ancestors and 4 descendants around the element. The element is the shared anchor and is
 * de-duplicated, so `both` yields at most `maxNodes + 1` nodes (element + up + down). `ancestors` stops below `<html>`
 * in every mode.
 *
 * @param {Element} el Selected element.
 * @param {'self' | 'children' | 'ancestors' | 'both'} scope Capture scope.
 * @param {number} maxNodes Node cap applied to the tree scopes.
 * @returns {Element[]} Ordered nodes to read (element first).
 */
function scopeNodes(el, scope, maxNodes) {
    if (scope === 'ancestors')
        return ancestorNodes(el, maxNodes);
    if (scope === 'children')
        return descendantNodes(el, maxNodes);
    if (scope === 'both') {
        const up = Math.floor(maxNodes / 2);
        const down = maxNodes - up;
        // Both helpers are element-first, so the shared element appears twice; dedupe it while keeping order
        // (element, ancestors nearest-first, then descendants breadth-first).
        const seen = new Set();
        const nodes = [];
        for (const node of [...ancestorNodes(el, up + 1), ...descendantNodes(el, down + 1)]) {
            if (seen.has(node))
                continue;
            seen.add(node);
            nodes.push(node);
        }
        return nodes;
    }
    return [el];
}

/**
 * Capture the selected element's rendered styles (optionally up its ancestor chain) into a serializable payload.
 *
 * Boundary: returns `null` when there is no element or no valid property selected, so callers can omit `styles` from the
 * request entirely. The payload is plain JSON (no DOM references) suitable for posting to the inspector server, which
 * renders it into the prompt context.
 *
 * Boundary: each captured node carries a `parent` index (into the returned `nodes` array, or -1 for a root) so the
 * server can render the flat list back into an indented tree — otherwise the agent cannot tell which node nests inside
 * which. The originally selected element is flagged `selected: true` so its position in an ancestor+descendant tree is
 * unambiguous.
 *
 * @param {Element | null | undefined} el Selected page element.
 * @param {{ scope?: 'self' | 'children' | 'ancestors' | 'both', properties: Iterable<string>, maxNodes?: number }} options Capture options.
 * @returns {{ scope: 'self' | 'children' | 'ancestors' | 'both', properties: string[], nodes: Array<{ label: string, inspPath?: string, styles: Record<string, string>, parent: number, selected?: boolean }> } | null} Capture payload.
 */
export function captureStyles(el, options) {
    if (!(el instanceof Element))
        return null;
    const scope = options?.scope === 'ancestors' || options?.scope === 'children' || options?.scope === 'both' ? options.scope : 'self';
    const properties = orderStyleKeys(options?.properties);
    if (!properties.length)
        return null;
    const maxNodes = clampNodeLimit(options?.maxNodes);
    // Read styles first, keeping each source element next to its capture so parent links can be rebuilt across any
    // element dropped for resolving no styles.
    const kept = [];
    for (const element of scopeNodes(el, scope, maxNodes)) {
        const captured = captureNode(element, properties);
        if (Object.keys(captured.styles).length > 0)
            kept.push({ element, captured });
    }
    if (!kept.length)
        return null;
    const indexByElement = new Map(kept.map((entry, index) => [entry.element, index]));
    const nodes = kept.map(({ element, captured }) => {
        const node = { ...captured, parent: nearestKeptAncestorIndex(element, indexByElement) };
        if (element === el)
            node.selected = true;
        return node;
    });
    return { scope, properties, nodes };
}

/**
 * Find the array index of the nearest ancestor that is also part of the captured set.
 *
 * Boundary: walks the real DOM `parentElement` chain (not the captured order) so the structural link stays correct even
 * when an intermediate element was dropped for resolving no styles — its children re-link to the closest surviving
 * ancestor. Returns -1 when no captured ancestor exists (a tree root), e.g. the top of an `ancestors` chain.
 *
 * @param {Element} element Element whose parent link is needed.
 * @param {Map<Element, number>} indexByElement Captured elements mapped to their node index.
 * @returns {number} Parent node index, or -1 for a root.
 */
function nearestKeptAncestorIndex(element, indexByElement) {
    let current = element.parentElement;
    while (current) {
        const index = indexByElement.get(current);
        if (index !== undefined)
            return index;
        current = current.parentElement;
    }
    return -1;
}
