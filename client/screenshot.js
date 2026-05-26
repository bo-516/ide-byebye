import { PLUGIN_NODE_ATTR } from '../shared/constants.js';
const MAX_RENDER_DIMENSION = 1400;

/**
 * Scope value for the standalone parent-node screenshot path.
 * Boundary: this must stay in sync with `SCREENSHOT_SCOPE_ORDER`; a mismatch makes the picker persist a mode the
 * renderer treats as viewport capture.
 */
const PARENT_SCREENSHOT_SCOPE = 'parent';
const STYLE_COPY_BATCH_SIZE = 24;

/** Yield screenshot work to the next animation frame so picker UI can paint before heavy DOM serialization resumes. */
function nextAnimationFrame() {
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

/**
 * Detect computed transparent background values.
 * Boundary: browser engines serialize transparent colors differently; unknown values are treated as visible so page
 * background fallback does not override a real document color.
 * @param {string} value Computed CSS background color.
 * @returns {boolean} True when the value should not be considered an own background.
 */
function isTransparentBackground(value) {
    return !value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)';
}

/**
 * Detect whether an element paints a background visible behind a child subtree.
 * Boundary: this checks only background layers; layout, opacity, filters, and blending remain owned by the captured
 * parent subtree so the parent screenshot area stays bounded by the direct parent node.
 * @param {Element} element Ancestor candidate from the clicked node's parent chain.
 * @returns {boolean} True when the ancestor should provide the clipped wrapper background.
 */
function hasPaintedBackground(element) {
    const computed = window.getComputedStyle(element);
    return !isTransparentBackground(computed.backgroundColor) || computed.backgroundImage !== 'none';
}

/**
 * Check whether an element is too close to the document boundary for parent-subtree capture.
 * Boundary: document roots are intentionally excluded because serializing them turns the parent option back into a
 * viewport-like screenshot.
 * @param {Element | null} element Candidate element from the parent chain.
 * @returns {boolean} True when the candidate should not become the standalone screenshot root.
 */
function isDocumentCaptureBoundary(element) {
    return !element || element === document.documentElement || element === document.body;
}

/**
 * Find the closest ancestor background that visually sits behind a direct parent screenshot.
 * Boundary: the returned element is used only as a clipped background layer. It must not change the screenshot root or
 * dimensions, which are always controlled by `resolveParentCaptureRoot` and the root's bounding box.
 * @param {Element} root Direct parent screenshot root.
 * @returns {Element | null} Closest ancestor with a painted background, if any.
 */
function resolveParentBackgroundSource(root) {
    let current = root.parentElement;
    while (current) {
        if (hasPaintedBackground(current))
            return current;
        if (current === document.documentElement)
            return null;
        current = current.parentElement;
    }
    return null;
}

/**
 * Copy only background styles from an ancestor onto a clipped layer so context colors do not expand capture bounds.
 * @param {Element} source Ancestor element whose background affects the root.
 * @param {HTMLElement} target Empty layer rendered behind the cloned parent subtree.
 * @returns {void}
 */
function copyBackgroundStyles(source, target) {
    const computed = window.getComputedStyle(source);
    for (const prop of [
        'background-color',
        'background-image',
        'background-size',
        'background-position',
        'background-repeat',
        'background-origin',
        'background-clip',
        'background-attachment',
        'border-radius',
    ]) {
        target.style.setProperty(prop, computed.getPropertyValue(prop));
    }
}
function solidPageBackground() {
    const body = window.getComputedStyle(document.body).backgroundColor;
    if (!isTransparentBackground(body))
        return body;
    const doc = window.getComputedStyle(document.documentElement).backgroundColor;
    if (!isTransparentBackground(doc))
        return doc;
    return '#ffffff';
}
function copyInputState(source, clone) {
    if (source instanceof HTMLInputElement && clone instanceof HTMLInputElement) {
        clone.setAttribute('value', source.value);
        if (source.checked)
            clone.setAttribute('checked', '');
    }
    else if (source instanceof HTMLTextAreaElement && clone instanceof HTMLTextAreaElement) {
        clone.textContent = source.value;
    }
    else if (source instanceof HTMLSelectElement && clone instanceof HTMLSelectElement) {
        Array.from(source.options).forEach((option, index) => {
            const cloned = clone.options[index];
            if (cloned)
                cloned.selected = option.selected;
        });
    }
    else if (source instanceof HTMLCanvasElement) {
        try {
            const img = document.createElement('img');
            img.src = source.toDataURL('image/png');
            img.width = source.width;
            img.height = source.height;
            clone.replaceWith(img);
        }
        catch {
            // Cross-origin canvas content cannot be serialized; leave the clone as-is.
        }
    }
}
/**
 * Copy computed styles through a cloned subtree in animation-frame batches; source/clone child order must match, and
 * unmatched descendants are skipped so malformed clones do not block capture.
 * @param {Element} source Live source subtree root.
 * @param {Element} clone Cloned subtree root receiving inline styles.
 * @returns {Promise<void>} Resolves after every reachable descendant has copied computed styles.
 */
