const ASSET_INLINE_TIMEOUT_MS = 2500;

/**
 * In-flight image inlining for one capture, keyed by absolute URL.
 * Boundary: a nullish value means the asset could not be inlined and callers must keep the original URL.
 */
export type AssetCache = Map<string, Promise<string | null | undefined>>;

/**
 * Absolute-ize an asset URL against the document base; data/fragment URLs pass through untouched.
 * Boundary: the overload keeps `string` input typed as `string` while nullish input stays nullable,
 * matching how callers thread optional `src`/`href` values through.
 * @param {string | null | undefined} raw Raw URL value read from the DOM.
 * @returns {string | null | undefined} Absolute URL, or the input unchanged for data/fragment/invalid values.
 */
export function absoluteAssetUrl(raw: string): string;
export function absoluteAssetUrl(raw: string | null | undefined): string | null | undefined;
export function absoluteAssetUrl(raw: string | null | undefined): string | null | undefined {
    if (!raw || raw.startsWith('data:') || raw.startsWith('#'))
        return raw;
    try {
        return new URL(raw, document.baseURI).href;
    }
    catch {
        return raw;
    }
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read image asset'));
        reader.readAsDataURL(blob);
    });
}

/**
 * Fetch an image asset and inline it as a data URL, deduplicated per capture through `assetCache`.
 * Boundary: cross-origin assets are fetched without credentials; non-image, failed, or timed-out
 * fetches resolve null so the caller keeps the original URL.
 * @param {string | null | undefined} url Raw asset URL; nullish/data values resolve unchanged.
 * @param {AssetCache} assetCache Shared cache for one capture.
 * @returns {Promise<string | null | undefined>} Data URL, absolute URL passthrough, or null on failure.
 */
export function inlineAssetDataUrl(url: string | null | undefined, assetCache: AssetCache): Promise<string | null | undefined> {
    const absolute = absoluteAssetUrl(url);
    if (!absolute || absolute.startsWith('data:'))
        return Promise.resolve(absolute);
    // `get` stays `T | undefined` after `has`. The assertion erases; a stored entry is returned even when falsy.
    if (assetCache.has(absolute))
        return assetCache.get(absolute)!;
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

/**
 * Escape a URL for embedding inside a CSS `url("…")` token.
 * @param {string} value Raw URL text.
 * @returns {string} Quoted `url()` token safe for a `style` attribute.
 */
export function cssUrl(value: string): string {
    const escaped = String(value).replace(/["\\\n\r\f]/g, '\\$&');
    return `url("${escaped}")`;
}

/**
 * Rewrite every `url(…)` inside a serialized computed-style block to an inlined data URL.
 * Boundary: data, fragment, and empty URLs are preserved verbatim; unmatched CSS around each token is
 * kept byte-for-byte so the cloned node renders identically.
 * @param {string} css Computed-style serialization (`prop:value;` pairs).
 * @param {AssetCache} assetCache Shared cache for one capture.
 * @returns {Promise<string>} The css block with image URLs inlined where possible.
 */
export async function inlineCssImageUrls(css: string, assetCache: AssetCache): Promise<string> {
    if (!css.includes('url('))
        return css;
    const pattern = /url\((['"]?)(.*?)\1\)/g;
    let result = '';
    let lastIndex = 0;
    for (const match of css.matchAll(pattern)) {
        const raw = match[2]?.trim();
        // Global matchAll always supplies index; the DOM lib marks it optional. Do not substitute `lastIndex`:
        // `slice` treats a missing index as "through the end", and replacing it would drop the unmatched prefix.
        const at = match.index as number;
        result += css.slice(lastIndex, at);
        if (!raw || raw.startsWith('data:') || raw.startsWith('#')) {
            result += match[0];
        }
        else {
            const absolute = absoluteAssetUrl(raw);
            const dataUrl = await inlineAssetDataUrl(absolute, assetCache);
            result += cssUrl(dataUrl || absolute);
        }
        lastIndex = at + match[0].length;
    }
    result += css.slice(lastIndex);
    return result;
}
