import { normalizePickButton } from '../../shared/pick-trigger.js';
import { TouchPicker, type TouchPickHost } from '../inspect/touch-picker.js';
import type { DialogPin } from '../dialog/dialog-pin.js';

/**
 * Media query for `pickButton: 'touch'`: the primary pointer is a finger. DevTools device mode flips it with the
 * device toolbar, and the `change` listener follows that without a reload.
 * @type {string}
 */
export const TOUCH_POINTER_QUERY = '(pointer: coarse)';

/**
 * Wire the floating pick button: when it shows, and what its tap starts.
 *
 * Purpose: touch devices have no ⌘-click, so the pin orb doubles as a pick button there and opens one-shot touch pick
 * mode ({@link TouchPicker}). `'touch'` follows {@link TOUCH_POINTER_QUERY}; `true` shows the button everywhere.
 * Boundary: `pickButton: false` (or a browser without `matchMedia` in `'touch'` mode) installs nothing and returns
 * null, which leaves the plain orb exactly as before. Hiding the button while pick mode is on leaves pick mode first.
 * Listeners live for the page lifetime, like the other boot listeners.
 *
 * @param {{ root: ParentNode, pin: DialogPin, picker: TouchPickHost, mode: unknown, view?: Window }} options `root`:
 *        plugin shadow root for the glass. `pin`: the dialog's floating control. `picker`: the page picker. `mode`: the
 *        raw `pickButton` config value. `view`: window to query; defaults to `window`.
 * @returns {TouchPicker | null} Pick mode, so the hotkey can leave it; null when the button is off.
 */
export function installPickButton(options: { root: ParentNode; pin: DialogPin; picker: TouchPickHost; mode: unknown; view?: Window }): TouchPicker | null {
    const view = options.view || window;
    const mode = normalizePickButton(options.mode);
    const query = mode === 'touch' && typeof view.matchMedia === 'function' ? view.matchMedia(TOUCH_POINTER_QUERY) : null;
    if (mode === false || (mode === 'touch' && !query))
        return null;
    const pin = options.pin;
    const touchPicker = new TouchPicker(options.root, options.picker, { onChange: () => pin.sync() });
    const apply = (shown: boolean) => {
        if (!shown)
            touchPicker.exit();
        pin.setPickButtonShown(shown);
    };
    pin.enablePickButton({ onPick: () => touchPicker.toggle(), isPicking: () => touchPicker.isActive() });
    apply(query ? query.matches : true);
    query?.addEventListener('change', (event) => apply(event.matches));
    return touchPicker;
}
