import { isReactBoundary, nearestReactStamp, reactRenderChain, type RenderChain } from './react-tree.js';
import { isVueBoundary } from './vue-teleport.js';
import { nearestVueStamp, vueOwnerTop, vueRenderChain } from './vue-tree.js';

/**
 * Component-tree fallbacks for the picker: React fibers first, then Vue instances.
 *
 * Purpose: the one entry point the DOM rules in `dom.ts` call where DOM ancestors stop describing where an element
 * came from — portal and Teleport roots, and Teleported library markup that carries no `data-insp-path`.
 * Boundary: every function swallows errors thrown while reading framework internals and reports "no tree information"
 * (`false` / `null`), so a React or Vue build with different internals degrades to the plain DOM rules instead of
 * throwing into the page. Preact, Solid, Svelte and Angular elements always get "no tree information".
 */

/**
 * Whether `el` is a portal / Teleport root (or was moved by non-framework code): its DOM parent is not its logical
 * parent, so DOM walks must stop there.
 *
 * @param {Element} el DOM element.
 * @returns {boolean} True for a boundary; false for every other element and on any internal error.
 */
export function isFrameworkBoundary(el: Element): boolean {
    try {
        return isReactBoundary(el) || isVueBoundary(el);
    }
    catch {
        return false;
    }
}

/**
 * Nearest location for `el` from the component tree: the closest stamped fiber (React) or component usage (Vue).
 *
 * @param {Element} el Element without a usable `data-insp-path` of its own (usually a boundary).
 * @returns {string | null} Path in `data-insp-path` form, or `null` without tree information.
 */
export function componentLocationOf(el: Element): string | null {
    try {
        return nearestReactStamp(el) ?? nearestVueStamp(el);
    }
    catch {
        return null;
    }
}

/**
 * Render chain for a primary pick: the pick, then its mount points (one per file, at most
 * `MAX_RENDER_CHAIN_ENTRIES`), and whether a portal / Teleport sits on the way to the root.
 *
 * @param {Element} el The element the pick resolved to.
 * @param {string} pickedPath The pick's `inspPath`; becomes `renderChain[0]`.
 * @returns {RenderChain | null} Chain and portal flag, or `null` without tree information.
 */
export function pickRenderChain(el: Element, pickedPath: string): RenderChain | null {
    try {
        return reactRenderChain(el, pickedPath) ?? vueRenderChain(el, pickedPath);
    }
    catch {
        return null;
    }
}

/**
 * Element to highlight when no `data-insp-path` exists anywhere above a Vue target (Teleported library markup): the
 * outermost element its owner rendered, provided some usage site above that owner is stamped.
 *
 * @param {Element} target Event target.
 * @returns {Element | null} That element, or `null` when the Vue tree has no location either.
 */
export function vueFallbackElement(target: Element): Element | null {
    try {
        return nearestVueStamp(target) ? vueOwnerTop(target) : null;
    }
    catch {
        return null;
    }
}
