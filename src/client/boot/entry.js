import { CLIENT_CONFIG_GLOBAL } from '../../shared/constants.js';
import { setLocale } from '../lib/i18n.js';
import { createUi } from '../lib/style.js';
import { installDialogReferenceStyle } from '../dialog/dialog-reference-style.js';
import { Overlay } from '../inspect/overlay.js';
import { Dialog } from '../dialog/dialog.js';
import { createApi } from '../lib/api.js';
import { PickerController } from '../inspect/picker.js';
import { matchHotkey, parseHotkey } from './hotkey.js';
/**
 * Start the browser-side inspector runtime from the injected page config.
 * Purpose: creates the isolated UI root, installs supplemental dialog/dock styles, and wires picker, dialog, dock, and
 * hotkey listeners for the current host page.
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
        const hotkey = parseHotkey(config.hotkey);
        const clickModifier = config.clickModifier;
        window.addEventListener('keydown', (e) => {
            if (matchHotkey(e, hotkey)) {
                e.preventDefault();
                e.stopPropagation();
                picker.toggle();
            }
        }, true);
        if (clickModifier) {
            document.addEventListener('mousemove', (e) => {
                if (picker.isActive() || !matchesClickModifier(e, clickModifier)) {
                    picker.hidePreview();
                    return;
                }
                picker.previewTarget(e.target);
            }, true);
            document.addEventListener('click', (e) => {
                if (picker.isActive() || !matchesClickModifier(e, clickModifier))
                    return;
                if (!picker.selectTarget(e.target, { x: e.clientX, y: e.clientY }))
                    return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            }, true);
            document.addEventListener('keyup', (e) => {
                if (isClickModifierKey(e.key, clickModifier))
                    picker.hidePreview();
            }, true);
        }
        console.info(`[code-intent-inspector] ready — press ${config.hotkey}` +
            `${clickModifier ? ` or ${clickModifier}+click` : ''} to pick an element ` +
            `(default agent: ${config.defaultAgent})`);
    };
    if (document.body)
        boot();
    else
        window.addEventListener('DOMContentLoaded', boot, { once: true });
}
main();
/**
 * Check whether a mouse event includes the configured click modifier.
 * Purpose: lets the picker distinguish ordinary page clicks from inspector selection clicks.
 * Boundary: `modifier` is normalized through `normalizeClickModifier`; missing or unsupported values always return
 * `false`, and passing a non-mouse-like event without modifier booleans also behaves as not matched.
 *
 * @param {{ altKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean }} e Mouse-like event object.
 * @param {string | null | undefined} modifier Configured modifier name.
 * @returns {boolean} Whether the event currently has the normalized modifier pressed.
 */
function matchesClickModifier(e, modifier) {
    switch (normalizeClickModifier(modifier)) {
        case 'alt':
            return e.altKey;
        case 'control':
            return e.ctrlKey;
        case 'meta':
            return e.metaKey;
        case 'shift':
            return e.shiftKey;
        default:
            return false;
    }
}
/**
 * Check whether a keyup event released the configured click modifier key.
 * Purpose: hides the hover preview as soon as the user releases the modifier that enabled selection mode.
 * Boundary: unsupported modifier names return `false`; passing a non-string `key` would fail because keyboard events
 * always provide a string and this helper expects that browser contract.
 *
 * @param {string} key Keyboard event key value.
 * @param {string | null | undefined} modifier Configured modifier name.
 * @returns {boolean} Whether `key` is the release key for the normalized modifier.
 */
function isClickModifierKey(key, modifier) {
    const normalized = normalizeClickModifier(modifier);
    const eventKey = key.toLowerCase();
    return ((normalized === 'alt' && eventKey === 'alt') ||
        (normalized === 'control' && eventKey === 'control') ||
        (normalized === 'meta' && (eventKey === 'meta' || eventKey === 'os')) ||
        (normalized === 'shift' && eventKey === 'shift'));
}
/**
 * Normalize configured click modifier aliases to browser event modifier names.
 * Purpose: keeps config-friendly names like `cmd` and `ctrl` working with DOM event properties.
 * Boundary: only `alt`, `control`, `meta`, and `shift` are supported; missing or misspelled values return `null`, which
 * disables modifier-click picking rather than guessing.
 *
 * @param {string | null | undefined} modifier Raw configured modifier value.
 * @returns {'alt' | 'control' | 'meta' | 'shift' | null} Normalized modifier name, or `null` when unsupported.
 */
function normalizeClickModifier(modifier) {
    const value = String(modifier ?? '').toLowerCase();
    if (value === 'command' || value === 'cmd')
        return 'meta';
    if (value === 'ctrl')
        return 'control';
    if (value === 'alt' || value === 'control' || value === 'meta' || value === 'shift') {
        return value;
    }
    return null;
}
