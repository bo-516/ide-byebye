/**
 * Server-side handling for the optional rendered-style capture attached to an intent request.
 *
 * Boundary: style values are plain strings produced by the browser's `getComputedStyle`, so there is no filesystem path
 * to validate here — only size/shape caps to keep the prompt context bounded. The captured node labels (e.g.
 * `button.cii-btn`) are display context for the agent; the `data-insp-path` is intentionally NOT rendered into the
 * prompt so absolute source paths are not leaked into app deeplinks.
 */

/** Max captured nodes kept (ancestor chains are already capped client-side, this is a server-side backstop). */
const MAX_NODES = 16;
/** Max distinct property names recorded for the header summary. */
const MAX_PROPERTIES = 120;
/** Max characters kept for a single computed value. */
const MAX_VALUE_LENGTH = 240;
/** Max characters kept for a node label. */
const MAX_LABEL_LENGTH = 200;
/** Control characters (CR/LF/TAB and friends) collapsed to a space so a value cannot forge extra prompt lines. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;

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
function oneLine(value) {
    return value.replace(CONTROL_CHARS, ' ');
}

/**
 * Normalize the browser-supplied `styles` payload into a safe, bounded shape.
 *
 * Boundary: returns `null` for missing, malformed, or empty captures so the request simply omits styles. Non-string
 * keys/values are dropped and oversized values are truncated; the scope is clamped to the two supported modes.
 *
 * @param {unknown} raw Raw `payload.styles` value from the client.
 * @returns {{ scope: 'self' | 'ancestors', properties: string[], nodes: Array<{ label: string, inspPath?: string, styles: Record<string, string> }> } | null} Normalized capture, or null.
 */
export function normalizeStyles(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const scope = raw.scope === 'ancestors' ? 'ancestors' : 'self';
    const properties = Array.isArray(raw.properties)
        ? raw.properties.filter((property) => typeof property === 'string' && property).slice(0, MAX_PROPERTIES)
        : [];
    const rawNodes = Array.isArray(raw.nodes) ? raw.nodes.slice(0, MAX_NODES) : [];
    const nodes = [];
    for (const node of rawNodes) {
        if (!node || typeof node !== 'object' || !node.styles || typeof node.styles !== 'object') {
            continue;
        }
        const styles = {};
        for (const [key, value] of Object.entries(node.styles)) {
            if (typeof key !== 'string' || typeof value !== 'string') {
                continue;
            }
            const clean = oneLine(value);
            styles[oneLine(key)] = clean.length > MAX_VALUE_LENGTH ? clean.slice(0, MAX_VALUE_LENGTH) : clean;
        }
        if (!Object.keys(styles).length) {
            continue;
        }
        nodes.push({
            label: typeof node.label === 'string' ? oneLine(node.label).slice(0, MAX_LABEL_LENGTH) : '',
            inspPath: typeof node.inspPath === 'string' ? node.inspPath : undefined,
            styles,
        });
    }
    if (!nodes.length) {
        return null;
    }
    return { scope, properties, nodes };
}

/**
 * Build the rendered-styles context lines appended to a generated prompt.
 *
 * Boundary: returns an empty array when the request carries no normalized styles, so prompt formatters can splice it in
 * without changing output for requests that never attached styles. Each node renders its label and one `key: value` line
 * per captured property, in capture order.
 *
 * @param {Record<string, unknown>} request Normalized intent request.
 * @returns {string[]} Prompt context lines (possibly empty).
 */
export function buildStyleContextLines(request) {
    const styles = request?.styles;
    if (!styles || !Array.isArray(styles.nodes) || !styles.nodes.length) {
        return [];
    }
    const lines = [];
    lines.push(styles.scope === 'ancestors'
        ? 'Rendered styles (selected element and ancestors):'
        : 'Rendered styles (selected element):');
    styles.nodes.forEach((node, index) => {
        // Guard each node's `styles` object: normalizeStyles guarantees it, but a partial/un-normalized request must
        // not throw on `Object.entries(undefined)`. A node without renderable styles is skipped entirely.
        const entries = node && node.styles && typeof node.styles === 'object' ? Object.entries(node.styles) : [];
        if (!entries.length) {
            return;
        }
        lines.push(`- ${node.label || `node ${index + 1}`}`);
        for (const [key, value] of entries) {
            lines.push(`    ${key}: ${value}`);
        }
    });
    return lines;
}
