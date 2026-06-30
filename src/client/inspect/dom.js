import { INSP_PATH_ATTR, PLUGIN_NODE_ATTR } from '../../shared/constants.js';
import { collapseWhitespace, truncateSnippet } from '../../shared/util.js';
import { DEFAULT_MAX_TEXT_SNIPPET } from '../../shared/constants.js';
/** True if the node belongs to the plugin's own UI. */
export function isPluginNode(el) {
    return !!(el && el.closest && el.closest(`[${PLUGIN_NODE_ATTR}]`));
}
/**
 * Walk up from the event target to the nearest element carrying a
 * `data-insp-path`. Returns null if none is found or the target is plugin UI.
 */
export function findInspectableElement(target) {
    if (!(target instanceof HTMLElement))
        return null;
    if (isPluginNode(target))
        return null;
    const found = target.closest(`[${INSP_PATH_ATTR}]`);
    return found instanceof HTMLElement ? found : null;
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
            const sameTag = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
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
