/**
 * Single source of truth for the plugin's two-locale (zh/en) classification.
 *
 * Purpose: both the Node server (`server/config.js`, which forwards the resolved `locale` to the browser) and the
 * browser i18n layer (`client/i18n.js`) must agree on what counts as Chinese vs English; keeping one implementation
 * here prevents the two sides from drifting.
 * Boundary: anything starting with `zh` (e.g. `zh-CN`, `zh-Hant`) maps to Chinese; any other non-empty language maps to
 * English. Empty or non-string values return `null` so callers can fall through to the next detection source
 * (the server treats `null` as "auto-detect in the browser"; the browser falls back to `navigator.language`).
 *
 * @param {unknown} value Raw locale string from plugin config or `navigator.language`.
 * @returns {'zh' | 'en' | null} Supported locale id, or null when undetectable.
 */
export function normalizeLocale(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }
    return value.trim().toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
