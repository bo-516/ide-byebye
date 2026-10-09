import { t } from '../lib/i18n.js';
import { nextAnimationFrame, solidPageBackground, waitForRenderableAssets } from './screenshot-dom.js';
import { resolveAssetWaitRoot, resolveScreenshotRender } from './screenshot-render.js';
import type { AssetCache } from './screenshot-assets.js';

const MAX_RENDER_DIMENSION = 1400;

/** Modes `captureScreenshot` renders. Any other runtime string still falls through to the viewport crop. */
export type ScreenshotScope = 'selection' | 'parent' | 'viewport';

/**
 * Encoded screenshot returned to the dialog and the send payload.
 * Boundary: `scope` echoes the requested mode even when rendering fell back to a viewport crop.
 */
export interface ScreenshotPayload {
    scope: string;
    dataUrl: string;
    width: number;
    height: number;
    capturedAt: string;
}

function svgDataUrl(node: Node, width: number, height: number): string {
    const xhtml = new XMLSerializer().serializeToString(node);
    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        `<foreignObject width="100%" height="100%">${xhtml}</foreignObject>`,
        '</svg>',
    ].join('');
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
/**
 * Decode an image source into an `<img>`, rejecting on error or timeout.
 * Boundary: a malformed or oversized SVG `foreignObject` can leave an `Image` that never fires `load` or `error`
 * (notably when rasterizing a rebuilt rrweb replay DOM); the timeout turns that silent hang into a reportable failure so
 * the caller can clear its pending state instead of spinning forever.
 * @param {string} src Image source URL (typically an SVG data URL).
 * @returns {Promise<HTMLImageElement>} The decoded image.
 */
function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const timer = window.setTimeout(() => reject(new Error(t('screenshot.error.renderTimeout'))), 10000);
        img.onload = () => {
            window.clearTimeout(timer);
            resolve(img);
        };
        img.onerror = () => {
            window.clearTimeout(timer);
            reject(new Error(t('screenshot.error.renderFailed')));
        };
        img.src = src;
    });
}
function renderScale(width: number, height: number): number {
    const maxScale = Math.min(window.devicePixelRatio || 1, 2, MAX_RENDER_DIMENSION / Math.max(1, width), MAX_RENDER_DIMENSION / Math.max(1, height));
    return Math.max(0.25, maxScale);
}
function encodeCanvas(canvas: HTMLCanvasElement): string {
    const webp = canvas.toDataURL('image/webp', 0.86);
    if (webp.startsWith('data:image/webp'))
        return webp;
    return canvas.toDataURL('image/png');
}

/**
 * Rasterize a serializable DOM wrapper into an encoded image payload.
 * Boundary: `node` must be an XHTML-namespaced wrapper (see `makeXhtmlWrapper`) whose styles and images are already
 * inlined, because it is drawn through an SVG `<foreignObject>`; live external stylesheets and cross-origin images that
 * were not inlined will not render and can taint the canvas. Throws when a 2D canvas context is unavailable.
 * @param {Element} node Serializable wrapper node to render.
 * @param {number} width CSS-pixel width of the render box; non-positive values are clamped to 1.
 * @param {number} height CSS-pixel height of the render box; non-positive values are clamped to 1.
 * @param {string} background Solid color painted behind the node so transparent regions become opaque.
 * @returns {Promise<{ dataUrl: string, width: number, height: number }>} Encoded image (WebP, PNG fallback) and pixel size.
 */
export async function rasterizeNode(node: Element, width: number, height: number, background: string): Promise<{ dataUrl: string; width: number; height: number }> {
    const image = await loadImage(svgDataUrl(node, width, height));
    const scale = renderScale(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx)
        throw new Error(t('screenshot.error.canvasUnavailable'));
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(image, 0, 0, width, height);
    await nextAnimationFrame();
    return { dataUrl: encodeCanvas(canvas), width: canvas.width, height: canvas.height };
}

/**
 * Render a screenshot payload for the selected element, its parent subtree, or the viewport.
 * Boundary: DOM is serialized through SVG foreignObject; cross-origin images without CORS still cannot be inlined and
 * may be unavailable to the browser's SVG image renderer.
 * @param {Element} target Selected page element; missing/incorrect targets make element-based scopes capture the wrong region.
 * @param {'selection' | 'parent' | 'viewport'} scope Screenshot mode to render.
 * @returns {Promise<{ scope: string, dataUrl: string, width: number, height: number, capturedAt: string }>} Encoded image payload; throws if canvas rendering is unavailable.
 */
export async function captureScreenshot(target: Element, scope: ScreenshotScope): Promise<ScreenshotPayload> {
    await nextAnimationFrame();
    await waitForRenderableAssets(resolveAssetWaitRoot(target, scope));
    const background = solidPageBackground();
    const assetCache: AssetCache = new Map();
    const { width, height, wrapper } = await resolveScreenshotRender(target, scope, assetCache);
    await nextAnimationFrame();
    const raster = await rasterizeNode(wrapper, width, height, background);
    return {
        scope,
        dataUrl: raster.dataUrl,
        width: raster.width,
        height: raster.height,
        capturedAt: new Date().toISOString(),
    };
}
