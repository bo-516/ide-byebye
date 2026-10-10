import { PLUGIN_NODE_ATTR } from '../../shared/constants.js';
import { absoluteAssetUrl, inlineAssetDataUrl, inlineCssImageUrls, type AssetCache } from './screenshot-assets.js';

const STYLE_COPY_BATCH_SIZE = 24;
const ASSET_WAIT_TIMEOUT_MS = 1800;

/**
 * DOM cloning and style inlining for screenshot capture.
 *
 * Purpose: walk a live subtree, copy computed styles and element state onto a detached clone, inline
 * what the SVG `<foreignObject>` renderer can reach (images, pseudo content, SVG `<use>` symbols), and
 * wait out late-loading assets before serialization.
 *
 * Boundary: reads the live page but only mutates the detached clone. The helpers that other modules
 * reuse are the exports; everything else is internal mechanics.
 */

/**
 * Yield to the next animation frame so picker UI can paint before heavy DOM serialization resumes.
 * Boundary: `requestAnimationFrame` is paused while the document is hidden (background tab) or fully offscreen, which
 * would otherwise hang capture forever; a short `setTimeout` fallback guarantees the promise still settles in that case.
 */
export function nextAnimationFrame(): Promise<void> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled)
                return;
            settled = true;
            resolve();
        };
        window.requestAnimationFrame(finish);
        window.setTimeout(finish, 100);
    });
}

function timeout(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | void> {
    return Promise.race([promise, timeout(ms)]);
}

/**
 * Resolve the window that owns a node so computed styles are read from the node's own document.
 * Boundary: nodes living inside another document (e.g. an rrweb replay iframe) must use that document's window, or
 * `getComputedStyle` would read from the wrong context. Detached nodes without a defaultView fall back to the top
 * `window`, which is correct for normal top-document screenshot nodes.
 * @param {Node} node Source node whose computed styles will be read.
 * @returns {Window} The owning window, or the top window as a fallback.
 */
function ownerWindow(node: Node): Window {
    return (node && node.ownerDocument && node.ownerDocument.defaultView) || window;
}

/**
 * Detect computed transparent background values.
 * Boundary: browser engines serialize transparent colors differently; unknown values are treated as visible so page
 * background fallback does not override a real document color.
 * @param {string} value Computed CSS background color.
 * @returns {boolean} True when the value should not be considered an own background.
 */
function isTransparentBackground(value: string): boolean {
    return !value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)';
}

/**
 * Detect whether an element paints a background visible behind a child subtree.
 * Boundary: this checks only background layers; layout, opacity, filters, and blending remain owned by the captured
 * parent subtree so the parent screenshot area stays bounded by the direct parent node.
 * @param {Element} element Ancestor candidate from the clicked node's parent chain.
 * @returns {boolean} True when the ancestor should provide the clipped wrapper background.
 */
function hasPaintedBackground(element: Element): boolean {
    const computed = ownerWindow(element).getComputedStyle(element);
    return !isTransparentBackground(computed.backgroundColor) || computed.backgroundImage !== 'none';
}

/**
 * Check whether an element is too close to the document boundary for parent-subtree capture.
 * Boundary: document roots are intentionally excluded because serializing them turns the parent option back into a
 * viewport-like screenshot.
 * @param {Element | null} element Candidate element from the parent chain.
 * @returns {boolean} True when the candidate should not become the standalone screenshot root.
 */
export function isDocumentCaptureBoundary(element: Element | null): boolean {
    return !element || element === document.documentElement || element === document.body;
}

/**
 * Find the closest ancestor background that visually sits behind a direct parent screenshot.
 * Boundary: the returned element is used only as a clipped background layer. It must not change the screenshot root or
 * dimensions, which are always controlled by `resolveParentCaptureRoot` and the root's bounding box.
 * @param {Element} root Direct parent screenshot root.
 * @returns {Element | null} Closest ancestor with a painted background, if any.
 */
