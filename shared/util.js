/** Pure helpers usable on both client and server. */
/**
 * Truncate a string to `max` characters, appending a single-line ellipsis
 * marker that records how many characters were dropped. Returns `undefined`
 * for empty input so optional fields stay omitted.
 */
export function truncateSnippet(value, max) {
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
export function collapseWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
}
