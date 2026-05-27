// shared/constants.js
/**
 * Constants shared between the browser client and the Node server. Must remain
 * free of Node-only APIs.
 */
var ROUTE_PREFIX = '/__intent-inspector';
var ENDPOINTS = {
    client: `${ROUTE_PREFIX}/client.js`,
    agents: `${ROUTE_PREFIX}/agents`,
    resolve: `${ROUTE_PREFIX}/resolve`,
    send: `${ROUTE_PREFIX}/send`,
};
/** Header carrying the per-session dev token. */
var TOKEN_HEADER = 'x-intent-inspector-token';
/** Global variable name holding the injected `ClientConfig`. */
var CLIENT_CONFIG_GLOBAL = '__CODE_INTENT_INSPECTOR__';
/** Marker attribute set on every node owned by the plugin's own UI. */
var PLUGIN_NODE_ATTR = 'data-intent-inspector-ui';
/** The attribute injected by code-inspector-plugin we read back. */
var INSP_PATH_ATTR = 'data-insp-path';
var DEFAULT_HOTKEY = 'Alt+Shift+I';
var DEFAULT_OUTPUT_DIR = '.intent-inspector';
var DEFAULT_MAX_SOURCE_CONTEXT_LINES = 60;
var DEFAULT_MAX_COMPONENT_LINES = 300;
var DEFAULT_MAX_TEXT_SNIPPET = 300;
var DEFAULT_MAX_HTML_SNIPPET = 1000;
var OVERLAY_Z_INDEX = 2147483646;
var DIALOG_Z_INDEX = 2147483647;
var ALL_AGENT_NAMES = [
    'clipboard',
    'file',
    'codex-app',
    'codex-sdk',
    'codex-app-server',
    'claude-app',
    'claude-cli',
    'claude-agent-sdk',
];

// shared/util.js
/** Pure helpers usable on both client and server. */
/**
 * Truncate a string to `max` characters, appending a single-line ellipsis
 * marker that records how many characters were dropped. Returns `undefined`
 * for empty input so optional fields stay omitted.
 */
function truncateSnippet(value, max) {
    if (value == null)
        return undefined;
    const normalized = String(value);
    if (normalized.length === 0)
        return undefined;
    if (normalized.length <= max)
        return normalized;
    const dropped = normalized.length - max;
    return `${normalized.slice(0, max)}… [+${dropped} chars truncated]`;
}
/** Collapse runs of whitespace into single spaces and trim. */
function collapseWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
}

// client/dom.js
/** True if the node belongs to the plugin's own UI. */
function isPluginNode(el) {
    return !!(el && el.closest && el.closest(`[${PLUGIN_NODE_ATTR}]`));
}
/**
 * Walk up from the event target to the nearest element carrying a
 * `data-insp-path`. Returns null if none is found or the target is plugin UI.
 */
