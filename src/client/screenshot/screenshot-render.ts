import {
    cloneSvgUseDefinitions,
    copyBackgroundStyles,
    copyComputedStyles,
    isDocumentCaptureBoundary,
    makeXhtmlWrapper,
    nextAnimationFrame,
    removePluginNodes,
    resolveParentBackgroundSource,
    shouldSkipViewportChild,
} from './screenshot-dom.js';
import type { AssetCache } from './screenshot-assets.js';
import type { ScreenshotScope } from './screenshot.js';

/**
 * Scope value for the standalone parent-node screenshot path.
 * Boundary: this must stay in sync with `SCREENSHOT_SCOPE_ORDER`; a mismatch makes the picker persist a mode the
 * renderer treats as viewport capture.
 */
const PARENT_SCREENSHOT_SCOPE = 'parent';

/**
 * Serializable-wrapper builders for each screenshot scope.
 *
 * Purpose: turn a live element plus a scope into the XHTML-namespaced wrapper (with computed styles
 * and assets inlined by `screenshot-dom`/`screenshot-assets`) that the rasterizer draws through an
 * SVG `<foreignObject>`.
 *
 * Boundary: the wrapper mirrors live layout at call time; sizes/crops are measured from the live page
 * before cloning so detached or zero-size nodes degrade to a 1px fallback instead of breaking canvas.
 */

/**
 * Resolve the root element used by parent-node screenshots.
 * Boundary: `target` should be the real clicked page element, not merely the nearest source-mapped ancestor. The root is
 * strictly its direct parent so the screenshot size matches that parent node instead of expanding to ancestors.
 * @param {Element} target Screenshot anchor element from the user's click.
 * @returns {Element} Direct parent element, or the target itself when the parent is a document boundary.
 */
export function resolveParentCaptureRoot(target: Element): Element {
    const parent = target.parentElement;
    // Null is already a boundary; the extra check narrows `parent` for strict null checks.
    if (!parent || isDocumentCaptureBoundary(parent))
        return target;
    return parent;
}

/**
 * Resolve the standalone render size for one element subtree.
 * Boundary: `root` is measured from the live page before cloning; detached or zero-size nodes fall back to layout
 * dimensions and finally to a 1px image so canvas creation never receives invalid values.
 * @param {Element} root Element that will become the standalone screenshot root.
 * @returns {{ width: number, height: number }} Render dimensions in CSS pixels.
 */
function resolveElementRenderSize(root: Element): { width: number; height: number } {
    const rect = root.getBoundingClientRect();
    const layoutRoot = root instanceof HTMLElement ? root : null;
    const fallbackWidth = layoutRoot?.scrollWidth || layoutRoot?.clientWidth || rect.width || 1;
    const fallbackHeight = layoutRoot?.scrollHeight || layoutRoot?.clientHeight || rect.height || 1;
    const width = rect.width > 0 ? rect.width : fallbackWidth;
    const height = rect.height > 0 ? rect.height : fallbackHeight;
    return { width: Math.max(1, Math.ceil(width)), height: Math.max(1, Math.ceil(height)) };
}

/**
 * Build a clipped ancestor background layer offset into the direct parent's local screenshot space.
 * @param {Element} root Direct parent screenshot root.
 * @returns {HTMLDivElement | null} Background-only layer, or null when no ancestor paints a background.
 */
function makeParentBackgroundLayer(root: Element): HTMLDivElement | null {
    const backgroundSource = resolveParentBackgroundSource(root);
    if (!backgroundSource)
        return null;
    const rootRect = root.getBoundingClientRect();
    const sourceRect = backgroundSource.getBoundingClientRect();
    const layer = document.createElement('div');
    layer.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    copyBackgroundStyles(backgroundSource, layer);
    layer.style.position = 'absolute';
    layer.style.left = `${Math.floor(sourceRect.left - rootRect.left)}px`;
    layer.style.top = `${Math.floor(sourceRect.top - rootRect.top)}px`;
    layer.style.width = `${Math.max(1, Math.ceil(sourceRect.width))}px`;
    layer.style.height = `${Math.max(1, Math.ceil(sourceRect.height))}px`;
    layer.style.margin = '0';
    layer.style.pointerEvents = 'none';
    return layer;
}

/**
 * Resolve the screenshot crop in viewport coordinates.
 * Boundary: `target` must be the selected page element; off-screen selections collapse to a 1px fallback.
 * @param {Element} target Selected page element used when `scope` is `selection`.
 * @param {'selection' | 'viewport'} scope Requested screenshot mode.
 * @returns {{ left: number, top: number, width: number, height: number }} Crop rectangle; wrong scope falls back to viewport capture.
 */
function resolveViewportCropRect(target: Element, scope: 'selection' | 'viewport'): { left: number; top: number; width: number; height: number } {
    if (scope !== 'selection') {
        return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    }
    const rect = target.getBoundingClientRect();
    const left = Math.max(0, Math.floor(rect.left));
    const top = Math.max(0, Math.floor(rect.top));
    const right = Math.min(window.innerWidth, Math.ceil(rect.right));
    const bottom = Math.min(window.innerHeight, Math.ceil(rect.bottom));
    return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}
