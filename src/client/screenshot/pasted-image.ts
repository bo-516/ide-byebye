import { t } from '../lib/i18n.js';
import { blobToDataUrl } from './screenshot-assets.js';
import { solidPageBackground } from './screenshot-dom.js';
import { encodeCanvas, loadImage, type ScreenshotPayload } from './screenshot.js';
import { PASTED_IMAGE_MAX_DATA_URL_CHARS, PASTED_IMAGE_SCOPE, planPastedImageEncoding } from './pasted-image-rules.js';

/** Lower WebP qualities tried, in order, when the first encode is over the size cap. @type {readonly number[]} */
const WEBP_QUALITY_STEPS: readonly number[] = [0.72, 0.55];
/** JPEG qualities tried where the browser cannot encode WebP (PNG would be the only other choice). @type {readonly number[]} */
const JPEG_QUALITY_STEPS: readonly number[] = [0.85, 0.7, 0.55];
/** Factor applied to the scale after every quality step at one size failed to fit. @type {number} */
const DOWNSCALE_STEP = 0.75;
/** Sizes tried before giving up on an image that will not fit the cap. @type {number} */
const MAX_DOWNSCALE_ATTEMPTS = 4;

/**
 * A decoded pasted image ready to draw on a canvas.
 * Boundary: `release` must run once the image is no longer drawn; it closes the bitmap or revokes the object URL.
 */
interface DecodedImage {
    source: CanvasImageSource;
    width: number;
    height: number;
    release: () => void;
}

/** Encoded image bytes and the pixel size they were drawn at. */
interface EncodedImage {
    dataUrl: string;
    width: number;
    height: number;
}

/**
 * Decode a pasted file.
 *
 * Boundary: `createImageBitmap` is tried first (no object URL, works off the main thread). SVG and formats it rejects
 * go through an `<img>` and an object URL instead. An animated GIF decodes to its first frame. Rejects when neither
 * decoder can read the file.
 *
 * @param {Blob} file Pasted image file.
 * @returns {Promise<DecodedImage>} Drawable image with its natural size.
 */
async function decodeImage(file: Blob): Promise<DecodedImage> {
    if (typeof createImageBitmap === 'function') {
        try {
            const bitmap = await createImageBitmap(file);
            return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
        }
        catch {
            // Fall through to <img>, which also decodes SVG.
        }
    }
    const url = URL.createObjectURL(file);
    try {
        const img = await loadImage(url);
        return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
    }
    catch (err) {
        URL.revokeObjectURL(url);
        throw err;
    }
}

/**
 * Draw an image on a new canvas at `scale`.
 *
 * Boundary: without `background` the canvas keeps the image's transparency. Throws when no 2D context is available.
 *
 * @param {DecodedImage} image Decoded image.
 * @param {number} scale Factor applied to the natural size; the result is at least 1×1 pixel.
 * @param {string} [background] Solid fill painted first, for formats without alpha.
 * @returns {HTMLCanvasElement} Canvas holding the scaled image.
 */
function drawScaled(image: DecodedImage, scale: number, background?: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx)
        throw new Error(t('screenshot.error.canvasUnavailable'));
    if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(image.source, 0, 0, canvas.width, canvas.height);
    return canvas;
}

/**
 * Encode an image at one scale, lowering quality until it fits {@link PASTED_IMAGE_MAX_DATA_URL_CHARS}.
 *
 * Boundary: WebP keeps transparency. Where the browser cannot encode WebP (it falls back to PNG), JPEG is used and the
 * image is flattened onto the page background, because JPEG has no alpha and would turn transparency black.
 *
 * @param {DecodedImage} image Decoded image.
 * @param {number} scale Factor applied to the natural size.
 * @returns {EncodedImage | null} The first encoding that fits, or null when none does at this size.
 */
function encodeAtScale(image: DecodedImage, scale: number): EncodedImage | null {
    const canvas = drawScaled(image, scale);
    const fits = (dataUrl: string) => dataUrl.length <= PASTED_IMAGE_MAX_DATA_URL_CHARS;
    const first = encodeCanvas(canvas);
    if (fits(first))
        return { dataUrl: first, width: canvas.width, height: canvas.height };
    if (first.startsWith('data:image/webp')) {
        for (const quality of WEBP_QUALITY_STEPS) {
            const dataUrl = canvas.toDataURL('image/webp', quality);
            if (fits(dataUrl))
                return { dataUrl, width: canvas.width, height: canvas.height };
        }
        return null;
    }
    const flat = drawScaled(image, scale, solidPageBackground());
    for (const quality of JPEG_QUALITY_STEPS) {
        const dataUrl = flat.toDataURL('image/jpeg', quality);
        if (fits(dataUrl))
            return { dataUrl, width: flat.width, height: flat.height };
    }
    return null;
}

/**
 * Turn a pasted image file into a screenshot payload the server can store.
 *
 * Boundary: PNG / JPEG / WebP files within the size and edge limits are sent byte-for-byte; anything else is drawn on
 * a canvas, scaled to the edge limit, and encoded within the size cap, shrinking further when needed. Rejects with a
 * localized message when the file cannot be decoded or will not fit.
 *
 * @param {Blob} file Image file from the paste event.
 * @returns {Promise<ScreenshotPayload>} Payload with `scope: 'pasted'` and the sent pixel size.
 */
export async function normalizePastedImage(file: Blob): Promise<ScreenshotPayload> {
    const image = await decodeImage(file).catch(() => {
        throw new Error(t('image.paste.decodeFailed'));
    });
    const payload = (encoded: EncodedImage): ScreenshotPayload => ({
        scope: PASTED_IMAGE_SCOPE,
        dataUrl: encoded.dataUrl,
        width: encoded.width,
        height: encoded.height,
        capturedAt: new Date().toISOString(),
    });
    try {
        if (!image.width || !image.height)
            throw new Error(t('image.paste.decodeFailed'));
        const plan = planPastedImageEncoding({ type: file.type, bytes: file.size, width: image.width, height: image.height });
        if (plan.keepOriginal)
            return payload({ dataUrl: await blobToDataUrl(file), width: image.width, height: image.height });
        let scale = plan.scale;
        for (let attempt = 0; attempt < MAX_DOWNSCALE_ATTEMPTS; attempt += 1) {
            const encoded = encodeAtScale(image, scale);
            if (encoded)
                return payload(encoded);
            scale *= DOWNSCALE_STEP;
        }
        throw new Error(t('image.paste.tooLarge'));
    }
    finally {
        image.release();
    }
}
