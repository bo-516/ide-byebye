import { INSP_PATH_ATTR } from '../../shared/constants.js';

/**
 * Same-size promotion: from a picked element up to the outermost stamped ancestor drawn as the same box.
 *
 * Boundary: reads layout only (`getBoundingClientRect`, computed border widths). It never decides which element was
 * hit; `findInspectableElement` in `dom.ts` does that and passes the framework-boundary test as `stopAt`.
 */

// How far the same-size promotion climbs. Sub-pixel epsilon only absorbs layout rounding (LayoutUnit / zoom),
// it is NOT a design tolerance — any real gap (padding, margin) breaks the chain.
const SAME_SIZE_MAX_LEVELS = 5;
const SAME_BOX_EPSILON_PX = 0.5;

/** Viewport edges of a box, as `getBoundingClientRect` reports them. */
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
export interface SameSizeNode {
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

/** Default `stopAt`: climb as far as the layout allows. */
function neverStop(): boolean {
    return false;
}

/**
 * Promote a picked element to the outermost ancestor drawn as the same visual box.
 * Purpose: when the mapped element sits inside tight wrappers (each adding at most its own border), the user pointing
 * at the box means the whole component, not the innermost node — so selection lands on the outermost such wrapper.
 * Boundary: climbs at most `maxLevels` parents; a parent qualifies only when the child exactly fills the parent's
 * inside-border area (border widths come from computed style, so any border width qualifies while any padding, margin
 * or scrollbar gap breaks the chain). Only ancestors carrying `data-insp-path` are eligible results (unmapped wrappers
 * are climbed through, never returned), and zero-size boxes never promote. A node for which `stopAt` returns true can
 * still be the result, but the walk never climbs above it — a portal root's DOM parent is a container elsewhere in the
 * page, not part of the picked component.
 *
 * @param {SameSizeNode} el Inspectable node the pointer resolved to. DOM elements and test doubles both qualify.
 * @param {number} [maxLevels] Maximum ancestor levels to climb. Omitted climbs at most 5 levels.
 * @param {(node: SameSizeNode) => boolean} [stopAt] Nodes the walk must not climb past. Omitted never stops early;
 *        it is only consulted for a node whose parent already has the same box.
 * @returns {SameSizeNode} The outermost same-size inspectable ancestor, or `el` itself.
 */
export function promoteToOuterSameSizeElement(el: SameSizeNode, maxLevels = SAME_SIZE_MAX_LEVELS, stopAt: (node: SameSizeNode) => boolean = neverStop): SameSizeNode {
    let rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0)
        return el;
    let best = el;
    let child = el;
    let node = el.parentElement;
    for (let level = 0; level < maxLevels && node; level += 1) {
        if (!isSameRect(rect, insideBorderRect(node)) || stopAt(child))
            break;
        if (node.getAttribute(INSP_PATH_ATTR))
            best = node;
        rect = node.getBoundingClientRect();
        child = node;
        node = node.parentElement;
    }
    return best;
}