/**
 * Clone the page into an XHTML wrapper and crop from viewport coordinates.
 * Boundary: plugin nodes/scripts are removed; crop offsets are viewport offsets, while scroll is applied separately.
 * @param {number} width Output crop width in CSS pixels.
 * @param {number} height Output crop height in CSS pixels.
 * @param {number} cropLeft Left crop edge in viewport coordinates; invalid values shift the rendered page incorrectly.
 * @param {number} cropTop Top crop edge in viewport coordinates; invalid values shift the rendered page incorrectly.
 * @param {Map<string, Promise<string | null>>} assetCache Shared image asset data-url cache for one capture.
 * @returns {HTMLDivElement} Serializable wrapper for the requested crop.
 */
async function cloneViewport(width: number, height: number, cropLeft: number, cropTop: number, assetCache: AssetCache): Promise<HTMLDivElement> {
    const wrapper = makeXhtmlWrapper(width, height);
    const viewport = document.createElement('div');
    viewport.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    viewport.style.cssText = [
        `width:${window.innerWidth}px`,
        `height:${window.innerHeight}px`,
        'overflow:visible',
        'position:relative',
        `transform:translate(${-cropLeft}px,${-cropTop}px)`,
        'transform-origin:top left',
    ].join(';');
    const page = document.createElement('div');
    page.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    page.style.cssText = [
        `width:${Math.max(document.documentElement.scrollWidth, width)}px`,
        `min-height:${Math.max(document.documentElement.scrollHeight, height)}px`,
        'position:absolute',
        `left:${-window.scrollX}px`,
        `top:${-window.scrollY}px`,
        'margin:0',
        'padding:0',
    ].join(';');
    const clone = document.createElement('div');
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    await copyComputedStyles(document.body, clone, assetCache);
    clone.innerHTML = '';
    for (const child of Array.from(document.body.children)) {
        if (shouldSkipViewportChild(child))
            continue;
        // cloneNode is typed as Node; cloning an Element yields an Element.
        const childClone = child.cloneNode(true) as Element;
        await copyComputedStyles(child, childClone, assetCache);
        removePluginNodes(childClone);
        clone.append(childClone);
    }
    removePluginNodes(clone);
    page.append(clone);
    viewport.append(page);
    wrapper.append(viewport);
    return wrapper;
}

/**
 * Clone one parent subtree into a standalone XHTML wrapper while preserving computed styles and local bounds.
 * @param {Element} root Live parent/root element to clone.
 * @param {number} width Output width in CSS pixels.
 * @param {number} height Output height in CSS pixels.
 * @param {Map<string, Promise<string | null>>} assetCache Shared image asset data-url cache for one capture.
 * @returns {HTMLDivElement} Serializable wrapper containing the styled subtree.
 */
async function cloneParentSubtree(root: Element, width: number, height: number, assetCache: AssetCache): Promise<HTMLDivElement> {
    const wrapper = makeXhtmlWrapper(width, height);
    const backgroundLayer = makeParentBackgroundLayer(root);
    if (backgroundLayer)
        wrapper.append(backgroundLayer);
    // cloneNode is typed as Node; the clone is the same HTML or SVG element and is styled below.
    const clone = root.cloneNode(true) as HTMLElement | SVGElement;
    await nextAnimationFrame();
    await copyComputedStyles(root, clone, assetCache);
    removePluginNodes(clone);
    const sprite = cloneSvgUseDefinitions(clone);
    if (sprite)
        wrapper.append(sprite);
    clone.style.position = 'relative';
    clone.style.left = '0px';
    clone.style.top = '0px';
    clone.style.right = 'auto';
    clone.style.bottom = 'auto';
    clone.style.margin = '0';
    clone.style.zIndex = '1';
    wrapper.append(clone);
    return wrapper;
}

/**
 * Build the serializable DOM wrapper and dimensions for one screenshot mode.
 * Boundary: parent-node screenshots render only the selected element's parent subtree; other modes keep the original
 * viewport clone-and-crop path. Unknown scopes continue to fall back to viewport capture through `resolveViewportCropRect`.
 * @param {Element} target Selected page element.
 * @param {'selection' | 'parent' | 'viewport'} scope Screenshot scope requested by the picker.
 * @param {Map<string, Promise<string | null>>} assetCache Shared image asset data-url cache for one capture.
 * @returns {{ width: number, height: number, wrapper: HTMLDivElement }} Render input for SVG/canvas conversion.
 */
export async function resolveScreenshotRender(target: Element, scope: ScreenshotScope, assetCache: AssetCache): Promise<{ width: number; height: number; wrapper: HTMLDivElement }> {
    if (scope === PARENT_SCREENSHOT_SCOPE) {
        const root = resolveParentCaptureRoot(target);
        const { width, height } = resolveElementRenderSize(root);
        return { width, height, wrapper: await cloneParentSubtree(root, width, height, assetCache) };
    }
    const rect = resolveViewportCropRect(target, scope);
    const width = Math.max(1, Math.ceil(rect.width));
    const height = Math.max(1, Math.ceil(rect.height));
    return { width, height, wrapper: await cloneViewport(width, height, rect.left, rect.top, assetCache) };
}

/**
 * Pick the subtree whose assets must settle before capture, matching the rendered scope.
 * @param {Element} target Selected page element.
 * @param {string} scope Requested screenshot mode.
 * @returns {Element} Wait root: the document body, the parent root, or the target itself.
 */
export function resolveAssetWaitRoot(target: Element, scope: string): Element {
    if (scope === 'viewport')
        return document.body;
    if (scope === PARENT_SCREENSHOT_SCOPE)
        return resolveParentCaptureRoot(target);
    return target;
}
