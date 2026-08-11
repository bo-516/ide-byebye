import { INSP_PATH_ATTR, PLUGIN_NODE_ATTR } from '../../shared/constants.js';
import { collapseWhitespace, truncateSnippet } from '../../shared/util.js';
import { DEFAULT_MAX_TEXT_SNIPPET } from '../../shared/constants.js';
/** True if the node belongs to the plugin's own UI. */
export function isPluginNode(el) {
    return !!(el && el.closest && el.closest(`[${PLUGIN_NODE_ATTR}]`));
}
/**
 * Walk up from the event target to the nearest element carrying a
 * `data-insp-path`, then promote it to the outermost ancestor occupying
 * (almost) the same box. Returns null if none is found or the target is plugin UI.
 */
export function findInspectableElement(target) {
    if (!(target instanceof HTMLElement))
        return null;
    if (isPluginNode(target))
        return null;
    const found = target.closest(`[${INSP_PATH_ATTR}]`);
    return found instanceof HTMLElement ? promoteToOuterSameSizeElement(found) : null;
}
// How far the same-size promotion climbs. Sub-pixel epsilon only absorbs layout rounding (LayoutUnit / zoom),
// it is NOT a design tolerance — any real gap (padding, margin) breaks the chain.
const SAME_SIZE_MAX_LEVELS = 5;
const SAME_BOX_EPSILON_PX = 0.5;
/** The parent's box with its own borders removed — the area a border-only wrapper leaves for its child. */
function insideBorderRect(el) {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
        top: rect.top + parseFloat(cs.borderTopWidth),
        left: rect.left + parseFloat(cs.borderLeftWidth),
        right: rect.right - parseFloat(cs.borderRightWidth),
        bottom: rect.bottom - parseFloat(cs.borderBottomWidth),
    };
}
/** True when two boxes coincide on every edge, up to sub-pixel layout rounding. */
function isSameRect(a, b) {
    return (Math.abs(a.top - b.top) <= SAME_BOX_EPSILON_PX &&
        Math.abs(a.left - b.left) <= SAME_BOX_EPSILON_PX &&
        Math.abs(a.right - b.right) <= SAME_BOX_EPSILON_PX &&
        Math.abs(a.bottom - b.bottom) <= SAME_BOX_EPSILON_PX);
}
/**
 * Promote a picked element to the outermost ancestor drawn as the same visual box.
 * Purpose: when the mapped element sits inside tight wrappers (each adding at most its own border), the user pointing
 * at the box means the whole component, not the innermost node — so selection lands on the outermost such wrapper.
 * Boundary: climbs at most `maxLevels` parents; a parent qualifies only when the child exactly fills the parent's
 * inside-border area (border widths come from computed style, so any border width qualifies while any padding, margin
 * or scrollbar gap breaks the chain). Only ancestors carrying `data-insp-path` are eligible results (unmapped wrappers
 * are climbed through, never returned), and zero-size boxes never promote.
 *
 * @param {HTMLElement} el Inspectable element the pointer resolved to.
 * @param {number} [maxLevels] Maximum ancestor levels to climb.
 * @returns {HTMLElement} The outermost same-size inspectable ancestor, or `el` itself.
 */
export function promoteToOuterSameSizeElement(el, maxLevels = SAME_SIZE_MAX_LEVELS) {
    let rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0)
        return el;
    let best = el;
    let node = el.parentElement;
    for (let level = 0; level < maxLevels && node; level += 1) {
        if (!isSameRect(rect, insideBorderRect(node)))
            break;
        if (node.getAttribute(INSP_PATH_ATTR))
            best = node;
        rect = node.getBoundingClientRect();
        node = node.parentElement;
    }
    return best;
}
function classList(el) {
    const raw = typeof el.className === 'string' ? el.className : el.getAttribute('class');
    const trimmed = (raw ?? '').trim();
    return trimmed || undefined;
}
/** Build a short CSS-like DOM path, e.g. `body > div#root > button.primary`. */
export function buildDomPath(el, maxDepth = 6) {
    const segments = [];
    let node = el;
    while (node && node.nodeType === 1 && segments.length < maxDepth) {
        let seg = node.tagName.toLowerCase();
        if (node.id) {
            segments.unshift(`${seg}#${node.id}`);
            break;
        }
        const cls = classList(node);
        if (cls) {
            seg += '.' + cls.split(/\s+/).slice(0, 2).join('.');
        }
        const parent = node.parentElement;
        if (parent) {
            const sameTag = Array.from(parent.children).filter((c: any) => c.tagName === node.tagName);
            if (sameTag.length > 1) {
                seg += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
            }
        }
        segments.unshift(seg);
        node = parent;
    }
    return segments.join(' > ');
}
/** Collect the DOM summary that travels to the server. */
export function collectSelection(el, maxHtml) {
    const text = (el.innerText || el.textContent || '').trim();
    return {
        inspPath: el.getAttribute(INSP_PATH_ATTR) ?? '',
        tagName: el.tagName.toLowerCase(),
        id: el.id || undefined,
        className: classList(el),
        role: el.getAttribute('role') ?? undefined,
        ariaLabel: el.getAttribute('aria-label') ?? undefined,
        textSnippet: truncateSnippet(collapseWhitespace(text), DEFAULT_MAX_TEXT_SNIPPET),
        outerHTMLSnippet: truncateSnippet(el.outerHTML, maxHtml),
        domPath: buildDomPath(el),
    };
}
function toNum(v) {
    if (v == null)
        return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}
/** Best-effort browser-side parse of a data-insp-path for label display. */
export function parseInspPathLite(raw) {
    if (!raw)
        return { file: '' };
    const value = raw.trim().replace(/^file:\/\//, '');
    const q = value.indexOf('?');
    if (q !== -1) {
        const file = decodeURIComponent(value.slice(0, q));
        const params = new URLSearchParams(value.slice(q + 1));
        return { file, line: toNum(params.get('line')), column: toNum(params.get('column')) };
    }
    const m = value.match(/^(.*?):(\d+):(\d+)(?::.*)?$/);
    if (m)
        return { file: m[1], line: Number(m[2]), column: Number(m[3]) };
    const m2 = value.match(/^(.*?):(\d+)$/);
    if (m2)
        return { file: m2[1], line: Number(m2[2]) };
    return { file: value };
}
export function basename(file) {
    const parts = file.split(/[\\/]/);
    return parts[parts.length - 1] || file;
}
