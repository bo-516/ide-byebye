/**
 * Pure rules for images pasted into the intent dialog: which clipboard entries count as images, and whether a pasted
 * file can be sent as-is or must be re-encoded.
 *
 * Purpose: kept free of DOM and i18n imports so the decisions are unit-testable in Node; `pasted-image.ts` does the
 * decoding and canvas work.
 * Boundary: these helpers never read the system clipboard themselves. They only inspect the `ClipboardEvent` data the
 * editor's paste listener already received.
 */

/**
 * Screenshot `scope` for a pasted image. The server stores it like any capture, under `<outputDir>/screenshots/`.
 *
 * @type {string}
 */
export const PASTED_IMAGE_SCOPE = 'pasted';
/**
 * Longest edge, in pixels, a pasted image keeps. Larger images are scaled down before sending: agents downscale big
 * images anyway, and the send request has a 15 MB body limit shared by every attachment.
 *
 * @type {number}
 */
export const PASTED_IMAGE_MAX_EDGE = 2000;
/**
 * Largest data URL, in characters, one pasted image may send (about 1.5 MB of image bytes). With
 * `MAX_PASTED_IMAGES` images this leaves room under the server's 15 MB body limit for captures and recordings.
 *
 * @type {number}
 */
export const PASTED_IMAGE_MAX_DATA_URL_CHARS = 2_000_000;
/**
 * MIME types the server's `parseDataUrl` accepts, so a pasted file of one of these types can be sent byte-for-byte.
 * Everything else (GIF, BMP, TIFF, SVG, …) is re-encoded on a canvas first.
 *
 * @type {ReadonlySet<string>}
 */
const SENDABLE_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp']);
/** Characters reserved for the `data:<mime>;base64,` prefix when estimating a data URL's length. @type {number} */
const DATA_URL_PREFIX_CHARS = 32;
/**
 * Markup removed before deciding whether clipboard HTML carries text: comments, non-content elements, then every tag.
 * Whatever survives (cell text, paragraph text) means the copy came from a text source such as Excel or Word.
 *
 * @type {readonly RegExp[]}
 */
const HTML_NON_TEXT_PATTERNS: readonly RegExp[] = [
    /<!--[\s\S]*?-->/g,
    /<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/gi,
    /<[^>]*>/g,
    /&nbsp;|&#160;|&#xa0;/gi,
];

/** One `DataTransferItem`-like entry. `getAsFile` returns null for string entries. */
export interface ClipboardFileItem<T> {
    kind: string;
    type: string;
    getAsFile(): T | null;
}

/**
 * The parts of a `DataTransfer` the paste rules read, so tests can pass plain objects.
 * Boundary: `items` is preferred because Chrome lists pasted screenshots there; `files` is the fallback for browsers
 * that only fill `files`.
 */
export interface ClipboardImageSource<T extends { type: string }> {
    items?: ArrayLike<ClipboardFileItem<T>> | null;
    files?: ArrayLike<T> | null;
    getData(format: string): string;
}

/**
 * Whether a MIME type names an image.
 *
 * @param {string} type MIME type from a clipboard entry; an empty type is not an image.
 * @returns {boolean} True for `image/*`.
 */
function isImageType(type: string) {
    return /^image\//i.test(type);
}

/**
 * Whether clipboard HTML holds real text, as copies from spreadsheets, documents and web pages do.
 *
 * Purpose: Excel, Numbers and Word put a rendered picture of the selection on the clipboard next to the text. Such a
 * paste should stay text. A browser "Copy image" only carries `<meta>` + `<img>`, which strips to nothing.
 * Boundary: a heuristic over markup, not an HTML parser. `alt` text is inside a tag and does not count.
 *
 * @param {string | null | undefined} html `text/html` clipboard payload; missing or empty means no rich text.
 * @returns {boolean} True when text remains once tags and non-content elements are removed.
 */
export function isRichTextClipboard(html: string | null | undefined) {
    if (!html)
        return false;
    const text = HTML_NON_TEXT_PATTERNS.reduce((value, pattern) => value.replace(pattern, ' '), html);
    return text.trim().length > 0;
}

/**
 * Pick the image files a paste should attach.
 *
 * Boundary: returns `[]` (so the editor pastes text as before) when the clipboard has no image, or when it carries
 * rich text together with non-empty plain text — the spreadsheet/document case. A Finder file copy, a screenshot and a
 * browser "Copy image" all return their images. Non-image files are ignored.
 *
 * @param {ClipboardImageSource<T> | null | undefined} data The paste event's `clipboardData`. Null returns `[]`.
 * @returns {T[]} Image files in clipboard order.
 */
export function pickClipboardImages<T extends { type: string }>(data: ClipboardImageSource<T> | null | undefined): T[] {
    if (!data)
        return [];
    if (isRichTextClipboard(data.getData('text/html')) && data.getData('text/plain').trim())
        return [];
    const fromItems: T[] = [];
    for (const item of Array.from(data.items ?? [])) {
        if (item.kind !== 'file' || !isImageType(item.type))
            continue;
        const file = item.getAsFile();
        if (file)
            fromItems.push(file);
    }
    if (fromItems.length)
        return fromItems;
    return Array.from(data.files ?? []).filter((file) => isImageType(file.type));
}

/**
 * Estimate the data URL length of `bytes` of base64-encoded content.
 *
 * @param {number} bytes File size in bytes.
 * @returns {number} Upper bound on the data URL's character count.
 */
export function estimateDataUrlChars(bytes: number) {
    return Math.ceil(Math.max(0, bytes) / 3) * 4 + DATA_URL_PREFIX_CHARS;
}

/**
 * Decide how to send one decoded pasted image.
 *
 * Boundary: the original bytes are kept only when the server accepts the type, the image fits
 * {@link PASTED_IMAGE_MAX_EDGE}, and its data URL fits {@link PASTED_IMAGE_MAX_DATA_URL_CHARS}. Otherwise the caller
 * re-encodes at `scale` (1 when only the format or byte size is the problem). Non-positive dimensions give scale 1.
 * The type match is exact because `FileReader` copies it into the data URL and the server's check is case-sensitive.
 *
 * @param {{ type: string, bytes: number, width: number, height: number }} image File MIME type, size, decoded pixels.
 * @returns {{ keepOriginal: boolean, scale: number }} Whether to send as-is, and the first re-encode scale otherwise.
 */
export function planPastedImageEncoding(image: { type: string; bytes: number; width: number; height: number }) {
    const longEdge = Math.max(image.width, image.height);
    const scale = longEdge > PASTED_IMAGE_MAX_EDGE ? PASTED_IMAGE_MAX_EDGE / longEdge : 1;
    const keepOriginal = SENDABLE_IMAGE_TYPES.has(image.type)
        && scale === 1
        && estimateDataUrlChars(image.bytes) <= PASTED_IMAGE_MAX_DATA_URL_CHARS;
    return { keepOriginal, scale };
}