export function resolveParentBackgroundSource(root: Element): Element | null {
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
export function copyBackgroundStyles(source: Element, target: HTMLElement): void {
    const computed = ownerWindow(source).getComputedStyle(source);
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

/**
 * Resolve the page's effective solid background color for rasterizing.
 * Boundary: falls back to white when body and document element are both transparent so the encoded
 * image is never fully transparent.
 * @returns {string} Computed background color or `#ffffff`.
 */
export function solidPageBackground(): string {
    const body = window.getComputedStyle(document.body).backgroundColor;
    if (!isTransparentBackground(body))
        return body;
    const doc = window.getComputedStyle(document.documentElement).backgroundColor;
    if (!isTransparentBackground(doc))
        return doc;
    return '#ffffff';
}

function cssTextFromComputed(computed: CSSStyleDeclaration): string {
    let css = '';
    for (const prop of Array.from(computed))
        css += `${prop}:${computed.getPropertyValue(prop)};`;
    return css;
}

function decodeCssString(value: string): string | null {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed
            .slice(1, -1)
            .replace(/\\([0-9a-fA-F]{1,6}\s?|.)/g, (_: string, escaped: string) => {
            const hex = escaped.trim();
            if (/^[0-9a-fA-F]+$/.test(hex))
                return String.fromCodePoint(Number.parseInt(hex, 16));
            return escaped;
        });
    }
    return null;
}

function pseudoContentText(content: string): string | null {
    if (!content || content === 'none' || content === 'normal')
        return null;
    const decoded = decodeCssString(content);
    return decoded && decoded.length ? decoded : null;
}

async function makePseudoClone(source: Element, pseudo: string, assetCache: AssetCache): Promise<HTMLSpanElement | null> {
    if (!(source instanceof HTMLElement))
        return null;
    const computed = ownerWindow(source).getComputedStyle(source, pseudo);
    const text = pseudoContentText(computed.getPropertyValue('content'));
    if (text == null)
        return null;
    const node = document.createElement('span');
    node.setAttribute('aria-hidden', 'true');
    node.setAttribute('data-cii-pseudo', pseudo);
    const css = await inlineCssImageUrls(cssTextFromComputed(computed), assetCache);
    node.setAttribute('style', css);
    node.textContent = text;
    return node;
}

async function copyElementState(source: Element, clone: Element, assetCache: AssetCache): Promise<boolean> {
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
    else if (source instanceof HTMLImageElement && clone instanceof HTMLImageElement) {
        const sourceUrl = source.currentSrc || source.src || source.getAttribute('src');
        if (sourceUrl) {
            const absolute = absoluteAssetUrl(sourceUrl);
            const dataUrl = await inlineAssetDataUrl(absolute, assetCache);
            clone.removeAttribute('srcset');
            clone.removeAttribute('sizes');
            clone.setAttribute('src', dataUrl || absolute);
        }
        clone.setAttribute('decoding', 'sync');
        clone.setAttribute('loading', 'eager');
    }
    else if (source instanceof HTMLSourceElement && clone instanceof HTMLSourceElement) {
        clone.removeAttribute('srcset');
        clone.removeAttribute('sizes');
    }
    else if (source instanceof HTMLCanvasElement) {
        try {
            const img = document.createElement('img');
            img.src = source.toDataURL('image/png');
            img.width = source.width;
            img.height = source.height;
            clone.replaceWith(img);
            return false;
        }
        catch {
            // Cross-origin canvas content cannot be serialized; leave the clone as-is.
        }
    }
    else if (typeof SVGImageElement !== 'undefined' && source instanceof SVGImageElement && clone instanceof SVGImageElement) {
        const raw = source.getAttribute('href') ?? source.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (raw) {
            const absolute = absoluteAssetUrl(raw);
            const dataUrl = await inlineAssetDataUrl(absolute, assetCache);
            clone.setAttribute('href', dataUrl || absolute);
            clone.setAttributeNS('http://www.w3.org/1999/xlink', 'href', dataUrl || absolute);
        }
    }
    return true;
}

async function waitForImageReady(img: HTMLImageElement): Promise<void> {
    if (!img.currentSrc && !img.src)
        return;
    if (!img.complete) {
        await withTimeout(new Promise<void>((resolve) => {
            // The settled value is ignored; wrapping keeps the listener typed as Event.
            const done = () => resolve();
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
        }), ASSET_WAIT_TIMEOUT_MS);
    }
    if (img.decode) {
        await withTimeout(img.decode().catch(() => undefined), ASSET_WAIT_TIMEOUT_MS);
    }
}

/**
 * Wait for fonts and images under a render root to settle before serialization.
 * Boundary: every wait is capped by `ASSET_WAIT_TIMEOUT_MS` so a hung asset cannot stall capture.
 * @param {Element} root Subtree (or `document.body` for viewport captures) whose assets must settle.
 * @returns {Promise<void>} Resolves when assets are ready or the timeout elapsed.
 */
export async function waitForRenderableAssets(root: Element): Promise<void> {
    const fontReady = document.fonts?.ready ? document.fonts.ready.catch(() => undefined) : Promise.resolve(undefined);
    const imageRoot = root === document.body ? document : root;
    const images = imageRoot instanceof Document
        ? Array.from(imageRoot.images)
        : Array.from(imageRoot.querySelectorAll('img'));
    await withTimeout(Promise.all([fontReady, ...images.map((img) => waitForImageReady(img))]), ASSET_WAIT_TIMEOUT_MS);
}
/**
 * Copy computed styles through a cloned subtree in animation-frame batches; source/clone child order must match, and
 * unmatched descendants are skipped so malformed clones do not block capture.
 * @param {Element} source Live source subtree root.
 * @param {Element} clone Cloned subtree root receiving inline styles.
 * @param {Map<string, Promise<string | null>>} assetCache Shared image asset data-url cache for one capture.
 * @returns {Promise<void>} Resolves after every reachable descendant has copied computed styles.
 */
export async function copyComputedStyles(source: Element, clone: Element, assetCache: AssetCache): Promise<void> {
    const stack: Array<[Element, Element]> = [[source, clone]];
    let processed = 0;
    while (stack.length) {
        // Length was checked above; pop() is undefined only if the stack was emptied elsewhere.
        const [currentSource, currentClone] = stack.pop()!;
        const computed = ownerWindow(currentSource).getComputedStyle(currentSource);
        const sourceChildren = Array.from(currentSource.children);
        const cloneChildren = Array.from(currentClone.children);
        let css = cssTextFromComputed(computed);
        css = await inlineCssImageUrls(css, assetCache);
        currentClone.setAttribute('style', css);
        const shouldDescend = await copyElementState(currentSource, currentClone, assetCache);
        if (!shouldDescend)
            continue;
        if (currentClone instanceof HTMLElement) {
            const before = await makePseudoClone(currentSource, '::before', assetCache);
            const after = await makePseudoClone(currentSource, '::after', assetCache);
            if (before)
                currentClone.insertBefore(before, currentClone.firstChild);
            if (after)
                currentClone.append(after);
        }
        for (let i = Math.min(sourceChildren.length, cloneChildren.length) - 1; i >= 0; i -= 1)
            stack.push([sourceChildren[i], cloneChildren[i]]);
        processed += 1;
        if (processed % STYLE_COPY_BATCH_SIZE === 0)
            await nextAnimationFrame();
    }
}

/**
 * Strip plugin-owned nodes and scripts out of a cloned subtree.
 * @param {Element} root Clone subtree to clean.
 * @returns {void}
 */
export function removePluginNodes(root: Element): void {
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
function collectSvgUseIds(root: Element): Set<string> {
    const ids = new Set<string>();
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
export function cloneSvgUseDefinitions(root: Element): SVGSVGElement | null {
    const ids = collectSvgUseIds(root);
    // `filter(Boolean)` does not drop null from the element type; this predicate keeps the same exclusion.
    const symbols = Array.from(ids).map((id) => document.getElementById(id)).filter((symbol): symbol is HTMLElement => symbol != null);
    if (!symbols.length)
        return null;
    const sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sprite.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    sprite.setAttribute('aria-hidden', 'true');
    sprite.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    symbols.forEach((symbol) => sprite.append(symbol.cloneNode(true)));
    return sprite;
}

/**
 * Check whether a direct body child must be skipped by viewport cloning.
 * @param {Element} node Body child candidate.
 * @returns {boolean} True for plugin-owned nodes and scripts.
 */
export function shouldSkipViewportChild(node: Element): boolean {
    return node.hasAttribute(PLUGIN_NODE_ATTR) || node.tagName.toLowerCase() === 'script';
}

/**
 * Build the XHTML-namespaced wrapper that `svgDataUrl` embeds in `<foreignObject>`.
 * @param {number} width Output crop width in CSS pixels.
 * @param {number} height Output crop height in CSS pixels.
 * @returns {HTMLDivElement} Positioned, overflow-hidden wrapper painted with the page background.
 */
export function makeXhtmlWrapper(width: number, height: number): HTMLDivElement {
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