async function copyComputedStyles(source, clone) {
    const stack = [[source, clone]];
    let processed = 0;
    while (stack.length) {
        const [currentSource, currentClone] = stack.pop();
        const computed = window.getComputedStyle(currentSource);
        let css = '';
        for (const prop of Array.from(computed))
            css += `${prop}:${computed.getPropertyValue(prop)};`;
        currentClone.setAttribute('style', css);
        copyInputState(currentSource, currentClone);
        const sourceChildren = Array.from(currentSource.children);
        const cloneChildren = Array.from(currentClone.children);
        for (let i = Math.min(sourceChildren.length, cloneChildren.length) - 1; i >= 0; i -= 1)
            stack.push([sourceChildren[i], cloneChildren[i]]);
        processed += 1;
        if (processed % STYLE_COPY_BATCH_SIZE === 0)
            await nextAnimationFrame();
    }
}
function removePluginNodes(root) {
    if (root.hasAttribute(PLUGIN_NODE_ATTR))
        root.remove();
    root.querySelectorAll(`[${PLUGIN_NODE_ATTR}]`).forEach((node) => node.remove());
    root.querySelectorAll('script').forEach((node) => node.remove());
}

/**
 * Resolve same-document SVG sprite ids referenced by a cloned subtree; external sprite URLs stay untouched.
 * @param {Element} root Cloned screenshot subtree.
 * @returns {Set<string>} Referenced SVG ids without leading `#`.
 */
function collectSvgUseIds(root) {
    const ids = new Set();
    root.querySelectorAll('use').forEach((node) => {
        const raw = node.getAttribute('href') ?? node.getAttribute('xlink:href') ?? node.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '';
        const hashIndex = raw.lastIndexOf('#');
        if (hashIndex >= 0 && hashIndex < raw.length - 1)
            ids.add(raw.slice(hashIndex + 1));
    });
    return ids;
}

/**
 * Build a hidden inline SVG sprite for same-document symbols used by the subtree; missing ids are ignored.
 * @param {Element} root Cloned screenshot subtree that may contain `<use>` nodes.
 * @returns {SVGSVGElement | null} Hidden sprite element, or null when no same-document symbols are needed.
 */
function cloneSvgUseDefinitions(root) {
    const ids = collectSvgUseIds(root);
    const symbols = Array.from(ids).map((id) => document.getElementById(id)).filter(Boolean);
    if (!symbols.length)
        return null;
    const sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sprite.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    sprite.setAttribute('aria-hidden', 'true');
    sprite.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    symbols.forEach((symbol) => sprite.append(symbol.cloneNode(true)));
    return sprite;
}

function shouldSkipViewportChild(node) {
    return node.hasAttribute(PLUGIN_NODE_ATTR) || node.tagName.toLowerCase() === 'script';
}
function makeXhtmlWrapper(width, height) {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    wrapper.style.cssText = [
        `width:${width}px`,
        `height:${height}px`,
        'overflow:hidden',
        'position:relative',
        `background:${solidPageBackground()}`,
    ].join(';');
    return wrapper;
}

/**
 * Resolve the root element used by parent-node screenshots.
 * Boundary: `target` should be the real clicked page element, not merely the nearest source-mapped ancestor. The root is
 * strictly its direct parent so the screenshot size matches that parent node instead of expanding to ancestors.
 * @param {Element} target Screenshot anchor element from the user's click.
 * @returns {Element} Direct parent element, or the target itself when the parent is a document boundary.
 */
