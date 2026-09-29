/**
 * Colour themes accepted by the `theme` plugin option, in the order the docs list them.
 *
 * Purpose: the Node server (`server/config.js`, which forwards the option to the browser) and the browser (which
 * applies it to the UI host) must accept the same values, so both read this one list.
 * Boundary: `'auto'` follows the OS `prefers-color-scheme`; `'light'` and `'dark'` pin a theme whatever the OS says.
 *
 * @type {string[]} Theme ids.
 */
export const THEMES = ['light', 'auto', 'dark'];

/**
 * Theme used when the `theme` option is unset or invalid.
 * @type {string} One of {@link THEMES}.
 */
export const DEFAULT_THEME = 'light';

/**
 * normalizeTheme(value): classify a raw `theme` option.
 *
 * Boundary: case and surrounding whitespace are ignored. Anything that is not one of {@link THEMES}, including an unset
 * option, returns `null`, which callers treat as "not configured": the browser then uses {@link DEFAULT_THEME} and
 * prints a console hint that names the option.
 *
 * @param {unknown} value Raw value from the plugin options or the injected client config.
 * @returns {'light' | 'auto' | 'dark' | null} Accepted theme, or null when unset or invalid.
 */
export function normalizeTheme(value) {
    if (typeof value !== 'string')
        return null;
    const theme = value.trim().toLowerCase();
    return THEMES.includes(theme) ? theme : null;
}
