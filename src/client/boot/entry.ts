import { CLIENT_CONFIG_GLOBAL, LOG_PREFIX } from '../../shared/constants.js';
import { normalizeLongPress } from '../../shared/pick-trigger.js';
import { DEFAULT_THEME, normalizeTheme } from '../../shared/theme.js';
import { setLocale } from '../lib/i18n.js';
import { createUi } from '../lib/style.js';
import { installDialogReferenceStyle } from '../dialog/dialog-reference-style.js';
import { Overlay } from '../inspect/overlay.js';
import { Dialog } from '../dialog/dialog.js';
import { loadLastAgent, setCustomAgentActions } from '../dialog/dialog-utils.js';
import { createApi } from '../lib/api.js';
import { PickerController } from '../inspect/picker.js';
import { matchHotkey, parseHotkey } from './hotkey.js';
import { matchingClickModifier } from './click-modifier.js';
import { installPickButton } from './pick-button.js';
import { installPickGestures } from './pick-gestures-install.js';
import { logThemeHintAfterLoad } from './theme-hint.js';

/**
 * Injected page config this boot path reads. The live object has more keys; only these are indexed here.
 * `enabledAgents` is required by the dialog, `token` by the API client. A missing global skips boot entirely.
 */
interface InjectedClientConfig {
    enabledAgents: string[];
    token: string;
    apiOrigin?: string;
    locale?: unknown;
    theme?: unknown;
    hotkey?: string;
    clickModifier?: string | false | null;
    /** Raw `pickButton` option; normalized by `installPickButton`. */
    pickButton?: unknown;
    /** Raw `longPress` option; only `true` turns long-press picking on. */
    longPress?: unknown;
    customAgents?: unknown;
    maxDomSnippetLength: number;
}

/**
 * Start the browser-side inspector runtime from the injected page config.
 * Purpose: creates the isolated UI root in the configured theme, installs supplemental dialog/dock styles, and wires
 * picker, dialog, dock, hotkey, modifier-click/touch, the floating pick button (touch pick mode) and, when opted in,
 * long-press listeners for the current host page. With no valid `theme` in the config, the UI uses the default theme
 * and a console hint naming the option follows page load.
 * Boundary: requires a browser document with `CLIENT_CONFIG_GLOBAL` already injected; missing config logs and exits,
 * while repeated calls after installation are ignored to avoid duplicate event listeners.
 *
 * @returns {void}
 */
function main() {
    // The injected config is a named global, not a field on `Window`, so the lookup stays a record cast.
    const config = (window as unknown as Record<string, InjectedClientConfig | undefined>)[CLIENT_CONFIG_GLOBAL];
    if (!config) {
        console.warn(`${LOG_PREFIX} missing injected client config; not starting.`);
        return;
    }
    if (window.__CII_INSTALLED__)
        return;
    window.__CII_INSTALLED__ = true;
    // Resolve the UI locale before any dialog copy is built (falls back to navigator language when unset).
    setLocale(config.locale);
    // Custom prompt-delivery clients are config-defined, so they must be registered as destinations before the first
    // dialog is built. Absent config leaves the built-in destinations untouched.
    setCustomAgentActions(config.customAgents);
    // null = the option is unset or invalid: fall back to the default and say so in the console (see the end).
    const theme = normalizeTheme(config.theme);
    const boot = () => {
        const { root } = createUi(theme ?? DEFAULT_THEME);
        installDialogReferenceStyle(root);
        const api = createApi(config);
        const overlay = new Overlay(root);
        const dialog = new Dialog(root, config, api, overlay);
        dialog.restorePinnedIfAny();
        const picker = new PickerController(config, overlay, dialog);
        const touchPicker = installPickButton({ root, pin: dialog.pin, picker, mode: config.pickButton });
        const longPress = normalizeLongPress(config.longPress);
        const hotkey = parseHotkey(String(config.hotkey ?? ''));
        // Platform is read once, but `'auto'` matching stays ⌘-or-Ctrl so DevTools PC ↔ mobile toggles keep working
        // even when the UA platform string flips to iPhone / Android on reload.
        const platform = String((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');
        const clickModifier = matchingClickModifier(config.clickModifier, platform);
        window.addEventListener('keydown', (e) => {
            if (matchHotkey(e, hotkey)) {
                e.preventDefault();
                e.stopPropagation();
                // Touch pick mode is a pick mode too: the hotkey leaves it rather than stacking hotkey mode on top.
                if (touchPicker?.isActive())
                    touchPicker.exit();
                else
                    picker.toggle();
            }
        }, true);
        installPickGestures({
            picker,
            clickModifierRaw: config.clickModifier,
            platform,
            longPress,
        });
        // Log where Enter will actually go, not raw `config.defaultAgent`: the dialog ignores a `'clipboard'` /
        // `'file'` default and prefers the footer agent last clicked in this browser (`loadLastAgent`, re-read per pick).
        // `pickButton: true` shows the button everywhere; the default only on touch screens.
        const buttonHint = touchPicker ? `, or tap the floating pick button${config.pickButton === true ? '' : ' (touch screens)'}` : '';
        console.info(`${LOG_PREFIX} ready — press ${config.hotkey}` +
            `${describeClickModifier(clickModifier)}${longPress ? ' or long-press 1s (touch) / 4s (mouse)' : ''}` +
            ` to pick an element${buttonHint} (Enter → ${loadLastAgent(config)})`);
    };
    if (document.body)
        boot();
    else
        window.addEventListener('DOMContentLoaded', boot, { once: true });
    if (!theme)
        logThemeHintAfterLoad();
}
main();
/**
 * Short console hint for the configured click-to-pick modifier.
 *
 * Purpose: keep the boot log aligned with runtime matching (`'auto'` is ⌘ or Ctrl, not a frozen platform key).
 * Boundary: `null` / unsupported tokens add no hint (modifier-picking is off). Long-press and the pick button are
 * logged separately by the caller so this helper stays modifier-only.
 *
 * @param {string | null | undefined} modifier Matching token from `matchingClickModifier`.
 * @returns {string} Leading-space hint, or `''` when modifier-picking is disabled.
 */
function describeClickModifier(modifier: string | null | undefined): string {
    if (!modifier)
        return '';
    if (modifier === 'auto')
        return ' or ⌘/Ctrl-click';
    return ` or ${modifier}+click`;
}
