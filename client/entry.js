import { CLIENT_CONFIG_GLOBAL } from '../shared/constants.js';
import { createUi } from './style.js';
import { Overlay } from './overlay.js';
import { Dialog } from './dialog.js';
import { createApi } from './api.js';
import { PickerController } from './picker.js';
import { matchHotkey, parseHotkey } from './hotkey.js';
function main() {
    const config = window[CLIENT_CONFIG_GLOBAL];
    if (!config) {
        console.warn('[code-intent-inspector] missing injected client config; not starting.');
        return;
    }
    if (window.__CII_INSTALLED__)
        return;
    window.__CII_INSTALLED__ = true;
    const boot = () => {
        const { root } = createUi();
        const api = createApi(config);
        const overlay = new Overlay(root);
        const dialog = new Dialog(root, config, api, overlay);
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
function isClickModifierKey(key, modifier) {
    const normalized = normalizeClickModifier(modifier);
    const eventKey = key.toLowerCase();
    return ((normalized === 'alt' && eventKey === 'alt') ||
        (normalized === 'control' && eventKey === 'control') ||
        (normalized === 'meta' && (eventKey === 'meta' || eventKey === 'os')) ||
        (normalized === 'shift' && eventKey === 'shift'));
}
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
