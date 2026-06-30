import { INSP_PATH_ATTR } from '../shared/constants.js';
import { orderStyleKeys } from './style-keys.js';

/** Hard ceiling on captured nodes for the `ancestors` scope so the prompt context stays bounded. */
const MAX_ANCESTOR_NODES = 12;
/** Max characters kept for a single computed value so an inherited `font`/`grid-template` cannot bloat the prompt. */
const MAX_VALUE_LENGTH = 240;

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
 * Resolve the ordered node list a capture should read, from the selected element outward.
 *
 * Boundary: `self` returns just the element; `ancestors` walks up the parent chain (element first, then each ancestor)
 * stopping below `<html>` and capped at {@link MAX_ANCESTOR_NODES} so deep trees do not flood the context.
 *
 * @param {Element} el Selected element.
 * @param {'self' | 'ancestors'} scope Capture scope.
 * @returns {Element[]} Ordered nodes to read (element first).
 */
function scopeNodes(el, scope) {
    if (scope !== 'ancestors')
        return [el];
    const nodes = [];
    let current = el;
    while (current && current.nodeType === 1 && current !== document.documentElement && nodes.length < MAX_ANCESTOR_NODES) {
        nodes.push(current);
        current = current.parentElement;
    }
    return nodes;
}

/**
 * Capture the selected element's rendered styles (optionally up its ancestor chain) into a serializable payload.
 *
 * Boundary: returns `null` when there is no element or no valid property selected, so callers can omit `styles` from the
 * request entirely. The payload is plain JSON (no DOM references) suitable for posting to the inspector server, which
 * renders it into the prompt context.
 *
 * @param {Element | null | undefined} el Selected page element.
 * @param {{ scope?: 'self' | 'ancestors', properties: Iterable<string> }} options Capture options.
 * @returns {{ scope: 'self' | 'ancestors', properties: string[], nodes: Array<{ label: string, inspPath?: string, styles: Record<string, string> }> } | null} Capture payload.
 */
export function captureStyles(el, options) {
    if (!(el instanceof Element))
        return null;
    const scope = options?.scope === 'ancestors' ? 'ancestors' : 'self';
    const properties = orderStyleKeys(options?.properties);
    if (!properties.length)
        return null;
    const nodes = scopeNodes(el, scope)
        .map((node) => captureNode(node, properties))
        .filter((node) => Object.keys(node.styles).length > 0);
    if (!nodes.length)
        return null;
    return { scope, properties, nodes };
}
