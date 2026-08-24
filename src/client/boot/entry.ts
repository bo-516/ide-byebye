import { CLIENT_CONFIG_GLOBAL } from '../../shared/constants.js';
import { setLocale } from '../lib/i18n.js';
import { createUi } from '../lib/style.js';
import { installDialogReferenceStyle } from '../dialog/dialog-reference-style.js';
import { Overlay } from '../inspect/overlay.js';
import { Dialog } from '../dialog/dialog.js';
import { createApi } from '../lib/api.js';
import { PickerController } from '../inspect/picker.js';
import { matchHotkey, parseHotkey } from './hotkey.js';
import { matchingClickModifier } from './click-modifier.js';
import { installPickGestures } from './pick-gestures.js';
/**
 * Start the browser-side inspector runtime from the injected page config.
 * Purpose: creates the isolated UI root, installs supplemental dialog/dock styles, and wires picker, dialog, dock,
 * hotkey, modifier-click/touch, and 4s long-press listeners for the current host page.
 * Boundary: requires a browser document with `CLIENT_CONFIG_GLOBAL` already injected; missing config logs and exits,
 * while repeated calls after installation are ignored to avoid duplicate event listeners.
 *
 * @returns {void}
 */
function main() {
    const config = window[CLIENT_CONFIG_GLOBAL];
    if (!config) {
        console.warn('[code-intent-inspector] missing injected client config; not starting.');
        return;
    }
    if (window.__CII_INSTALLED__)
        return;
    window.__CII_INSTALLED__ = true;
    // Resolve the UI locale before any dialog copy is built (falls back to navigator language when unset).
    setLocale(config.locale);
    const boot = () => {
        const { root } = createUi();
        installDialogReferenceStyle(root);
        const api = createApi(config);
        const overlay = new Overlay(root);
        const dialog = new Dialog(root, config, api, overlay);
        dialog.restorePinnedIfAny();
        const picker = new PickerController(config, overlay, dialog);
        const hotkey = parseHotkey(String(config.hotkey ?? ''));
        // Platform is read once, but `'auto'` matching stays ⌘-or-Ctrl so DevTools PC ↔ mobile toggles keep working
        // even when the UA platform string flips to iPhone / Android on reload.
        const platform = String((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');
        const clickModifier = matchingClickModifier(config.clickModifier, platform);
        window.addEventListener('keydown', (e) => {
            if (matchHotkey(e, hotkey)) {
                e.preventDefault();
                e.stopPropagation();
                picker.toggle();
            }
        }, true);
        installPickGestures({
            picker,
            clickModifierRaw: config.clickModifier,
            platform,
        });
        console.info(`[code-intent-inspector] ready — press ${config.hotkey}` +
            `${describeClickModifier(clickModifier)} or long-press 1s (touch) / 4s (mouse) to pick an element ` +
            `(default agent: ${config.defaultAgent})`);
    };
    if (document.body)
        boot();
    else
        window.addEventListener('DOMContentLoaded', boot, { once: true });
}
main();
/**
 * Short console hint for the configured click-to-pick modifier.
 *
 * Purpose: keep the boot log aligned with runtime matching (`'auto'` is ⌘ or Ctrl, not a frozen platform key).
 * Boundary: `null` / unsupported tokens add no hint (modifier-picking is off). Long-press is logged separately by
 * the caller so this helper stays modifier-only.
 *
 * @param {string | null | undefined} modifier Matching token from `matchingClickModifier`.
 * @returns {string} Leading-space hint, or `''` when modifier-picking is disabled.
 */
function describeClickModifier(modifier) {
    if (!modifier)
        return '';
    if (modifier === 'auto')
        return ' or ⌘/Ctrl-click';
    return ` or ${modifier}+click`;
}