function resolveParentCaptureRoot(target) {
    const parent = target.parentElement;
    if (isDocumentCaptureBoundary(parent))
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
function resolveElementRenderSize(root) {
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
function makeParentBackgroundLayer(root) {
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
function resolveViewportCropRect(target, scope) {
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
 * @returns {HTMLDivElement} Serializable wrapper for the requested crop.
 */
async function cloneViewport(width, height, cropLeft, cropTop) {
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
    const clone = document.createElement('div');
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    await copyComputedStyles(document.body, clone);
    clone.innerHTML = '';
    for (const child of Array.from(document.body.children)) {
        if (shouldSkipViewportChild(child))
            continue;
        const childClone = child.cloneNode(true);
        await copyComputedStyles(child, childClone);
        removePluginNodes(childClone);
        clone.append(childClone);
    }
    removePluginNodes(clone);
    clone.style.position = 'absolute';
    clone.style.left = `${-window.scrollX}px`;
    clone.style.top = `${-window.scrollY}px`;
    clone.style.width = `${Math.max(document.documentElement.scrollWidth, width)}px`;
    clone.style.minHeight = `${Math.max(document.documentElement.scrollHeight, height)}px`;
    viewport.append(clone);
    wrapper.append(viewport);
    return wrapper;
}

/**
 * Clone one parent subtree into a standalone XHTML wrapper while preserving computed styles and local bounds.
 * @param {Element} root Live parent/root element to clone.
 * @param {number} width Output width in CSS pixels.
 * @param {number} height Output height in CSS pixels.
 * @returns {HTMLDivElement} Serializable wrapper containing the styled subtree.
 */
async function cloneParentSubtree(root, width, height) {
    const wrapper = makeXhtmlWrapper(width, height);
    const backgroundLayer = makeParentBackgroundLayer(root);
    if (backgroundLayer)
        wrapper.append(backgroundLayer);
    const clone = root.cloneNode(true);
    await nextAnimationFrame();
    await copyComputedStyles(root, clone);
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
 * @param {string} scope Screenshot scope requested by the picker.
 * @returns {{ width: number, height: number, wrapper: HTMLDivElement }} Render input for SVG/canvas conversion.
 */
async function resolveScreenshotRender(target, scope) {
    if (scope === PARENT_SCREENSHOT_SCOPE) {
        const root = resolveParentCaptureRoot(target);
        const { width, height } = resolveElementRenderSize(root);
        return { width, height, wrapper: await cloneParentSubtree(root, width, height) };
    }
    const rect = resolveViewportCropRect(target, scope);
    const width = Math.max(1, Math.ceil(rect.width));
    const height = Math.max(1, Math.ceil(rect.height));
    return { width, height, wrapper: await cloneViewport(width, height, rect.left, rect.top) };
}
function svgDataUrl(node, width, height) {
    const xhtml = new XMLSerializer().serializeToString(node);
    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        `<foreignObject width="100%" height="100%">${xhtml}</foreignObject>`,
        '</svg>',
    ].join('');
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to render screenshot image'));
        img.src = src;
    });
}
function renderScale(width, height) {
    const maxScale = Math.min(window.devicePixelRatio || 1, 2, MAX_RENDER_DIMENSION / Math.max(1, width), MAX_RENDER_DIMENSION / Math.max(1, height));
    return Math.max(0.25, maxScale);
}
function encodeCanvas(canvas) {
    const webp = canvas.toDataURL('image/webp', 0.86);
    if (webp.startsWith('data:image/webp'))
        return webp;
    return canvas.toDataURL('image/png');
}
/**
 * Render a screenshot payload for the selected element, its parent subtree, or the viewport.
 * Boundary: DOM is serialized through SVG foreignObject; tainted canvases/cross-origin images may still be limited.
 * @param {Element} target Selected page element; missing/incorrect targets make element-based scopes capture the wrong region.
 * @param {'selection' | 'parent' | 'viewport'} scope Screenshot mode to render.
 * @returns {Promise<{ scope: string, dataUrl: string, width: number, height: number, capturedAt: string }>} Encoded image payload; throws if canvas rendering is unavailable.
 */
export async function captureScreenshot(target, scope) {
    await nextAnimationFrame();
    const background = solidPageBackground();
    const { width, height, wrapper } = await resolveScreenshotRender(target, scope);
    await nextAnimationFrame();
    const image = await loadImage(svgDataUrl(wrapper, width, height));
    const scale = renderScale(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx)
        throw new Error('Canvas rendering is unavailable');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(image, 0, 0, width, height);
    await nextAnimationFrame();
    return {
        scope,
        dataUrl: encodeCanvas(canvas),
        width: canvas.width,
        height: canvas.height,
        capturedAt: new Date().toISOString(),
    };
}
