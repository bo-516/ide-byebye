import { INSP_PATH_ATTR, PLUGIN_NODE_ATTR } from '../../shared/constants.js';
import { collapseWhitespace, truncateSnippet } from '../../shared/util.js';
import { DEFAULT_MAX_TEXT_SNIPPET } from '../../shared/constants.js';
import { angularComponentOf, angularLocationLabel, angularSelection } from './angular-source.js';
/**
 * True if the node belongs to the plugin's own UI.
 *
 * @param {unknown} el Event target or test double. A node without `closest` is not plugin UI.
 * @returns {boolean} Whether the node sits inside a plugin host.
 */
export function isPluginNode(el: unknown): boolean {
    // Cast erases. `closest` stays a double read so a getter runs for the truthiness check and again for the query.
    const node = el as { closest?: (selector: string) => unknown } | null;
    return !!(node && node.closest && node.closest(`[${PLUGIN_NODE_ATTR}]`));
}
/**
 * Walk up from the event target to the nearest element carrying a
 * `data-insp-path`, then promote it to the outermost ancestor occupying
 * (almost) the same box. In Angular dev builds (no stamped attributes) the target
 * itself is inspectable when Angular knows its owning component. Returns null if
 * none is found or the target is plugin UI.
 *
 * @param {unknown} target Event target. Non-elements and plugin UI yield null.
 * @returns {HTMLElement | null} Inspectable element, or null.
 */
export function findInspectableElement(target: unknown): HTMLElement | null {
    if (!(target instanceof HTMLElement))
        return null;
    if (isPluginNode(target))
        return null;
    const found = target.closest(`[${INSP_PATH_ATTR}]`);
    if (found instanceof HTMLElement) {
        // Promotion accepts layout doubles. Both assertions erase, so this still returns the element (or an ancestor).
        return promoteToOuterSameSizeElement(found as unknown as SameSizeNode) as HTMLElement;
    }
    return angularComponentOf(target) ? target : null;
}

/**
 * Source location string for labelling an inspectable element (hover overlay).
 *
 * Boundary: the stamped `data-insp-path` wins; Angular elements get their component's `file:line` (cheap enough for
 * mousemove — the unique per-element path is built by {@link collectSelection} at pick time); anything else yields
 * `''` (callers treat it as "no mapping").
 *
 * @param {Element} el Inspectable element.
 * @returns {string} `data-insp-path`-shaped location, or `''`.
 */
export function inspPathOf(el: Element): string {
    return el.getAttribute(INSP_PATH_ATTR) || angularLocationLabel(el) || '';
}
// How far the same-size promotion climbs. Sub-pixel epsilon only absorbs layout rounding (LayoutUnit / zoom),
// it is NOT a design tolerance — any real gap (padding, margin) breaks the chain.
const SAME_SIZE_MAX_LEVELS = 5;
const SAME_BOX_EPSILON_PX = 0.5;

interface BoxEdges {
    top: number;
    left: number;
    right: number;
    bottom: number;
}

/**
 * Layout node the same-size walk reads. DOM elements satisfy it; unit tests pass plain objects.
 * `getComputedStyle` is cast to `Element` because the DOM global does not accept this structural shape.
 */
interface SameSizeNode {
    parentElement: SameSizeNode | null;
    getBoundingClientRect(): BoxEdges & { width: number; height: number };
    getAttribute(name: string): string | null;
}

