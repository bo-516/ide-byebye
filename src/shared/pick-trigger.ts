/**
 * When the floating pick button shows: always (`true`), never (`false`), or while the primary pointer is coarse
 * (`'touch'`: phones, tablets, DevTools device mode).
 */
export type PickButtonMode = boolean | 'touch';

/**
 * Default for the `longPress` option.
 *
 * Purpose: a hold on the page is also the page's own gesture (long-press menus, text selection, drag handles), so the
 * inspector leaves plain presses alone unless the user opts in; touch devices pick with the floating button instead.
 * @type {boolean}
 */
export const DEFAULT_LONG_PRESS = false;

/**
 * Default for the `pickButton` option: shown only where there is no ⌘/Ctrl-click to fall back on.
 * @type {PickButtonMode}
 */
export const DEFAULT_PICK_BUTTON: PickButtonMode = 'touch';

/**
 * normalizeLongPress(value): classify a raw `longPress` option.
 *
 * Purpose: the Node server (which forwards the option to the browser) and the browser boot path read one rule.
 * Boundary: only a literal `true` turns long-press on; anything else, including truthy strings, is the default (off).
 *
 * @param {unknown} value Raw value from the plugin options or the injected client config.
 * @returns {boolean} True when long-press picking is on.
 */
export function normalizeLongPress(value: unknown): boolean {
    return value === true ? true : DEFAULT_LONG_PRESS;
}

/**
 * normalizePickButton(value): classify a raw `pickButton` option.
 *
 * Boundary: `true` / `false` pass through; `'touch'` is matched ignoring case and surrounding whitespace. Anything else,
 * including an unset option and `null`, falls back to {@link DEFAULT_PICK_BUTTON} rather than hiding the button, so a
 * typo cannot leave a phone with no way to pick.
 *
 * @param {unknown} value Raw value from the plugin options or the injected client config.
 * @returns {PickButtonMode} Accepted mode.
 */
export function normalizePickButton(value: unknown): PickButtonMode {
    if (typeof value === 'boolean')
        return value;
    if (typeof value === 'string' && value.trim().toLowerCase() === 'touch')
        return 'touch';
    return DEFAULT_PICK_BUTTON;
}