function findInspectableElement(target) {
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
function buildDomPath(el, maxDepth = 6) {
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
function collectSelection(el, maxHtml) {
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
function parseInspPathLite(raw) {
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
function basename(file) {
    const parts = file.split(/[\\/]/);
    return parts[parts.length - 1] || file;
}

// client/screenshot.js
const MAX_RENDER_DIMENSION = 1400;

/**
 * Scope value for the standalone parent-node screenshot path.
 * Boundary: this must stay in sync with `SCREENSHOT_SCOPE_ORDER`; a mismatch makes the picker persist a mode the
 * renderer treats as viewport capture.
 */
const PARENT_SCREENSHOT_SCOPE = 'parent';
const STYLE_COPY_BATCH_SIZE = 24;
const ASSET_WAIT_TIMEOUT_MS = 1800;
const ASSET_INLINE_TIMEOUT_MS = 2500;

/** Yield screenshot work to the next animation frame so picker UI can paint before heavy DOM serialization resumes. */
function nextAnimationFrame() {
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function timeout(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withTimeout(promise, ms) {
    return Promise.race([promise, timeout(ms)]);
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

function absoluteAssetUrl(raw) {
    if (!raw || raw.startsWith('data:') || raw.startsWith('#'))
        return raw;
    try {
        return new URL(raw, document.baseURI).href;
    }
    catch {
        return raw;
    }
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read image asset'));
        reader.readAsDataURL(blob);
    });
}

function inlineAssetDataUrl(url, assetCache) {
    const absolute = absoluteAssetUrl(url);
    if (!absolute || absolute.startsWith('data:'))
        return Promise.resolve(absolute);
    if (assetCache.has(absolute))
        return assetCache.get(absolute);
    const promise = (async () => {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? window.setTimeout(() => controller.abort(), ASSET_INLINE_TIMEOUT_MS) : 0;
        try {
            const sameOrigin = new URL(absolute, document.baseURI).origin === window.location.origin;
            const response = await fetch(absolute, {
                cache: 'force-cache',
                credentials: sameOrigin ? 'include' : 'omit',
                signal: controller?.signal,
            });
            if (!response.ok)
                return null;
            const blob = await response.blob();
            if (!blob.type.startsWith('image/'))
                return null;
            return await blobToDataUrl(blob);
        }
        catch {
            return null;
        }
        finally {
            if (timer)
                window.clearTimeout(timer);
        }
    })();
    assetCache.set(absolute, promise);
    return promise;
}

function cssUrl(value) {
    const escaped = String(value).replace(/["\\\n\r\f]/g, '\\$&');
    return `url("${escaped}")`;
}

async function inlineCssImageUrls(css, assetCache) {
    if (!css.includes('url('))
        return css;
    const pattern = /url\((['"]?)(.*?)\1\)/g;
    let result = '';
    let lastIndex = 0;
    for (const match of css.matchAll(pattern)) {
        const raw = match[2]?.trim();
        result += css.slice(lastIndex, match.index);
        if (!raw || raw.startsWith('data:') || raw.startsWith('#')) {
            result += match[0];
        }
        else {
            const absolute = absoluteAssetUrl(raw);
            const dataUrl = await inlineAssetDataUrl(absolute, assetCache);
            result += cssUrl(dataUrl || absolute);
        }
        lastIndex = match.index + match[0].length;
    }
    result += css.slice(lastIndex);
    return result;
}

function cssTextFromComputed(computed) {
    let css = '';
    for (const prop of Array.from(computed))
        css += `${prop}:${computed.getPropertyValue(prop)};`;
    return css;
}

function decodeCssString(value) {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed
            .slice(1, -1)
            .replace(/\\([0-9a-fA-F]{1,6}\s?|.)/g, (_, escaped) => {
            const hex = escaped.trim();
            if (/^[0-9a-fA-F]+$/.test(hex))
                return String.fromCodePoint(Number.parseInt(hex, 16));
            return escaped;
        });
    }
    return null;
}

function pseudoContentText(content) {
    if (!content || content === 'none' || content === 'normal')
        return null;
    const decoded = decodeCssString(content);
    return decoded && decoded.length ? decoded : null;
}

async function makePseudoClone(source, pseudo, assetCache) {
    if (!(source instanceof HTMLElement))
        return null;
    const computed = window.getComputedStyle(source, pseudo);
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

async function copyElementState(source, clone, assetCache) {
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

async function waitForImageReady(img) {
    if (!img.currentSrc && !img.src)
        return;
    if (!img.complete) {
        await withTimeout(new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
        }), ASSET_WAIT_TIMEOUT_MS);
    }
    if (img.decode) {
        await withTimeout(img.decode().catch(() => undefined), ASSET_WAIT_TIMEOUT_MS);
    }
}

async function waitForRenderableAssets(root) {
    const fontReady = document.fonts?.ready ? document.fonts.ready.catch(() => undefined) : Promise.resolve();
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
async function copyComputedStyles(source, clone, assetCache) {
    const stack = [[source, clone]];
    let processed = 0;
    while (stack.length) {
        const [currentSource, currentClone] = stack.pop();
        const computed = window.getComputedStyle(currentSource);
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
 * @param {Map<string, Promise<string | null>>} assetCache Shared image asset data-url cache for one capture.
 * @returns {HTMLDivElement} Serializable wrapper for the requested crop.
 */
async function cloneViewport(width, height, cropLeft, cropTop, assetCache) {
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
        const childClone = child.cloneNode(true);
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
async function cloneParentSubtree(root, width, height, assetCache) {
    const wrapper = makeXhtmlWrapper(width, height);
    const backgroundLayer = makeParentBackgroundLayer(root);
    if (backgroundLayer)
        wrapper.append(backgroundLayer);
    const clone = root.cloneNode(true);
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
 * @param {string} scope Screenshot scope requested by the picker.
 * @param {Map<string, Promise<string | null>>} assetCache Shared image asset data-url cache for one capture.
 * @returns {{ width: number, height: number, wrapper: HTMLDivElement }} Render input for SVG/canvas conversion.
 */
async function resolveScreenshotRender(target, scope, assetCache) {
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

function resolveAssetWaitRoot(target, scope) {
    if (scope === 'viewport')
        return document.body;
    if (scope === PARENT_SCREENSHOT_SCOPE)
        return resolveParentCaptureRoot(target);
    return target;
}

/**
 * Render a screenshot payload for the selected element, its parent subtree, or the viewport.
 * Boundary: DOM is serialized through SVG foreignObject; cross-origin images without CORS still cannot be inlined and
 * may be unavailable to the browser's SVG image renderer.
 * @param {Element} target Selected page element; missing/incorrect targets make element-based scopes capture the wrong region.
 * @param {'selection' | 'parent' | 'viewport'} scope Screenshot mode to render.
 * @returns {Promise<{ scope: string, dataUrl: string, width: number, height: number, capturedAt: string }>} Encoded image payload; throws if canvas rendering is unavailable.
 */
async function captureScreenshot(target, scope) {
    await nextAnimationFrame();
    await waitForRenderableAssets(resolveAssetWaitRoot(target, scope));
    const background = solidPageBackground();
    const assetCache = new Map();
    const { width, height, wrapper } = await resolveScreenshotRender(target, scope, assetCache);
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

// client/dialog-utils.js
var SCREENSHOT_PREF_KEY = 'code-intent-inspector:screenshot-scopes';
var LAST_AGENT_PREF_KEY = 'code-intent-inspector:last-app-agent';

/**
 * Screenshot scopes in render and persistence order.
 * Boundary: values must match `captureScreenshot` branches; stale or unsupported stored values are filtered out by
 * `loadScreenshotChoices` before they reach the capture pipeline.
 */
var SCREENSHOT_SCOPE_ORDER = ['selection', 'parent', 'viewport'];

/**
 * Full Chinese labels for screenshot scopes.
 * Boundary: keys must cover every value in `SCREENSHOT_SCOPE_ORDER`; missing keys make previews fall back to viewport.
 */
var SCREENSHOT_SCOPE_LABELS = {
    selection: '区域截图',
    parent: '父节点截图',
    viewport: '全屏截图',
};

/**
 * Compact Chinese labels for screenshot picker titles.
 * Boundary: keys must cover every value in `SCREENSHOT_SCOPE_ORDER`; missing keys make active titles fall back to full
 * viewport wording.
 */
var SCREENSHOT_SCOPE_TITLE_LABELS = {
    selection: '区域',
    parent: '父节点',
    viewport: '全屏',
};
var AGENT_LABELS = {
    'codex-app': 'Codex App',
    'claude-app': 'Claude App',
};
var AGENT_ACTIONS = [
    {
        name: 'codex-app',
        label: 'Codex App',
        title: 'Open Codex App with this UI change intent prefilled.',
    },
    {
        name: 'claude-app',
        label: 'Claude App',
        title: 'Open Claude App with this UI change intent prefilled.',
    },
];

/**
 * Create a DOM node for the shadow-root dialog UI.
 *
 * Boundary: `tag` must be a valid HTML tag name; passing untrusted text is safe because it is assigned through
 * `textContent`, while callers that need rich children must append nodes themselves.
 *
 * @param {string} tag HTML tag name to create.
 * @param {string | undefined} className Optional class string assigned directly to the element.
 * @param {string | undefined} text Optional plain text content.
 * @returns {HTMLElement} Created element ready for caller-specific attributes and listeners.
 */
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className)
        node.className = className;
    if (text != null)
        node.textContent = text;
    return node;
}

/**
 * Return the app actions displayed in the dialog footer.
 *
 * Boundary: this currently exposes only app deeplink agents; adding non-app agents here also makes Enter target them,
 * so callers should keep the list limited to user-visible app buttons.
 *
 * @returns {Array<{ name: string, label: string, title: string }>} Ordered footer app actions.
 */
function configuredActions() {
    return AGENT_ACTIONS;
}

/**
 * Load persisted screenshot choices from localStorage.
 *
 * Boundary: malformed storage, unavailable storage, and stale values are ignored. The returned set contains only
 * scopes in `SCREENSHOT_SCOPE_ORDER`; callers must still capture the screenshots before sending.
 *
 * @returns {Set<string>} Valid screenshot scopes selected by the user.
 */
function loadScreenshotChoices() {
    try {
        const raw = window.localStorage.getItem(SCREENSHOT_PREF_KEY);
        if (!raw)
            return new Set();
        const value = JSON.parse(raw);
        if (!Array.isArray(value))
            return new Set();
        return new Set(value.filter((scope) => SCREENSHOT_SCOPE_ORDER.includes(scope)));
    }
    catch {
        return new Set();
    }
}

/**
 * Persist screenshot choices as a best-effort UI preference.
 *
 * Boundary: storage failures are swallowed so private browsing or quota issues do not block the dialog. Passing scopes
 * outside `SCREENSHOT_SCOPE_ORDER` drops them instead of leaking unsupported values into storage.
 *
 * @param {Set<string>} choices Screenshot scope set from the current dialog.
 * @returns {void}
 */
function saveScreenshotChoices(choices) {
    try {
        window.localStorage.setItem(SCREENSHOT_PREF_KEY, JSON.stringify(SCREENSHOT_SCOPE_ORDER.filter((scope) => choices.has(scope))));
    }
    catch {
        // Preference persistence is best effort; the picker still works without it.
    }
}

/**
 * Pick the app agent that Enter should submit to.
 *
 * Boundary: a stale localStorage value or a disabled configured default falls back to the first visible app action.
 * Returning an unavailable-but-configured agent is intentional because the send path owns availability errors.
 *
 * @param {Record<string, unknown>} config Browser config injected by the plugin.
 * @returns {string} Agent name to use for Enter and the footer marker.
 */
function loadLastAgent(config) {
    const visibleAgents = configuredActions().map((action) => action.name);
    const enabledAgents = Array.isArray(config.enabledAgents) ? config.enabledAgents : [];
    const fallback = visibleAgents.includes(config.defaultAgent) && enabledAgents.includes(config.defaultAgent)
        ? config.defaultAgent
        : (visibleAgents.find((agent) => enabledAgents.includes(agent)) ?? visibleAgents[0]);
    try {
        const raw = window.localStorage.getItem(LAST_AGENT_PREF_KEY);
        return visibleAgents.includes(raw) && enabledAgents.includes(raw) ? raw : fallback;
    }
    catch {
        return fallback;
    }
}

/**
 * Persist the app agent most recently chosen by button click or Enter.
 *
 * Boundary: only visible app agents are persisted. Invalid values and storage failures are ignored so callers can
 * invoke this optimistically before the agent availability check finishes.
 *
 * @param {string} agent Agent name requested by the user.
 * @returns {void}
 */
function saveLastAgent(agent) {
    if (!configuredActions().some((action) => action.name === agent))
        return;
    try {
        window.localStorage.setItem(LAST_AGENT_PREF_KEY, agent);
    }
    catch {
        // Preference persistence is best effort; Enter still uses the in-memory value.
    }
}

/**
 * Resolve a screen anchor from the selected page element.
 *
 * Boundary: missing or detached elements return null, which makes the dialog center itself. The returned point is in
 * viewport coordinates and should be consumed before layout changes move the element.
 *
 * @param {Element | null} element Element used to position the dialog near the user's click.
 * @returns {{ x: number, y: number } | null} Center point for dialog placement.
 */
function anchorFromElement(element) {
    if (!element)
        return null;
    const rect = element.getBoundingClientRect();
    return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
    };
}

/**
 * Clamp a number into an inclusive range.
 *
 * Boundary: when `max` is less than `min`, the minimum is returned so callers can handle cramped viewports without
 * producing NaN or inverted coordinates.
 *
 * @param {number} value Proposed value.
 * @param {number} min Inclusive lower bound.
 * @param {number} max Inclusive upper bound.
 * @returns {number} Clamped value.
 */
function clamp(value, min, max) {
    if (max < min)
        return min;
    return Math.min(Math.max(value, min), max);
}

/**
 * Convert a screenshot scope into the Chinese label used in previews.
 *
 * Boundary: unknown scopes are treated as viewport screenshots so stale stored choices still get a stable label.
 *
 * @param {string} scope Screenshot scope value.
 * @returns {string} Human-readable label.
 */
function screenshotScopeLabel(scope) {
    return SCREENSHOT_SCOPE_LABELS[scope] ?? SCREENSHOT_SCOPE_LABELS.viewport;
}

/**
 * Convert a screenshot scope into the compact Chinese label used in the picker title.
 *
 * Boundary: unknown scopes are treated as viewport screenshots; callers should still validate persisted choices through
 * `SCREENSHOT_SCOPE_ORDER` before using them.
 *
 * @param {string} scope Screenshot scope value.
 * @returns {string} Compact title label without the `截图` suffix.
 */
function screenshotScopeTitleLabel(scope) {
    return SCREENSHOT_SCOPE_TITLE_LABELS[scope] ?? SCREENSHOT_SCOPE_TITLE_LABELS.viewport;
}

/**
 * Build the compact link label for an additional source reference chip.
 *
 * Boundary: invalid or missing `data-insp-path` values fall back to a numbered generic label; callers should still
 * send the original selection so the server can perform authoritative validation. This is only a local fallback; the
 * dialog asks the server for the project-relative `@path #range` label before inserting normal references.
 *
 * @param {Record<string, unknown>} selection Browser selection collected from a page element.
 * @param {number} index Zero-based reference index.
 * @returns {string} Compact fallback label such as `@Button.jsx #42`.
 */
function sourceReferenceLabel(selection, index) {
    const parsed = parseInspPathLite(selection?.inspPath ?? '');
    if (!parsed.file)
        return `代码 ${index + 1}`;
    const line = parsed.line != null ? ` #${parsed.line}` : '';
    return `@${basename(parsed.file)}${line}`;
}

// client/dialog-intent-text.js
/**
 * clampIntentTextIndex(value, max): 把 textarea 光标位置限制在当前文本范围内。
 *
 * 作用：防止隐藏弹窗期间文本变化后继续使用过期 selectionStart/selectionEnd。
 * 边界：value 不是有限数字时回退到文本末尾；max 传错时按 0 处理。
 *
 * @param {number} value 待校验的光标位置。
 * @param {number} max 当前 textarea 文本最大索引。
 * @returns {number} 可安全传给 setSelectionRange 的位置。
 */
function clampIntentTextIndex(value, max) {
    const safeMax = Math.max(0, Number(max) || 0);
    if (!Number.isFinite(value)) {
        return safeMax;
    }
    return Math.min(Math.max(0, value), safeMax);
}

/**
 * readIntentTextRange(textarea, fallback): 读取或回退 textarea 光标范围。
 *
 * 作用：记录用户最后一次在输入框里出现的光标位置，供隐藏选择代码引用后恢复插入点。
 * 边界：textarea 缺失或 selection 字段不可读时使用 fallback；fallback 传错时回到 0。
 *
 * @param {HTMLTextAreaElement | null} textarea 目标输入框。
 * @param {{ start: number, end: number }} fallback 上一次可用光标范围。
 * @returns {{ start: number, end: number }} 规整后的光标范围。
 */
function readIntentTextRange(textarea, fallback = { start: 0, end: 0 }) {
    const max = textarea?.value?.length ?? 0;
    const fallbackStart = clampIntentTextIndex(fallback?.start, max);
    const fallbackEnd = clampIntentTextIndex(fallback?.end, max);
    if (!(textarea instanceof HTMLTextAreaElement)) {
        return { start: fallbackStart, end: fallbackEnd };
    }
    return {
        start: clampIntentTextIndex(textarea.selectionStart, max),
        end: clampIntentTextIndex(textarea.selectionEnd, max),
    };
}

/**
 * createSpacedReferenceInsertText(label, value, start, end): 创建引用标签插入文本。
 *
 * 作用：让 `@src/File.jsx #12-45` 被插入到自然语言句子中时前后有一个语义边界空格。
 * 边界：已有空白不会重复补空格；label 为空时返回空字符串。
 *
 * @param {string} label 展示给用户的引用标签。
 * @param {string} value textarea 当前完整文本。
 * @param {number} start 插入范围起点。
 * @param {number} end 插入范围终点。
 * @returns {string} 可拼进 textarea 的引用文本。
 */
function createSpacedReferenceInsertText(label, value, start, end) {
    const text = String(label || '').trim();
    if (!text) {
        return '';
    }
    const before = String(value || '').slice(0, start);
    const after = String(value || '').slice(end);
    const prefix = /\s$/.test(before) ? '' : ' ';
    const suffix = /^\s/.test(after) ? '' : ' ';
    return `${prefix}${text}${suffix}`;
}

/**
 * createIntentTextController(getTextarea): 创建弹窗意图输入框的光标与引用插入控制器。
 *
 * 作用：在用户点击“添加代码引用”后记录 textarea 光标，并在选中页面元素时把短引用插回原位置。
 * 边界：只修改本地 textarea value，不负责 source payload；payload 仍由 DialogReferenceController 持有。
 *
 * @param {Function} getTextarea 返回当前 textarea；返回空值时 capture/insert 会安全降级。
 * @returns {{ bind: Function, capture: Function, insert: Function, reset: Function }} 输入框控制方法。
 */
function createIntentTextController(getTextarea) {
    let range = { start: 0, end: 0 };
    const resolveTextarea = () => {
        const textarea = getTextarea?.();
        return textarea instanceof HTMLTextAreaElement ? textarea : null;
    };
    const capture = () => {
        range = readIntentTextRange(resolveTextarea(), range);
        return range;
    };
    return {
        bind(textarea) {
            if (!(textarea instanceof HTMLTextAreaElement)) {
                return;
            }
            const track = () => {
                range = readIntentTextRange(textarea, range);
            };
            ['focus', 'click', 'keyup', 'select', 'input', 'blur'].forEach((eventName) => {
                textarea.addEventListener(eventName, track);
            });
            track();
        },
        capture,
        insert(label) {
            const textarea = resolveTextarea();
            const text = String(label || '').trim();
            if (!textarea || !text) {
                return;
            }
            const value = textarea.value ?? '';
            const currentRange = {
                start: clampIntentTextIndex(range.start, value.length),
                end: clampIntentTextIndex(range.end, value.length),
            };
            const start = Math.min(currentRange.start, currentRange.end);
            const end = Math.max(currentRange.start, currentRange.end);
            const insertText = createSpacedReferenceInsertText(text, value, start, end);
            const cursor = start + insertText.length;
            textarea.value = `${value.slice(0, start)}${insertText}${value.slice(end)}`;
            textarea.setSelectionRange(cursor, cursor);
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            range = { start: cursor, end: cursor };
        },
        reset() {
            range = { start: 0, end: 0 };
        },
    };
}

// client/dialog-reference-picker.js
const REFERENCE_SWALLOWED_EVENTS = ['mousedown', 'pointerdown', 'mouseup', 'pointerup', 'dblclick', 'contextmenu'];

/**
 * One-shot page picker used while the dialog is already open.
 *
 * Boundary: this picker owns only the temporary "add another @code reference" interaction. It hides the dialog through
 * callbacks, swallows page events while active, and returns a collected browser selection; the server remains
 * responsible for source validation and context extraction.
 */
class DialogReferencePicker {
    config;
    overlay;
    callbacks;
    active = false;
    hovered = null;
    constructor(config, overlay, callbacks) {
        this.config = config;
        this.overlay = overlay;
        this.callbacks = callbacks;
    }

    /**
     * Report whether the reference picker currently owns page events.
     *
     * Boundary: callers use this to avoid duplicate listener registration; it does not imply the dialog is visible.
     *
     * @returns {boolean} True while a reference pick is in progress.
     */
    isActive() {
        return this.active;
    }

    /**
     * Enter reference-picking mode.
     *
     * Boundary: starting while already active is ignored. The dialog callback hides the backdrop before the user clicks
     * through to the page, and Escape is the only keyboard cancellation path while the dialog is hidden.
     *
     * @returns {void}
     */
    start() {
        if (this.active)
            return;
        this.active = true;
        this.callbacks.onStart?.();
        document.addEventListener('mousemove', this.onMouseMove, true);
        document.addEventListener('click', this.onClick, true);
        document.addEventListener('keydown', this.onKeyDown, true);
        window.addEventListener('scroll', this.onScroll, true);
        for (const type of REFERENCE_SWALLOWED_EVENTS) {
            document.addEventListener(type, this.swallow, true);
        }
        document.documentElement.style.cursor = 'crosshair';
    }

    /**
     * Cancel reference picking and restore the dialog.
     *
     * Boundary: this is safe to call even when inactive. Passing `restore: false` is used during dialog teardown so the
     * hidden dialog is not brought back after it has been closed.
     *
     * @param {{ restore?: boolean }} options Cancellation behavior flags.
     * @returns {void}
     */
    cancel(options = {}) {
        if (!this.active)
            return;
        this.deactivate();
        if (options.restore !== false)
            this.callbacks.onCancel?.();
    }

    /**
     * Remove listeners and visual state for the current pick.
     *
     * Boundary: this does not call user callbacks, allowing select and cancel paths to decide whether to restore,
     * append a reference, or leave the dialog closed.
     *
     * @returns {void}
     */
    deactivate() {
        if (!this.active)
            return;
        this.active = false;
        document.removeEventListener('mousemove', this.onMouseMove, true);
        document.removeEventListener('click', this.onClick, true);
        document.removeEventListener('keydown', this.onKeyDown, true);
        window.removeEventListener('scroll', this.onScroll, true);
        for (const type of REFERENCE_SWALLOWED_EVENTS) {
            document.removeEventListener(type, this.swallow, true);
        }
        document.documentElement.style.cursor = '';
        this.overlay.hide();
        this.hovered = null;
    }

    /**
     * Swallow page input while allowing plugin UI events through.
     *
     * Boundary: the dialog is hidden during normal picking, but this guard keeps the handler safe if the user starts a
     * pick and the plugin UI becomes visible again before listeners are removed.
     *
     * @param {Event} event Captured page event.
     * @returns {void}
     */
    swallow = (event) => {
        if (isPluginNode(event.target))
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    /**
     * Update the overlay as the user hovers potential reference targets.
     *
     * Boundary: only elements with a source mapping can be selected; unmapped elements are highlighted with the existing
     * "no source mapping" state but do not complete the pick.
     *
     * @param {MouseEvent} event Mouse move event from the page.
     * @returns {void}
     */
    onMouseMove = (event) => {
        const target = event.target;
        if (isPluginNode(target)) {
            this.overlay.hide();
            return;
        }
        const inspectable = findInspectableElement(target);
        if (inspectable) {
            this.hovered = inspectable;
            this.overlay.showFor(inspectable);
        }
        else if (target instanceof HTMLElement) {
            this.hovered = null;
            this.overlay.showNoMapping(target);
        }
        else {
            this.overlay.hide();
        }
    };

    /**
     * Keep the overlay aligned with the hovered element during scroll.
     *
     * Boundary: no work is done when there is no current mapped hover target.
     *
     * @returns {void}
     */
    onScroll = () => {
        if (this.hovered)
            this.overlay.showFor(this.hovered);
    };

    /**
     * Complete the reference pick from a mapped page element.
     *
     * Boundary: page clicks are always swallowed. Unmapped targets keep the picker active so the user can try another
     * nearby element without reopening the dialog.
     *
     * @param {MouseEvent} event Captured click event.
     * @returns {void}
     */
    onClick = (event) => {
        if (isPluginNode(event.target))
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const inspectable = findInspectableElement(event.target);
        if (!inspectable) {
            if (event.target instanceof HTMLElement)
                this.overlay.showNoMapping(event.target);
            return;
        }
        const selection = collectSelection(inspectable, this.config.maxDomSnippetLength);
        this.deactivate();
        this.callbacks.onSelect?.(selection, inspectable, { x: event.clientX, y: event.clientY });
    };

    /**
     * Cancel the hidden-dialog pick when the user presses Escape.
     *
     * Boundary: other keys are ignored so text input and browser shortcuts do not leak into the page while picking.
     *
     * @param {KeyboardEvent} event Captured keydown event.
     * @returns {void}
     */
    onKeyDown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.cancel();
        }
    };
}

// client/dialog-references.js
/**
 * Local controller for extra `@code` references in the dialog.
 *
 * Boundary: this owns one-shot picking and the raw source selections for the current intent. The visible short label is
 * inserted into the host textarea, while server-side source resolution remains authoritative.
 */
class DialogReferenceController {
    picker;
    host;
    button;
    previewEl;
    items = [];
    constructor(config, overlay, host) {
        this.host = host;
        this.picker = new DialogReferencePicker(config, overlay, {
            onStart: () => this.setPicking(true),
            onCancel: () => this.setPicking(false),
            onSelect: (selection) => void this.addSelection(selection),
        });
    }

    /**
     * Reset extra reference state for a newly opened dialog.
     *
     * Boundary: this does not touch persisted preferences because references are always per intent.
     *
     * @returns {void}
     */
    reset() {
        this.items = [];
    }

    /**
     * Cancel hidden picking and clear chip state when the dialog closes.
     *
     * Boundary: `restore: false` prevents a hidden dialog from being shown again after close.
     *
     * @returns {void}
     */
    clear() {
        this.picker.cancel({ restore: false });
        this.items = [];
    }

    /**
     * Attach the chip preview container for the current dialog render.
     *
     * Boundary: callers must pass the current dialog's container; stale containers will be overwritten on next render.
     *
     * @param {HTMLElement} previewEl Reference chip container.
     * @returns {void}
     */
    attachPreview(previewEl) {
        this.previewEl = previewEl;
        this.previewEl.hidden = true;
    }

    /**
     * Render the footer button that starts selecting another source reference.
     *
     * Boundary: the button records the textarea cursor, hides the dialog, and enters page-picking mode; Escape cancels
     * and restores the dialog.
     *
     * @returns {HTMLButtonElement} Footer icon button.
     */
    renderButton() {
        this.button = el('button', 'cii-icon-btn cii-reference-btn');
        this.button.type = 'button';
        this.button.title = '添加代码引用';
        this.button.setAttribute('aria-label', '添加代码引用');
        this.button.append(el('span', 'cii-code-ref-icon'));
        this.button.addEventListener('click', (event) => {
            event.stopPropagation();
            this.host.captureIntentCursor?.();
            this.picker.start();
        });
        return this.button;
    }

    /**
     * Disable or enable the reference button during busy states.
     *
     * Boundary: active hidden picking is not canceled here; the dialog only disables the visible control while resolving
     * or sending.
     *
     * @param {boolean} disabled Whether the reference button should be disabled.
     * @returns {void}
     */
    setDisabled(disabled) {
        if (this.button)
            this.button.disabled = disabled;
    }

    /**
     * Report whether the hidden page picker is currently active.
     *
     * Boundary: this mirrors the underlying one-shot picker state so the dialog can avoid closing on Escape while a
     * reference pick should merely be canceled.
     *
     * @returns {boolean} True while the page picker owns events.
     */
    isPicking() {
        return this.picker.isActive();
    }

    /**
     * Return raw selections for the send payload.
     *
     * Boundary: these selections have not been server-validated. Empty lists return an empty array so the dialog can
     * omit the payload field; when intentText is passed, references whose inline label was removed are omitted.
     *
     * @param {string | undefined} intentText Current textarea value used to keep inline text and hidden payload aligned.
     * @returns {Array<Record<string, unknown>>} Additional source selections.
     */
    payloadSelections(intentText) {
        const shouldFilterByIntent = typeof intentText === 'string';
        const text = String(intentText ?? '');
        return this.items
            .filter((item) => !shouldFilterByIntent || text.includes(item.label))
            .map((item) => item.selection);
    }

    /**
     * Hide or restore the dialog while the user picks a page element.
     *
     * Boundary: the backdrop is hidden rather than destroyed so textarea content and screenshots survive the pick.
     *
     * @param {boolean} active True while hidden picking is active.
     * @returns {void}
     */
    setPicking(active) {
        this.host.setBackdropHidden(active);
        if (this.button) {
            this.button.classList.toggle('cii-icon-btn-active', active);
            this.button.setAttribute('aria-pressed', active ? 'true' : 'false');
        }
        if (!active)
            this.host.focusIntent();
    }

    /**
     * Resolve the inline text inserted for one selected reference.
     *
     * Boundary: the browser only knows `file:line` from `data-insp-path`; the server resolves the AST range and
     * project-relative path, so normal labels become `@src/Button.jsx #12-45`.
     *
     * @param {Record<string, unknown>} selection Browser selection collected by the reference picker.
     * @param {number} index Zero-based fallback index.
     * @returns {Promise<string>} Text inserted into the intent textarea.
     */
    async resolveLabel(selection, index) {
        const fallback = sourceReferenceLabel(selection, index);
        const label = await this.host.resolveReferenceText?.(selection);
        const text = String(label || '').trim();
        return text || fallback;
    }

    /**
     * Add a selected page element as an extra source reference.
     *
     * Boundary: duplicate `data-insp-path` values are ignored to avoid repeated prompt lines and duplicate inline text.
     *
     * @param {Record<string, unknown>} selection Browser selection collected by the reference picker.
     * @returns {Promise<void>}
     */
    async addSelection(selection) {
        if (!selection?.inspPath) {
            this.setPicking(false);
            return;
        }
        if (this.items.some((item) => item.selection?.inspPath === selection.inspPath)) {
            this.setPicking(false);
            return;
        }
        let label;
        try {
            label = await this.resolveLabel(selection, this.items.length);
        }
        catch (err) {
            if (this.host.isOpen?.() !== false) {
                this.setPicking(false);
                this.host.showError?.(err instanceof Error ? err.message : String(err));
            }
            return;
        }
        if (this.host.isOpen?.() === false)
            return;
        if (this.items.some((item) => item.selection?.inspPath === selection.inspPath)) {
            this.setPicking(false);
            return;
        }
        this.items = [...this.items, { label, selection }];
        this.host.insertReferenceText?.(label);
        this.renderPreviews();
        this.setPicking(false);
        this.host.reposition();
    }

    /**
     * Render link-like chips for additional source references when a preview container is attached.
     *
     * Boundary: current dialog layout inserts labels into the textarea and does not attach a preview container. This
     * fallback keeps older hosts working without changing the outgoing references.
     *
     * @returns {void}
     */
    renderPreviews() {
        if (!this.previewEl)
            return;
        this.previewEl.innerHTML = '';
        this.previewEl.hidden = this.items.length === 0;
        this.items.forEach((item, index) => {
            const label = item.label ?? sourceReferenceLabel(item.selection, index);
            const chip = el('span', 'cii-code-ref-chip');
            const link = el('button', 'cii-code-ref-link', label);
            link.type = 'button';
            link.title = item.selection?.inspPath ?? '';
            const remove = el('button', 'cii-code-ref-remove', '×');
            remove.type = 'button';
            remove.setAttribute('aria-label', `移除${label}`);
            remove.addEventListener('click', () => this.remove(index));
            chip.append(link, remove);
            this.previewEl.append(chip);
        });
    }

    /**
     * Remove one extra source reference chip.
     *
     * Boundary: out-of-range indexes are ignored so stale handlers after a re-render cannot corrupt the list.
     *
     * @param {number} index Zero-based chip index.
     * @returns {void}
     */
    remove(index) {
        if (index < 0 || index >= this.items.length)
            return;
        this.items = this.items.filter((_, itemIndex) => itemIndex !== index);
        this.renderPreviews();
        this.host.reposition();
    }
}

// client/dialog-screenshots.js
/**
 * Local screenshot controller for the intent dialog.
 *
 * Boundary: screenshot choices, captures, pending state, and preview DOM are local to one dialog open cycle. The
 * screenshot anchor is read lazily through callbacks because the dialog owns both the primary source selection and the
 * real clicked element used for visual capture.
 */
class DialogScreenshotController {
    host;
    button;
    menu;
    previewEl;
    choices = new Set();
    choiceButtons = new Map();
    captures = new Map();
    capturePromises = new Map();
    pending = new Set();
    constructor(host) {
        this.host = host;
    }

    /**
     * Reset screenshot state for a newly opened dialog.
     *
     * Boundary: persisted choices are loaded, but actual captures are cleared so screenshots always match the current
     * selected element.
     *
     * @returns {void}
     */
    reset() {
        this.choices = loadScreenshotChoices();
        this.captures = new Map();
        this.capturePromises = new Map();
        this.pending = new Set();
    }

    /**
     * Clear transient screenshot state during dialog close.
     *
     * Boundary: persisted preferences are not changed; this only drops the current open-cycle data and pending markers.
     *
     * @returns {void}
     */
    clear() {
        this.captures.clear();
        this.capturePromises.clear();
        this.pending.clear();
        this.choices.clear();
    }

    /**
     * Attach the preview container used for screenshot thumbnails.
     *
     * Boundary: callers must provide an element that belongs to the current dialog. Passing a stale element makes later
     * render calls update detached DOM.
     *
     * @param {HTMLElement} previewEl Thumbnail container.
     * @returns {void}
     */
    attachPreview(previewEl) {
        this.previewEl = previewEl;
        this.previewEl.hidden = true;
    }

    /**
     * Render the footer screenshot picker.
     *
     * Boundary: this creates fresh DOM for one dialog render and should be called after `reset()`. The controller owns
     * the returned button and menu until the dialog closes.
     *
     * @returns {HTMLElement} Screenshot picker wrapper.
     */
    renderPicker() {
        const wrapper = el('div', 'cii-screenshot-picker');
        this.button = el('button', 'cii-icon-btn');
        this.button.type = 'button';
        this.button.title = '截图设置';
        this.button.setAttribute('aria-label', '截图设置');
        this.button.append(el('span', 'cii-shot-icon'));
        this.button.addEventListener('click', (event) => {
            event.stopPropagation();
            this.menu.hidden = !this.menu.hidden;
        });
        this.menu = el('div', 'cii-screenshot-menu');
        this.menu.hidden = true;
        this.choiceButtons = new Map();
        this.menu.append(this.renderChoice('none', '不截图'), this.renderChoice('selection', '区域截图'), this.renderChoice('parent', '父节点截图'), this.renderChoice('viewport', '全屏截图'));
        wrapper.append(this.button, this.menu);
        this.updatePicker();
        return wrapper;
    }

    /**
     * Close the menu when a click lands outside the screenshot picker.
     *
     * Boundary: this is safe before the picker is rendered. It only handles outside clicks for the current menu and
     * leaves other footer popovers alone.
     *
     * @param {EventTarget | null} target Event target from the dialog mousedown listener.
     * @returns {void}
     */
    closeMenuFromOutside(target) {
        if (!this.menu || !this.button || this.menu.hidden)
            return;
        if (target instanceof Node && !this.button.contains(target) && !this.menu.contains(target)) {
            this.menu.hidden = true;
        }
    }

    /**
     * Disable or enable the screenshot control during busy states.
     *
     * Boundary: pending capture promises are not canceled; this only blocks new user interaction while resolving or
     * sending the request.
     *
     * @param {boolean} disabled Whether controls should be disabled.
     * @returns {void}
     */
    setDisabled(disabled) {
        if (this.button)
            this.button.disabled = disabled;
    }

    /**
     * Capture all persisted screenshot choices for the current selected element.
     *
     * Boundary: this is best-effort on open; capture errors are reported through the dialog host and do not close the
     * dialog.
     *
     * @returns {Promise<void>} Resolves after selected captures settle.
     */
    async captureSelected() {
        const scopes = SCREENSHOT_SCOPE_ORDER.filter((scope) => this.choices.has(scope));
        if (!scopes.length)
            return;
        try {
            await Promise.all(scopes.map((scope) => this.ensureCapture(scope)));
        }
        catch (err) {
            this.host.showError(err instanceof Error ? err.message : String(err));
        }
    }

    /**
     * Build screenshot payload entries for the send request.
     *
     * Boundary: if no screenshot scopes are selected, this returns undefined. A missing selected element rejects because
     * selection screenshots cannot be recaptured safely.
     *
     * @returns {Promise<Array<Record<string, unknown>> | undefined>} Captured screenshot payloads, if any.
     */
    async buildPayloadScreenshots() {
        if (this.choices.size === 0)
            return undefined;
        if (!this.host.selectedElement())
            throw new Error('Selected element is no longer available');
        const scopes = SCREENSHOT_SCOPE_ORDER.filter((scope) => this.choices.has(scope));
        return Promise.all(scopes.map((scope) => this.ensureCapture(scope)));
    }

    /**
     * Render one screenshot menu choice.
     *
     * Boundary: `choice` must be either `none` or one supported screenshot scope; unsupported values will never be
     * persisted by `saveScreenshotChoices` but would still render a button. Choosing `none` closes this menu after the
     * selection state is cleared; screenshot scopes stay open so users can combine region and viewport captures.
     *
     * @param {string} choice Choice value to toggle.
     * @param {string} label Visible menu label.
     * @returns {HTMLButtonElement} Menu button.
     */
    renderChoice(choice, label) {
        const button = el('button', 'cii-screenshot-choice');
        button.type = 'button';
        button.append(el('span', 'cii-choice-mark'), el('span', 'cii-choice-label', label));
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            void this.toggleChoice(choice);
            if (choice === 'none' && this.menu) {
                this.menu.hidden = true;
            }
        });
        this.choiceButtons.set(choice, button);
        return button;
    }

    /**
     * Refresh screenshot picker labels, active states, and previews.
     *
     * Boundary: this assumes the picker DOM exists; callers should not call it before `renderPicker()`.
     *
     * @returns {void}
     */
    updatePicker() {
        const hasScreenshots = this.choices.size > 0;
        this.button.classList.toggle('cii-icon-btn-active', hasScreenshots);
        this.button.title = hasScreenshots
            ? `截图：${Array.from(this.choices)
                .map((scope) => screenshotScopeTitleLabel(scope))
                .join(' + ')}`
            : '不截图';
        for (const [choice, button] of this.choiceButtons) {
            const active = choice === 'none' ? !hasScreenshots : this.choices.has(choice);
            button.classList.toggle('cii-choice-active', active);
            const mark = button.querySelector('.cii-choice-mark');
            if (mark)
                mark.textContent = active ? '✓' : '';
        }
        this.renderPreviews();
    }

    /**
     * Toggle a screenshot choice and capture it when enabled.
     *
     * Boundary: choosing `none` clears every current capture. Capture failures roll back the newly added choice and are
     * reported through the dialog host.
     *
     * @param {string} choice Choice value from the menu.
     * @returns {Promise<void>} Resolves after any needed capture completes.
     */
    async toggleChoice(choice) {
        if (choice === 'none') {
            this.choices.clear();
            this.captures.clear();
            this.capturePromises.clear();
            this.pending.clear();
            this.persistChoices();
            this.updatePicker();
            return;
        }
        if (this.choices.has(choice)) {
            this.choices.delete(choice);
            this.captures.delete(choice);
            this.capturePromises.delete(choice);
            this.pending.delete(choice);
            this.persistChoices();
            this.updatePicker();
            return;
        }
        this.choices.add(choice);
        this.persistChoices();
        this.updatePicker();
        try {
            await this.ensureCapture(choice);
        }
        catch (err) {
            this.choices.delete(choice);
            this.persistChoices();
            this.updatePicker();
            this.host.showError(err instanceof Error ? err.message : String(err));
        }
    }

    /**
     * Persist screenshot choices as a best-effort preference.
     *
     * Boundary: storage errors are swallowed inside `saveScreenshotChoices`; this method only centralizes the write.
     *
     * @returns {void}
     */
    persistChoices() {
        saveScreenshotChoices(this.choices);
    }

    /**
     * Ensure a screenshot capture exists for one scope.
     *
     * Boundary: concurrent calls for the same scope share one promise. The capture is kept only if the scope remains
     * selected when rendering finishes.
     *
     * @param {string} scope Screenshot scope to capture.
     * @returns {Promise<Record<string, unknown>>} Screenshot payload.
     */
    ensureCapture(scope) {
        const existing = this.captures.get(scope);
        if (existing)
            return Promise.resolve(existing);
        const pending = this.capturePromises.get(scope);
        if (pending)
            return pending;
        const selectedElement = this.host.selectedElement();
        if (!selectedElement)
            return Promise.reject(new Error('Selected element is no longer available'));
        this.pending.add(scope);
        this.renderPreviews();
        const promise = captureScreenshot(selectedElement, scope)
            .then((payload) => {
            if (this.choices.has(scope))
                this.captures.set(scope, payload);
            return payload;
        })
            .finally(() => {
            this.pending.delete(scope);
            this.capturePromises.delete(scope);
            this.renderPreviews();
            this.host.reposition();
        });
        this.capturePromises.set(scope, promise);
        return promise;
    }

    /**
     * Render screenshot thumbnails and remove controls.
     *
     * Boundary: thumbnails mirror selected scopes in fixed order. Removing a thumbnail also removes its scope from the
     * outgoing request payload.
     *
     * @returns {void}
     */
    renderPreviews() {
        if (!this.previewEl)
            return;
        this.previewEl.innerHTML = '';
        const selectedScopes = SCREENSHOT_SCOPE_ORDER.filter((scope) => this.choices.has(scope));
        this.previewEl.hidden = selectedScopes.length === 0;
        if (!selectedScopes.length)
            return;
        for (const scope of selectedScopes) {
            const item = el('div', 'cii-screenshot-thumb');
            item.tabIndex = 0;
            item.setAttribute('role', 'button');
            item.setAttribute('aria-label', `预览${screenshotScopeLabel(scope)}`);
            const media = this.renderPreviewMedia(scope, item);
            const remove = this.renderRemoveButton(scope);
            item.append(media, remove);
            item.classList.toggle('cii-thumb-pending', this.pending.has(scope));
            this.previewEl.append(item);
        }
    }

    /**
     * Render thumbnail media for a selected screenshot scope.
     *
     * Boundary: pending captures show a spinner and do not open the lightbox until a real capture payload exists.
     *
     * @param {string} scope Screenshot scope.
     * @param {HTMLElement} item Thumbnail button wrapper receiving preview listeners.
     * @returns {HTMLElement} Thumbnail media container.
     */
    renderPreviewMedia(scope, item) {
        const capture = this.captures.get(scope);
        const media = el('div', 'cii-thumb-media');
        if (capture) {
            const img = document.createElement('img');
            img.src = capture.dataUrl;
            img.alt = screenshotScopeLabel(scope);
            media.append(img);
            item.addEventListener('click', () => this.openPreview(capture));
            item.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    this.openPreview(capture);
                }
            });
        }
        else {
            media.append(el('span', 'cii-thumb-loading'));
        }
        return media;
    }

    /**
     * Render the remove button for a screenshot thumbnail.
     *
     * Boundary: removing a scope also drops pending and cached capture state for that scope.
     *
     * @param {string} scope Screenshot scope to remove.
     * @returns {HTMLButtonElement} Remove button.
     */
    renderRemoveButton(scope) {
        const remove = el('button', 'cii-thumb-remove', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', `移除${screenshotScopeLabel(scope)}`);
        remove.addEventListener('click', (event) => {
            event.stopPropagation();
            this.choices.delete(scope);
            this.captures.delete(scope);
            this.capturePromises.delete(scope);
            this.pending.delete(scope);
            this.updatePicker();
        });
        return remove;
    }

    /**
     * Open a lightbox preview for a captured screenshot.
     *
     * Boundary: this requires the current dialog backdrop to exist. If the dialog was closed while a capture settled,
     * the preview request is ignored.
     *
     * @param {Record<string, unknown>} capture Screenshot payload from `captureScreenshot`.
     * @returns {void}
     */
    openPreview(capture) {
        const backdrop = this.host.backdrop();
        if (!backdrop)
            return;
        const lightbox = el('div', 'cii-image-lightbox');
        const frame = el('div', 'cii-image-frame');
        const img = document.createElement('img');
        img.src = capture.dataUrl;
        img.alt = screenshotScopeLabel(capture.scope);
        const close = el('button', 'cii-image-close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', '关闭预览');
        const closePreview = () => lightbox.remove();
        close.addEventListener('click', closePreview);
        lightbox.addEventListener('click', (event) => {
            if (event.target === lightbox)
                closePreview();
        });
        frame.append(img, close);
        lightbox.append(frame);
        backdrop.append(lightbox);
    }
}

// client/style.js
/**
 * STYLE_TEXT: Complete stylesheet for the plugin UI inside its shadow root.
 * Purpose: centralizes dialog, picker, and textarea presentation; textarea colors, focus, and scrollbar styling use
 * host-level CSS variables so interaction colors do not keep spreading through local rules.
 * Boundary: only injected into the plugin shadow root and does not affect the host page; missing variables make the
 * textarea focus or scrollbar fall back to browser defaults.
 * @type {string} CSS text written into style.textContent.
 */
var STYLE_TEXT = `
:host {
  all: initial;
  --cii-color-textarea-surface: #ffffff;
  --cii-color-textarea-text: #0f172a;
  --cii-color-textarea-border: #e0e3e5;
  --cii-color-textarea-border-focus: #c8ced6;
  --cii-color-textarea-placeholder: rgba(66, 71, 84, 0.55);
  --cii-color-textarea-scrollbar-track: transparent;
  --cii-color-textarea-scrollbar-thumb: rgba(66, 71, 84, 0.18);
  --cii-color-textarea-scrollbar-thumb-hover: rgba(66, 71, 84, 0.28);
  --cii-shadow-textarea-focus: 0 0 0 3px rgba(66, 71, 84, 0.10);
  --cii-size-textarea-scrollbar: 10px;
}
* { box-sizing: border-box; }

.cii-overlay {
  position: fixed;
  pointer-events: none;
  z-index: ${OVERLAY_Z_INDEX};
  border: 2px solid #4f8cff;
  background: rgba(79, 140, 255, 0.12);
  border-radius: 3px;
  transition: all 60ms ease-out;
}
.cii-overlay.cii-nomap {
  border: 2px dashed #f59e0b;
  background: rgba(245, 158, 11, 0.10);
}

.cii-label {
  position: fixed;
  pointer-events: none;
  z-index: ${OVERLAY_Z_INDEX};
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  background: #111827;
  color: #f9fafb;
  padding: 3px 7px;
  border-radius: 4px;
  white-space: nowrap;
  max-width: 80vw;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}
.cii-label .cii-tag { color: #93c5fd; }
.cii-label .cii-loc { color: #fcd34d; }
.cii-label.cii-nomap { background: #92400e; }

.cii-backdrop {
  position: fixed;
  inset: 0;
  z-index: ${DIALOG_Z_INDEX};
  pointer-events: auto;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(4px);
  padding: 0;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}

.cii-dialog {
  position: absolute;
  background: #ffffff;
  color: #0f172a;
  width: min(560px, 94vw);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.35);
  overflow: hidden;
}

.cii-body { padding: 18px; overflow: auto; }
.cii-field { margin: 0; }
.cii-field label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 5px; color: #334155; }

.cii-textarea {
  width: 100%;
  min-height: 112px;
  resize: none;
  font: 15px/1.5 system-ui, sans-serif;
  padding: 12px 16px;
  overflow-y: auto;
  overflow-x: hidden;
  border: 1px solid var(--cii-color-textarea-border);
  border-radius: 8px;
  color: var(--cii-color-textarea-text);
  background: var(--cii-color-textarea-surface);
  scrollbar-color: var(--cii-color-textarea-scrollbar-thumb) var(--cii-color-textarea-scrollbar-track);
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.cii-textarea::placeholder { color: var(--cii-color-textarea-placeholder); }
.cii-textarea:focus {
  outline: 0;
  border-color: var(--cii-color-textarea-border-focus);
  box-shadow: var(--cii-shadow-textarea-focus);
}
.cii-textarea::-webkit-scrollbar {
  width: var(--cii-size-textarea-scrollbar);
}
.cii-textarea::-webkit-scrollbar-track {
  background: var(--cii-color-textarea-scrollbar-track);
}
.cii-textarea::-webkit-scrollbar-thumb {
  min-height: 32px;
  border: 3px solid var(--cii-color-textarea-surface);
  border-radius: 999px;
  background-color: var(--cii-color-textarea-scrollbar-thumb);
}
.cii-textarea::-webkit-scrollbar-thumb:hover {
  background-color: var(--cii-color-textarea-scrollbar-thumb-hover);
}

.cii-reference-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 10px;
}
.cii-reference-preview[hidden] { display: none; }
.cii-code-ref-chip {
  max-width: 100%;
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 6px 0 10px;
  border: 1px solid currentColor;
  border-radius: 999px;
  color: inherit;
  opacity: 0.78;
}
.cii-code-ref-link,
.cii-code-ref-remove {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.cii-code-ref-link {
  max-width: min(260px, 70vw);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-decoration: underline;
}
.cii-code-ref-remove {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 999px;
  font: 16px/1 system-ui, sans-serif;
}

.cii-screenshot-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: 12px;
}
.cii-screenshot-preview[hidden] { display: none; }
.cii-screenshot-thumb {
  position: relative;
  width: 116px;
  height: 82px;
  padding: 0;
  border: 1px solid #e0e3e5;
  border-radius: 8px;
  background: #f7f9fb;
  overflow: hidden;
  cursor: pointer;
}
.cii-thumb-media {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #eceef0;
}
.cii-thumb-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cii-thumb-loading {
  width: 42px;
  height: 42px;
  border-radius: 999px;
  border: 3px solid rgba(80, 95, 118, 0.2);
  border-top-color: #505f76;
  animation: cii-spin 800ms linear infinite;
}
.cii-thumb-remove {
  width: 24px;
  height: 24px;
  position: absolute;
  top: 5px;
  right: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.86);
  color: #424754;
  font: 18px/1 system-ui, sans-serif;
  cursor: pointer;
}
.cii-thumb-remove:hover { background: #ffffff; color: #191c1e; }
.cii-thumb-pending { opacity: 0.78; }
@keyframes cii-spin { to { transform: rotate(360deg); } }

.cii-image-lightbox {
  position: fixed;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.64);
}
.cii-image-frame {
  position: relative;
  max-width: min(92vw, 1100px);
  max-height: 86vh;
}
.cii-image-frame img {
  display: block;
  max-width: 100%;
  max-height: 86vh;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 20px 60px rgba(0,0,0,0.35);
}
.cii-image-close {
  position: absolute;
  top: -12px;
  right: -12px;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: #ffffff;
  color: #191c1e;
  font: 20px/1 system-ui, sans-serif;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(0,0,0,0.18);
}

.cii-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  padding: 12px 24px;
  border-top: 1px solid #e0e3e5;
  background: #f7f9fb;
}
.cii-btn {
  font: 13px system-ui, sans-serif;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
}
.cii-btn:disabled { opacity: 0.5; cursor: default; }
.cii-btn-secondary { background: transparent; color: #505f76; border-color: transparent; }
.cii-btn-secondary:hover:not(:disabled) { background: #f2f4f6; }
.cii-btn-primary { background: #0058be; color: #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.10); }
.cii-btn-primary:hover:not(:disabled) { background: #2170e4; box-shadow: 0 4px 8px rgba(0,0,0,0.12); }
.cii-btn-primary:active:not(:disabled) { transform: translateY(1px); }
.cii-action-buttons {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  max-width: 100%;
}
.cii-agent-action {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}
.cii-agent-last::after {
  content: "";
  width: 6px;
  height: 6px;
  margin-left: 8px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.85;
}
.cii-agent-unavailable { background: #64748b; }
.cii-agent-unavailable:hover:not(:disabled) { background: #475569; }
.cii-screenshot-picker { position: relative; }
.cii-icon-btn {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #424754;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.cii-icon-btn:hover:not(:disabled),
.cii-icon-btn-active {
  background: #f2f4f6;
  color: #191c1e;
}
.cii-icon-btn:disabled { opacity: 0.5; cursor: default; }
.cii-code-ref-icon {
  font: 700 20px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.cii-code-ref-icon::before { content: "@"; }
.cii-shot-icon {
  position: relative;
  width: 20px;
  height: 16px;
  border: 2px solid currentColor;
  border-radius: 4px;
}
.cii-shot-icon::before,
.cii-shot-icon::after {
  content: "";
  position: absolute;
  width: 5px;
  height: 5px;
  border-color: currentColor;
}
.cii-shot-icon::before {
  top: -4px;
  left: -4px;
  border-top: 2px solid currentColor;
  border-left: 2px solid currentColor;
}
.cii-shot-icon::after {
  right: -4px;
  bottom: -4px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
}
.cii-screenshot-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  width: 192px;
  padding: 8px;
  background: #ffffff;
  border: 1px solid #e0e3e5;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.16);
  z-index: 1;
}
.cii-screenshot-menu[hidden] { display: none; }
.cii-screenshot-choice {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #191c1e;
  font: 13px/1 system-ui, sans-serif;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}
.cii-screenshot-choice:hover { background: #f2f4f6; }
.cii-choice-active { background: #f2f4f6; }
.cii-choice-mark {
  width: 16px;
  color: #0058be;
  font-weight: 700;
  text-align: center;
}
`;
/**
 * Create an isolated shadow-DOM host for all plugin UI so page CSS cannot leak
 * in and our styles cannot leak out. The host carries the marker attribute so
 * the picker never selects our own UI.
 */
function createUi() {
    const host = document.createElement('div');
    host.setAttribute(PLUGIN_NODE_ATTR, '');
    host.setAttribute('popover', 'manual');
    host.style.cssText = [
        'all: initial',
        'position: fixed',
        'inset: 0',
        'width: 100vw',
        'height: 100vh',
        'margin: 0',
        'padding: 0',
        'border: 0',
        'background: transparent',
        'overflow: visible',
        'pointer-events: none',
        `z-index: ${DIALOG_Z_INDEX}`,
    ].join(';');
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE_TEXT;
    root.appendChild(style);
    document.body.appendChild(host);
    if (!showUiHost(host))
        keepUiHostLast(host);
    return { host, root };
}
function showUiHost(host) {
    if (typeof host.showPopover !== 'function')
        return false;
    try {
        if (!host.matches(':popover-open'))
            host.showPopover();
        return host.matches(':popover-open');
    }
    catch {
        // Fall back to the fixed z-index host when the Popover API is unavailable or blocked.
        return false;
    }
}
function keepUiHostLast(host) {
    const ensureLast = () => {
        if (host.parentNode === document.body && document.body.lastElementChild !== host)
            document.body.appendChild(host);
    };
    ensureLast();
    new MutationObserver(ensureLast).observe(document.body, { childList: true });
}

// client/overlay.js
/** Fixed-position highlight box + floating label for the hovered element. */
class Overlay {
    box;
    label;
    constructor(parent) {
        this.box = document.createElement('div');
        this.box.className = 'cii-overlay';
        this.label = document.createElement('div');
        this.label.className = 'cii-label';
        this.hide();
        parent.appendChild(this.box);
        parent.appendChild(this.label);
    }
    /** Highlight an element that maps to source. */
    showFor(el) {
        const rect = el.getBoundingClientRect();
        const inspPath = el.getAttribute(INSP_PATH_ATTR) ?? '';
        const parsed = parseInspPathLite(inspPath);
        const loc = parsed.line != null ? `:${parsed.line}${parsed.column != null ? `:${parsed.column}` : ''}` : '';
        const tag = el.tagName.toLowerCase();
        this.position(rect, false);
        this.label.innerHTML = '';
        this.label.append(span('cii-tag', `<${tag}>`), document.createTextNode(' '), span('cii-loc', `${basename(parsed.file)}${loc}`));
        this.label.classList.remove('cii-nomap');
    }
    /** Highlight an element that has no source mapping. */
    showNoMapping(el) {
        const rect = el.getBoundingClientRect();
        this.position(rect, true);
        this.label.textContent = 'no source mapping';
        this.label.classList.add('cii-nomap');
    }
    position(rect, noMap) {
        this.box.style.display = 'block';
        this.box.style.left = `${rect.left}px`;
        this.box.style.top = `${rect.top}px`;
        this.box.style.width = `${rect.width}px`;
        this.box.style.height = `${rect.height}px`;
        this.box.classList.toggle('cii-nomap', noMap);
        this.label.style.display = 'block';
        const labelTop = rect.top > 22 ? rect.top - 22 : rect.bottom + 4;
        this.label.style.left = `${Math.max(2, rect.left)}px`;
        this.label.style.top = `${labelTop}px`;
    }
    hide() {
        this.box.style.display = 'none';
        this.label.style.display = 'none';
    }
    destroy() {
        this.box.remove();
        this.label.remove();
    }
}
function span(cls, text) {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    return el;
}

// client/api.js
/**
 * Builds an absolute inspector endpoint URL from the injected browser config.
 *
 * Boundary: `config.apiOrigin` is expected to be the local Vite inspector origin; if it is missing, relative endpoints
 * are used as a compatibility fallback and will follow the current page domain. Passing an endpoint without a leading
 * slash can create an invalid URL and route requests away from the inspector server.
 *
 * @param {Record<string, unknown>} config Browser config injected by the Vite plugin.
 * @param {string} endpoint Inspector endpoint path.
 * @returns {string} Absolute or fallback relative URL for the inspector endpoint.
 */
function resolveEndpointUrl(config, endpoint) {
    if (typeof config.apiOrigin === 'string' && config.apiOrigin) {
        return `${config.apiOrigin}${endpoint}`;
    }

    return endpoint;
}

/**
 * Creates the browser API client for inspector routes.
 *
 * Boundary: every request carries the per-process token in both query string and header so same-origin and configured
 * cross-origin calls can pass the server guard. A wrong `apiOrigin` sends route resolution, agent discovery, and agent
 * send requests to the wrong host.
 *
 * @param {Record<string, unknown>} config Browser config injected by the Vite plugin.
 * @returns {{ resolve: Function, send: Function, agents: Function }} Inspector API methods used by the picker dialog.
 */
function createApi(config) {
    const headers = {
        'Content-Type': 'application/json',
        [TOKEN_HEADER]: config.token,
    };

    /**
     * Sends a JSON POST to a token-authenticated inspector endpoint.
     *
     * Boundary: `url` must be one of the known inspector route paths and `body` must be JSON-serializable. Missing or
     * wrong tokens fail server-side; wrong endpoint paths make the request bypass the inspector router.
     *
     * @param {string} url Inspector endpoint path.
     * @param {Record<string, unknown>} body JSON payload sent to the inspector server.
     * @returns {Promise<Record<string, unknown>>} Parsed JSON response from the inspector server.
     */
    async function postJson(url, body) {
        const res = await fetch(`${resolveEndpointUrl(config, url)}?token=${encodeURIComponent(config.token)}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            credentials: 'same-origin',
        });
        return (await res.json());
    }
    return {
        resolve: (payload) => postJson(ENDPOINTS.resolve, payload),
        send: (payload) => postJson(ENDPOINTS.send, payload),
        async agents() {
            const res = await fetch(`${resolveEndpointUrl(config, ENDPOINTS.agents)}?token=${encodeURIComponent(config.token)}`, {
                headers,
                credentials: 'same-origin',
            });
            return (await res.json());
        },
    };
}

// client/dialog.js
class Dialog {
    parent;
    config;
    api;
    references;
    screenshots;
    backdrop = null;
    dialogEl = null;
    textarea;
    actionButtons = new Map();
    lastAgent;
    selection = null;
    selectedElement = null;
    screenshotElement = null;
    anchor = null;
    isFocusGuardActive = false;
    state = 'idle';
    availability = [];
    focusGuardHandler = (event) => {
        if (!this.isInspectorFocusEvent(event))
            return;
        event.stopPropagation();
        event.stopImmediatePropagation();
    };
    keyHandler = (e) => {
        this.closeFromEscape(e);
    };
    resizeHandler = () => {
        if (this.dialogEl)
            this.positionDialog(this.dialogEl, this.anchor);
    };
    /**
     * Build the stateful dialog controller.
     *
     * Boundary: the dialog owns local intent UI state; extra references reuse the picker, insert textarea labels, and
     * leave source resolution to the server.
     *
     * @param {ShadowRoot} parent Shadow root that hosts plugin UI.
     * @param {Record<string, unknown>} config Browser config injected by the plugin.
     * @param {Record<string, Function>} api Inspector API client.
     * @param {import('./overlay.js').Overlay} overlay Shared page overlay controller.
     */
    constructor(parent, config, api, overlay) {
        this.parent = parent;
        this.config = config;
        this.api = api;
        this.lastAgent = loadLastAgent(config);
        this.intentText = createIntentTextController(() => this.textarea);
        this.references = new DialogReferenceController(config, overlay, {
            captureIntentCursor: () => this.intentText.capture(),
            insertReferenceText: (label) => this.intentText.insert(label),
            resolveReferenceText: (selection) => this.resolveReferenceText(selection),
            setBackdropHidden: (hidden) => {
                if (this.backdrop)
                    this.backdrop.hidden = hidden;
                this.setHostInteractive(!hidden);
            },
            focusIntent: () => this.focusIntent(),
            isOpen: () => this.isOpen(),
            showError: (text) => this.showError(text),
            reposition: () => {
                if (this.dialogEl)
                    this.positionDialog(this.dialogEl, this.anchor);
            },
        });
        this.screenshots = new DialogScreenshotController({
            selectedElement: () => this.screenshotElement ?? this.selectedElement,
            backdrop: () => this.backdrop,
            reposition: () => {
                if (this.dialogEl)
                    this.positionDialog(this.dialogEl, this.anchor);
            },
            showError: (text) => this.showError(text),
        });
    }
    isOpen() {
        return this.backdrop != null;
    }
    /**
     * Open the intent dialog for the initial page selection.
     *
     * Boundary: each open call resets transient screenshots and extra references. Existing dialogs are closed first so
     * event listeners and pending captures from the previous selection cannot leak into the new request.
     *
     * @param {Record<string, unknown>} selection Browser selection collected from the picked element.
     * @param {Element | null | undefined} selectedElement Source-mapped element used for route resolution and dialog positioning.
     * @param {{ x: number, y: number } | null | undefined} anchor Optional viewport click point.
     * @param {Element | null | undefined} screenshotElement Real clicked element used as screenshot anchor; omitted values fall back to `selectedElement`.
     * @returns {void}
     */
    open(selection, selectedElement, anchor, screenshotElement) {
        if (this.backdrop)
            this.close();
        this.selection = selection;
        this.selectedElement = selectedElement ?? null;
        this.screenshotElement = screenshotElement ?? this.selectedElement;
        this.anchor = anchor ?? anchorFromElement(this.selectedElement);
        this.screenshots.reset();
        this.references.reset();
        this.intentText.reset();
        this.lastAgent = loadLastAgent(this.config);
        this.enableFocusGuard();
        this.render(selection);
        void this.screenshots.captureSelected();
        void this.resolve(selection);
        void this.loadAgents();
        this.focusIntent({ retry: true });
    }
    /**
     * Close the dialog and tear down current intent state.
     *
     * Boundary: this cancels hidden reference-picking mode without restoring the hidden dialog. Pending async screenshot
     * work may still settle, but its maps are cleared and no closed dialog is re-rendered.
     *
     * @returns {void}
     */
    close() {
        if (!this.backdrop)
            return;
        this.references.clear();
        this.disableFocusGuard();
        this.setHostInteractive(false);
        this.parent.removeChild(this.backdrop);
        this.backdrop = null;
        this.dialogEl = null;
        this.selectedElement = null;
        this.screenshotElement = null;
        this.anchor = null;
        this.screenshots.clear();
        document.removeEventListener('keydown', this.keyHandler, true);
        this.parent.removeEventListener('keydown', this.keyHandler, true);
        window.removeEventListener('resize', this.resizeHandler, true);
    }
    /**
     * Render the dialog shell for the current intent.
     *
     * Boundary: this method creates fresh DOM for one open dialog. State that must survive re-rendering should live on
     * the class fields; passing a stale selection only affects async resolve and send payloads outside this renderer.
     *
     * @param {Record<string, unknown>} _selection Current primary selection, intentionally unused by static layout.
     * @returns {void}
     */
    render(_selection) {
        const backdrop = el('div', 'cii-backdrop');
        backdrop.addEventListener('mousedown', (e) => {
            if (e.target === backdrop)
                this.close();
        });
        const dialog = el('div', 'cii-dialog');
        const body = el('div', 'cii-body');
        const intentField = el('div', 'cii-field');
        this.textarea = el('textarea', 'cii-textarea');
        this.intentText.bind(this.textarea);
        this.textarea.setAttribute('aria-label', 'Change intent');
        this.textarea.autofocus = true;
        this.textarea.placeholder = '例如：把这个按钮改成主按钮，并加 loading 状态';
        this.textarea.addEventListener('keydown', (event) => {
            if (this.closeFromEscape(event))
                return;
            if (this.shouldSubmitFromTextarea(event)) {
                event.preventDefault();
                void this.send(this.lastAgent);
            }
        });
        intentField.append(this.textarea);
        body.append(intentField);
        const screenshotPreviewEl = el('div', 'cii-screenshot-preview');
        this.screenshots.attachPreview(screenshotPreviewEl);
        body.append(screenshotPreviewEl);
        dialog.append(body);
        const footer = el('div', 'cii-footer');
        const cancelBtn = el('button', 'cii-btn cii-btn-secondary', '取消');
        cancelBtn.addEventListener('click', () => this.close());
        const actions = el('div', 'cii-action-buttons');
        actions.append(this.references.renderButton());
        actions.append(this.screenshots.renderPicker());
        this.actionButtons = new Map();
        for (const action of configuredActions()) {
            const button = el('button', 'cii-btn cii-btn-primary cii-agent-action', action.label);
            button.title = action.title;
            button.addEventListener('click', () => void this.send(action.name));
            this.actionButtons.set(action.name, button);
            actions.append(button);
        }
        this.updateAgentMarkers();
        footer.append(cancelBtn, actions);
        dialog.append(footer);
        dialog.addEventListener('mousedown', (event) => {
            const target = event.target;
            this.screenshots.closeMenuFromOutside(target);
        }, true);
        backdrop.append(dialog);
        this.parent.append(backdrop);
        this.backdrop = backdrop;
        this.dialogEl = dialog;
        this.setHostInteractive(true);
        this.positionDialog(dialog, this.anchor);
        document.addEventListener('keydown', this.keyHandler, true);
        this.parent.addEventListener('keydown', this.keyHandler, true);
        window.addEventListener('resize', this.resizeHandler, true);
    }

    /**
     * Let the shadow host receive pointer events only while dialog UI is visible.
     *
     * Boundary: the host normally stays transparent so page picking works. Visible dialogs need this enabled, while the
     * hidden reference picker turns it off again so page clicks reach the app.
     *
     * @param {boolean} interactive Whether the plugin host should receive pointer events.
     * @returns {void}
     */
    setHostInteractive(interactive) {
        const host = this.parent.host;
        if (host instanceof HTMLElement)
            host.style.pointerEvents = interactive ? 'auto' : 'none';
    }

    /**
     * Keep page-level modal focus traps from stealing focus back when the inspector textarea receives focus.
     *
     * Boundary: this only stops composed focusin events that originate inside our shadow UI, and only while the
     * inspector dialog is open. It does not block pointer or keyboard events, so the textarea still receives normal
     * browser input and the host page keeps its own modal behavior.
     *
     * @param {FocusEvent} event Focus event dispatched after focus moved into the inspector.
     * @returns {boolean} True when the event came from the inspector UI.
     */
    isInspectorFocusEvent(event) {
        const host = this.parent.host;
        if (!(host instanceof HTMLElement))
            return false;
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        if (path.includes(host) || path.includes(this.backdrop) || path.includes(this.dialogEl) || path.includes(this.textarea))
            return true;
        const target = event.target;
        return target === host || target === this.backdrop || target === this.dialogEl || target === this.textarea;
    }

    /**
     * Install a capture-phase focus guard ahead of document-level trap listeners such as MUI TrapFocus.
     *
     * @returns {void}
     */
    enableFocusGuard() {
        if (this.isFocusGuardActive)
            return;
        window.addEventListener('focusin', this.focusGuardHandler, true);
        this.isFocusGuardActive = true;
    }

    /**
     * Remove the focus guard when the dialog closes.
     *
     * @returns {void}
     */
    disableFocusGuard() {
        if (!this.isFocusGuardActive)
            return;
        window.removeEventListener('focusin', this.focusGuardHandler, true);
        this.isFocusGuardActive = false;
    }

    /**
     * Focus the intent textarea after the dialog is attached.
     *
     * Boundary: the first focus can be lost while the shadow UI/popover settles, so newly opened dialogs retry briefly.
     * This method only targets the current textarea and bails if the dialog has already closed or re-rendered.
     *
     * @param {{ retry?: boolean }} options Whether to retry on the next frame and short timers.
     * @returns {void}
     */
    focusIntent(options = {}) {
        const textarea = this.textarea;
        if (!(textarea instanceof HTMLTextAreaElement))
            return;
        const focus = () => {
            if (!this.backdrop || this.textarea !== textarea)
                return;
            try {
                textarea.focus({ preventScroll: true });
            }
            catch {
                textarea.focus();
            }
        };
        focus();
        if (!options.retry)
            return;
        if (typeof requestAnimationFrame === 'function')
            requestAnimationFrame(focus);
        window.setTimeout(focus, 0);
        window.setTimeout(focus, 80);
    }

    positionDialog(dialog, anchor) {
        const margin = 12;
        const offset = 14;
        const rect = dialog.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const maxX = Math.max(margin, window.innerWidth - width - margin);
        const maxY = Math.max(margin, window.innerHeight - height - margin);
        let x = Math.round((window.innerWidth - width) / 2);
        let y = Math.round((window.innerHeight - height) / 2);
        if (anchor) {
            const rightX = anchor.x + offset;
            const leftX = anchor.x - width - offset;
            const bottomY = anchor.y + offset;
            const topY = anchor.y - height - offset;
            x = rightX <= maxX || leftX < margin ? rightX : leftX;
            y = bottomY <= maxY || topY < margin ? bottomY : topY;
        }
        dialog.style.left = `${clamp(Math.round(x), margin, maxX)}px`;
        dialog.style.top = `${clamp(Math.round(y), margin, maxY)}px`;
    }
    /**
     * Decide whether textarea Enter should submit to the remembered app.
     *
     * Boundary: IME composition and modified Enter presses are ignored so Chinese candidate selection and
     * Shift+Enter line breaks keep working. Callers must still validate intent text before sending.
     *
     * @param {KeyboardEvent} event Textarea keydown event.
     * @returns {boolean} True when this key should submit the dialog.
     */
    shouldSubmitFromTextarea(event) {
        return (event.key === 'Enter' &&
            this.state !== 'resolving' &&
            this.state !== 'sending' &&
            !event.isComposing &&
            !event.shiftKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey);
    }

    /**
     * Close the visible dialog from Escape before page handlers can consume the key.
     *
     * @param {KeyboardEvent} event Keydown event from the page, shadow root, or textarea.
     * @returns {boolean} True when Escape closed the dialog.
     */
    closeFromEscape(event) {
        if (event.key !== 'Escape')
            return false;
        if (this.references?.isPicking())
            return false;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.close();
        return true;
    }

    /**
     * Toggle busy state for every visible footer control.
     *
     * Boundary: this only disables UI controls; async work and picker listeners are owned by their controllers.
     *
     * @param {'idle' | 'resolving' | 'sending' | 'failed' | 'completed'} state Dialog lifecycle state.
     * @returns {void}
     */
    setState(state) {
        this.state = state;
        const busy = state === 'resolving' || state === 'sending';
        for (const button of this.actionButtons.values())
            button.disabled = busy;
        this.references.setDisabled(busy);
        this.screenshots.setDisabled(busy);
    }
    /**
     * Mark the app button that Enter will use.
     *
     * Boundary: this only changes visual state. It does not check whether the app is currently available, because the
     * availability check is asynchronous and the send path owns user-facing errors.
     *
     * @returns {void}
     */
    updateAgentMarkers() {
        for (const [agent, button] of this.actionButtons) {
            button.classList.toggle('cii-agent-last', agent === this.lastAgent);
        }
    }
    /**
     * Persist and display the app agent most recently requested by the user.
     *
     * Boundary: invalid agent names are harmless; storage rejects are swallowed by `saveLastAgent`, while the in-memory
     * value still updates so Enter repeats the last click within the same dialog.
     *
     * @param {string} agent App agent name.
     * @returns {void}
     */
    rememberAgent(agent) {
        this.lastAgent = agent;
        saveLastAgent(agent);
        this.updateAgentMarkers();
    }
    /**
     * Build the server payload for route resolution and agent dispatch.
     *
     * Boundary: screenshot capture can reject if the originally selected element disappeared; extra code references are
     * sent only while their inline labels remain in the textarea, then validated server-side before prompt generation.
     *
     * @param {string} agent App agent selected by the user.
     * @returns {Promise<Record<string, unknown>>} JSON payload for the send endpoint.
     */
    async buildPayload(agent) {
        const payload = {
            pageUrl: location.href,
            intent: this.textarea.value,
            agent,
            applyMode: 'agent-edit',
            resume: true,
            selection: this.selection,
        };
        const references = this.references.payloadSelections(this.textarea.value);
        if (references.length > 0)
            payload.references = references;
        const screenshots = await this.screenshots.buildPayloadScreenshots();
        if (screenshots)
            payload.screenshots = screenshots;
        return payload;
    }
    /**
     * Validate the primary selected node before the user sends an intent.
     *
     * Boundary: this resolve call does not include extra references because they can be added later and are validated
     * again on send. A failed primary resolve disables app buttons to prevent an unusable prompt.
     *
     * @param {Record<string, unknown>} selection Primary browser selection.
     * @returns {Promise<void>} Resolves after validation finishes.
     */
    async resolve(selection) {
        this.setState('resolving');
        try {
            const res = await this.api.resolve({
                pageUrl: location.href,
                intent: '',
                agent: configuredActions()[0].name,
                applyMode: 'agent-edit',
                resume: true,
                selection,
            });
            if (!res.ok) {
                this.setState('failed');
                this.showError(res.error ?? 'Failed to resolve source location');
                for (const button of this.actionButtons.values())
                    button.disabled = true;
                return;
            }
            this.setState('idle');
            if (res.source?.astError) {
                console.info(`Intent inspector source extraction fell back to line context: ${res.source.astError}`);
            }
        }
        catch (err) {
            this.setState('failed');
            this.showError(err instanceof Error ? err.message : String(err));
        }
    }

    /**
     * Resolve the project-relative `@file #range` text for a newly picked extra code reference.
     *
     * @param {Record<string, unknown>} selection Browser selection collected by the reference picker.
     * @returns {Promise<string | undefined>} Compact source reference returned by the server.
     */
    async resolveReferenceText(selection) {
        const res = await this.api.resolve({
            pageUrl: location.href,
            intent: '',
            agent: configuredActions()[0].name,
            applyMode: 'agent-edit',
            resume: true,
            selection,
        });
        if (!res.ok) {
            throw new Error(res.error ?? 'Failed to resolve source reference');
        }
        return typeof res.reference === 'string' ? res.reference : undefined;
    }

    /**
     * Load app availability and decorate footer buttons.
     *
     * Boundary: availability is best-effort. Failed discovery leaves buttons visible and lets the send path report the
     * adapter-specific error if the user submits.
     *
     * @returns {Promise<void>} Resolves when availability has been applied or ignored.
     */
    async loadAgents() {
        try {
            const res = await this.api.agents();
            this.availability = res.agents;
            for (const action of configuredActions()) {
                const button = this.actionButtons.get(action.name);
                if (!button)
                    continue;
                const configured = this.config.enabledAgents.includes(action.name);
                const info = res.agents.find((a) => a.name === action.name);
                const unavailable = !configured || info?.available === false;
                button.classList.toggle('cii-agent-unavailable', unavailable);
                button.title = !configured
                    ? `${action.label} is not enabled in the plugin config.`
                    : info?.available === false
                        ? info.reason ?? `${action.label} is currently unavailable.`
                        : action.title;
            }
        }
        catch {
            // availability is best-effort; keep the static list.
        }
    }
    /**
     * Send the current intent to the selected app agent.
     *
     * Boundary: disabled and unavailable agents are rejected before screenshots or references are sent. Empty intent is
     * allowed so users can send source references alone. Successful validation stores the app so Enter repeats it next
     * time.
     *
     * @param {string} agent App agent name requested by click or Enter.
     * @returns {Promise<void>} Resolves after the adapter response is rendered.
     */
    async send(agent) {
        if (this.state === 'resolving' || this.state === 'sending')
            return;
        if (!this.selection)
            return;
        const configured = this.config.enabledAgents.includes(agent);
        const unavailable = this.availability.find((a) => a.name === agent && !a.available);
        if (!configured) {
            this.setState('failed');
            this.showError(`${AGENT_LABELS[agent] ?? agent} is not enabled.`);
            return;
        }
        if (unavailable) {
            this.setState('failed');
            this.showError(`${AGENT_LABELS[agent] ?? agent} is unavailable.\n` +
                (unavailable.reason ?? 'Check the adapter setup and try again.'));
            return;
        }
        this.rememberAgent(agent);
        this.setState('sending');
        try {
            const payload = await this.buildPayload(agent);
            const result = await this.api.send(payload);
            this.renderResult(result);
        }
        catch (err) {
            this.setState('failed');
            this.showError(err instanceof Error ? err.message : String(err));
        }
    }
    /**
     * Render the send result.
     *
     * Boundary: successful app deeplink sends close the dialog. Failures stay open and surface the adapter error.
     *
     * @param {Record<string, unknown>} result Agent adapter result from the server.
     * @param {string | undefined} unavailableReason Optional fallback error text.
     * @returns {void}
     */
    renderResult(result, unavailableReason) {
        this.setState(result.ok ? 'completed' : 'failed');
        if (result.ok) {
            this.close();
            return;
        }
        this.showError(result.error ??
            unavailableReason ??
            `${AGENT_LABELS[result.agent] ?? result.agent} failed to handle the request.`);
    }
    /**
     * Show a user-facing dialog error.
     *
     * Boundary: this intentionally uses `window.alert` to stay dependency-free inside the injected shadow UI.
     *
     * @param {string} text Error message.
     * @returns {void}
     */
    showError(text) {
        window.alert(text);
    }
}

// client/picker.js
const SWALLOWED_EVENTS = ['mousedown', 'pointerdown', 'mouseup', 'pointerup', 'dblclick', 'contextmenu'];

/**
 * Resolve the live page element used as the screenshot anchor.
 *
 * Boundary: screenshots intentionally follow the same inspectable element shown by the overlay and sent for source
 * resolution. Using the raw click target can crop to a nested text/icon node even though the selected DOM/source node is
 * a larger component.
 *
 * @param {EventTarget | null} target Original browser event target.
 * @param {Element} inspectable Nearest source-mapped element used for code resolution.
 * @returns {Element} Element that screenshot modes should measure from.
 */
function resolveScreenshotTarget(target, inspectable) {
    if (target instanceof Element && isPluginNode(target))
        return inspectable;
    return inspectable;
}

/**
 * Element-inspector mode: hover to highlight, click to select. While active,
 * page interaction events are swallowed so picking never triggers real
 * clicks, focus changes, or navigation.
 */
class PickerController {
    config;
    overlay;
    dialog;
    active = false;
    hovered = null;
    constructor(config, overlay, dialog) {
        this.config = config;
        this.overlay = overlay;
        this.dialog = dialog;
    }
    isActive() {
        return this.active;
    }
    previewTarget(target) {
        if (this.active || this.dialog.isOpen())
            return;
        if (isPluginNode(target)) {
            this.overlay.hide();
            return;
        }
        const inspectable = findInspectableElement(target);
        if (inspectable) {
            this.hovered = inspectable;
            this.overlay.showFor(inspectable);
            return;
        }
        this.hovered = null;
        if (target instanceof HTMLElement)
            this.overlay.showNoMapping(target);
        else
            this.overlay.hide();
    }
    selectTarget(target, point) {
        if (this.active || this.dialog.isOpen())
            return false;
        if (isPluginNode(target))
            return false;
        const inspectable = findInspectableElement(target);
        if (!inspectable) {
            if (target instanceof HTMLElement) {
                this.overlay.showNoMapping(target);
                return true;
            }
            this.overlay.hide();
            return false;
        }
        const selection = collectSelection(inspectable, this.config.maxDomSnippetLength);
        const screenshotTarget = resolveScreenshotTarget(target, inspectable);
        this.overlay.hide();
        this.hovered = null;
        this.dialog.open(selection, inspectable, point, screenshotTarget);
        return true;
    }
    hidePreview() {
        if (this.active)
            return;
        this.hovered = null;
        this.overlay.hide();
    }
    toggle() {
        if (this.active)
            this.exit();
        else
            this.enter();
    }
    enter() {
        if (this.active || this.dialog.isOpen())
            return;
        this.active = true;
        document.addEventListener('mousemove', this.onMouseMove, true);
        document.addEventListener('click', this.onClick, true);
        document.addEventListener('keydown', this.onKeyDown, true);
        window.addEventListener('scroll', this.onScroll, true);
        for (const type of SWALLOWED_EVENTS) {
            document.addEventListener(type, this.swallow, true);
        }
        document.documentElement.style.cursor = 'crosshair';
    }
    exit() {
        if (!this.active)
            return;
        this.active = false;
        document.removeEventListener('mousemove', this.onMouseMove, true);
        document.removeEventListener('click', this.onClick, true);
        document.removeEventListener('keydown', this.onKeyDown, true);
        window.removeEventListener('scroll', this.onScroll, true);
        for (const type of SWALLOWED_EVENTS) {
            document.removeEventListener(type, this.swallow, true);
        }
        document.documentElement.style.cursor = '';
        this.overlay.hide();
        this.hovered = null;
    }
    swallow = (e) => {
        if (isPluginNode(e.target))
            return;
        e.preventDefault();
        e.stopImmediatePropagation();
    };
    onMouseMove = (e) => {
        const target = e.target;
        if (isPluginNode(target)) {
            this.overlay.hide();
            return;
        }
        const inspectable = findInspectableElement(target);
        if (inspectable) {
            this.hovered = inspectable;
            this.overlay.showFor(inspectable);
        }
        else if (target instanceof HTMLElement) {
            this.hovered = null;
            this.overlay.showNoMapping(target);
        }
        else {
            this.overlay.hide();
        }
    };
    onScroll = () => {
        if (this.hovered)
            this.overlay.showFor(this.hovered);
    };
    onClick = (e) => {
        if (isPluginNode(e.target))
            return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const inspectable = findInspectableElement(e.target);
        if (!inspectable) {
            if (e.target instanceof HTMLElement)
                this.overlay.showNoMapping(e.target);
            return;
        }
        const selection = collectSelection(inspectable, this.config.maxDomSnippetLength);
        const screenshotTarget = resolveScreenshotTarget(e.target, inspectable);
        this.exit();
        this.dialog.open(selection, inspectable, { x: e.clientX, y: e.clientY }, screenshotTarget);
    };
    onKeyDown = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.exit();
        }
    };
}

// client/hotkey.js
function parseHotkey(input) {
    const hk = { alt: false, shift: false, ctrl: false, meta: false, key: '' };
    for (const raw of input.split('+')) {
        const part = raw.trim().toLowerCase();
        if (!part)
            continue;
        if (part === 'alt' || part === 'option' || part === 'opt')
            hk.alt = true;
        else if (part === 'shift')
            hk.shift = true;
        else if (part === 'ctrl' || part === 'control')
            hk.ctrl = true;
        else if (part === 'meta' || part === 'cmd' || part === 'command' || part === 'mod')
            hk.meta = true;
        else
            hk.key = part;
    }
    if (/^[a-z]$/.test(hk.key))
        hk.code = 'Key' + hk.key.toUpperCase();
    else if (/^[0-9]$/.test(hk.key))
        hk.code = 'Digit' + hk.key;
    return hk;
}
function matchHotkey(e, hk) {
    if (e.altKey !== hk.alt)
        return false;
    if (e.shiftKey !== hk.shift)
        return false;
    if (e.ctrlKey !== hk.ctrl)
        return false;
    if (e.metaKey !== hk.meta)
        return false;
    if (hk.code)
        return e.code === hk.code;
    return e.key.toLowerCase() === hk.key;
}

// client/entry.js
function main() {
    const config = window[CLIENT_CONFIG_GLOBAL];
    if (!config) {
        console.warn('[code-intent-inspector] missing injected client config; not starting.');
        return;
    }
    if (window.__CII_INSTALLED__)
        return;
    window.__CII_INSTALLED__ = true;
    const boot = () => {
        const { root } = createUi();
        const api = createApi(config);
        const overlay = new Overlay(root);
        const dialog = new Dialog(root, config, api, overlay);
        const picker = new PickerController(config, overlay, dialog);
        const hotkey = parseHotkey(config.hotkey);
        const clickModifier = config.clickModifier;
        window.addEventListener('keydown', (e) => {
            if (matchHotkey(e, hotkey)) {
                e.preventDefault();
                e.stopPropagation();
                picker.toggle();
            }
        }, true);
        if (clickModifier) {
            document.addEventListener('mousemove', (e) => {
                if (picker.isActive() || !matchesClickModifier(e, clickModifier)) {
                    picker.hidePreview();
                    return;
                }
                picker.previewTarget(e.target);
            }, true);
            document.addEventListener('click', (e) => {
                if (picker.isActive() || !matchesClickModifier(e, clickModifier))
                    return;
                if (!picker.selectTarget(e.target, { x: e.clientX, y: e.clientY }))
                    return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }, true);
            document.addEventListener('keyup', (e) => {
                if (isClickModifierKey(e.key, clickModifier))
                    picker.hidePreview();
            }, true);
        }
        console.info(`[code-intent-inspector] ready — press ${config.hotkey}` +
            `${clickModifier ? ` or ${clickModifier}+click` : ''} to pick an element ` +
            `(default agent: ${config.defaultAgent})`);
    };
    if (document.body)
        boot();
    else
        window.addEventListener('DOMContentLoaded', boot, { once: true });
}
main();
function matchesClickModifier(e, modifier) {
    switch (normalizeClickModifier(modifier)) {
        case 'alt':
            return e.altKey;
        case 'control':
            return e.ctrlKey;
        case 'meta':
            return e.metaKey;
        case 'shift':
            return e.shiftKey;
        default:
            return false;
    }
}
function isClickModifierKey(key, modifier) {
    const normalized = normalizeClickModifier(modifier);
    const eventKey = key.toLowerCase();
    return ((normalized === 'alt' && eventKey === 'alt') ||
        (normalized === 'control' && eventKey === 'control') ||
        (normalized === 'meta' && (eventKey === 'meta' || eventKey === 'os')) ||
        (normalized === 'shift' && eventKey === 'shift'));
}
function normalizeClickModifier(modifier) {
    const value = String(modifier ?? '').toLowerCase();
    if (value === 'command' || value === 'cmd')
        return 'meta';
    if (value === 'ctrl')
        return 'control';
    if (value === 'alt' || value === 'control' || value === 'meta' || value === 'shift') {
        return value;
    }
    return null;
}