/** The parent's box with its own borders removed — the area a border-only wrapper leaves for its child. */
function insideBorderRect(el: SameSizeNode): BoxEdges {
    const cs = getComputedStyle(el as unknown as Element);
    const rect = el.getBoundingClientRect();
    return {
        top: rect.top + parseFloat(cs.borderTopWidth),
        left: rect.left + parseFloat(cs.borderLeftWidth),
        right: rect.right - parseFloat(cs.borderRightWidth),
        bottom: rect.bottom - parseFloat(cs.borderBottomWidth),
    };
}
/** True when two boxes coincide on every edge, up to sub-pixel layout rounding. */
function isSameRect(a: BoxEdges, b: BoxEdges): boolean {
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
 * @param {SameSizeNode} el Inspectable node the pointer resolved to. DOM elements and test doubles both qualify.
 * @param {number} [maxLevels] Maximum ancestor levels to climb. Omitted climbs at most 5 levels.
 * @returns {SameSizeNode} The outermost same-size inspectable ancestor, or `el` itself.
 */
export function promoteToOuterSameSizeElement(el: SameSizeNode, maxLevels = SAME_SIZE_MAX_LEVELS): SameSizeNode {
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
function classList(el: Element): string | undefined {
    // SVG `className` is an object. Both reads stay so a string getter still runs twice, as before the cast.
    const raw = typeof (el as { className?: unknown }).className === 'string'
        ? (el as { className?: unknown }).className as string
        : el.getAttribute('class');
    const trimmed = (raw ?? '').trim();
    return trimmed || undefined;
}
/**
 * Build a short CSS-like DOM path, e.g. `body > div#root > button.primary`.
 *
 * @param {Element} el Start element. Non-elements stop the walk.
 * @param {number} [maxDepth] Maximum segments. Omitted uses 6.
 * @returns {string} Path from an ancestor down to `el`.
 */
export function buildDomPath(el: Element, maxDepth = 6): string {
    const segments: string[] = [];
    // `parentElement` is `HTMLElement | null`, so the cursor has to admit null or the climb cannot move up.
    let node: Element | null = el;
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
        // Alias so the sibling filter does not close over `node` while `node` is assigned `parent`.
        // The annotation breaks the inference cycle; `tagName` is still read once per sibling.
        const current: Element = node;
        const parent: HTMLElement | null = current.parentElement;
        if (parent) {
            const sameTag = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
            if (sameTag.length > 1) {
                seg += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
            }
        }
        segments.unshift(seg);
        node = parent;
    }
    return segments.join(' > ');
}
/**
 * Collect the DOM summary that travels to the server.
 *
 * Boundary: Angular elements (no stamped attribute) also carry `angular`, the owner-declared ancestor hint the server
 * matches against the component template; stamped elements never send it. An omitted `maxHtml` is forwarded as-is
 * (`undefined` still reaches `truncateSnippet`); callers that pass a number cap the outerHTML snippet.
 *
 * @param {HTMLElement} el Picked element.
 * @param {number | undefined} maxHtml OuterHTML cap. `undefined` is not coerced.
 * @returns {object} DOM summary. `inspPath` may be empty when nothing maps.
 */
export function collectSelection(el: HTMLElement, maxHtml: number | undefined) {
    const text = (el.innerText || el.textContent || '').trim();
    const stamped = el.getAttribute(INSP_PATH_ATTR);
    const angular = stamped ? null : angularSelection(el);
    return {
        inspPath: stamped ?? angular?.inspPath ?? '',
        ...(angular ? { angular: angular.hint } : {}),
        tagName: el.tagName.toLowerCase(),
        id: el.id || undefined,
        className: classList(el),
        role: el.getAttribute('role') ?? undefined,
        ariaLabel: el.getAttribute('aria-label') ?? undefined,
        textSnippet: truncateSnippet(collapseWhitespace(text), DEFAULT_MAX_TEXT_SNIPPET),
        outerHTMLSnippet: truncateSnippet(el.outerHTML, maxHtml as number),
        domPath: buildDomPath(el),
    };
}
function toNum(v: unknown): number | undefined {
    if (v == null)
        return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}
/**
 * Best-effort browser-side parse of a data-insp-path for label display.
 *
 * @param {unknown} raw Attribute or selection path. Nullish yields `{ file: '' }`. A non-string still hits `trim`.
 * @returns {{ file: string, line?: number, column?: number }} Parsed location. Never null.
 */
export function parseInspPathLite(raw: unknown): { file: string; line?: number; column?: number } {
    if (!raw)
        return { file: '' };
    // `sourceReferenceLabel` passes `unknown`. The assertion erases, so a truthy non-string still throws on `trim`.
    const value = (raw as string).trim().replace(/^file:\/\//, '');
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
/**
 * Last path segment, for overlay labels.
 *
 * @param {string} file Path from {@link parseInspPathLite}. An empty string returns `''`.
 * @returns {string} Segment after the last slash or backslash.
 */
export function basename(file: string): string {
    const parts = file.split(/[\\/]/);
    return parts[parts.length - 1] || file;
}
