import { INSP_PATH_ATTR } from '../../shared/constants.js';
import { MAX_TREE_STEPS, pushChainEntry, type RenderChain } from './react-tree.js';
import { isVueTeleported, vueOwnerOf, type InstanceLike } from './vue-teleport.js';

/**
 * Vue 3 component-tree reads for the picker (Vue 3.2+ dev builds).
 *
 * Purpose: library components that `<Teleport>` their markup drop the caller's attributes, so that markup carries no
 * `data-insp-path`, but the instance that rendered it (`__vueParentComponent`, set on every element in dev builds)
 * still holds the props of its usage site. These helpers read that location and build the mount chain; Teleport
 * roots are found by `vue-teleport.ts`.
 * Boundary: read-only. Elements without an owner and walks past `MAX_TREE_STEPS` mean "no tree information" (`null`).
 * Exceptions are caught by `component-tree.ts`, not here.
 */

/** @returns {string | null} The `data-insp-path` an instance's usage site passed it, or `null`. */
function stampOfInstance(instance: InstanceLike): string | null {
    const value = instance.vnode?.props?.[INSP_PATH_ATTR];
    return typeof value === 'string' && value ? value : null;
}

/**
 * Nearest component usage site above an element: the first `data-insp-path` among its owner's props and theirs.
 *
 * @param {object} el DOM element or test double.
 * @returns {string | null} Path in `data-insp-path` form, or `null` (no owner, or no stamped usage up to the root).
 */
export function nearestVueStamp(el: object): string | null {
    let instance = vueOwnerOf(el);
    for (let steps = 0; instance && steps < MAX_TREE_STEPS; steps += 1) {
        const path = stampOfInstance(instance);
        if (path)
            return path;
        instance = instance.parent;
    }
    return null;
}

/**
 * Outermost element above `el` (inclusive) that the same instance rendered: what a fallback pick highlights.
 *
 * @param {Element} el Picked element.
 * @returns {Element} That ancestor, or `el` itself when it has no owner.
 */
export function vueOwnerTop(el: Element): Element {
    const owner = vueOwnerOf(el);
    let top = el;
    for (let steps = 0; owner && top.parentElement && steps < MAX_TREE_STEPS; steps += 1) {
        if (vueOwnerOf(top.parentElement) !== owner)
            break;
        top = top.parentElement;
    }
    return top;
}

/**
 * Render chain of a picked element: its location, then each usage site from another file up the instance chain.
 *
 * @param {Element} el Picked element (a DOM hit, or the element a fallback highlights).
 * @param {string} pickedPath The pick's own location; becomes `renderChain[0]`.
 * @returns {RenderChain | null} Chain and Teleport flag, or `null` when the element has no owner.
 */
export function vueRenderChain(el: Element, pickedPath: string): RenderChain | null {
    const owner = vueOwnerOf(el);
    const renderChain = [pickedPath];
    if (!owner)
        return null;
    let instance: InstanceLike | null = owner;
    for (let steps = 0; instance && steps < MAX_TREE_STEPS; steps += 1) {
        pushChainEntry(renderChain, stampOfInstance(instance));
        instance = instance.parent;
    }
    return { renderChain, portal: isVueTeleported(el) };
}
