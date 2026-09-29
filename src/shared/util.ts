/** Pure helpers usable on both client and server. */
/**
 * Truncate a string to `max` characters, appending a single-line ellipsis
 * marker that records how many characters were dropped. Returns `undefined`
 * for empty input so optional fields stay omitted.
 *
 * @param {unknown} value Input coerced with `String`. Nullish and empty results are omitted.
 * @param {number} max Maximum characters kept before the truncation marker. A non-positive max still slices.
 * @returns {string | undefined} Truncated string, or undefined when there is nothing to keep.
 */
export function truncateSnippet(value: unknown, max: number): string | undefined {
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
/**
 * Collapse runs of whitespace into single spaces and trim.
 *
 * @param {string} value Text that may contain tabs, newlines, or repeated spaces.
 * @returns {string} Single-spaced, trimmed text. Whitespace-only input returns `''`.
 */
export function collapseWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}
