import { DIALOG_Z_INDEX, PLUGIN_NODE_ATTR } from '../../shared/constants.js';
import { DEFAULT_THEME } from '../../shared/theme.js';
import { AGENT_ICONS_STYLE } from './agent-icons.js';
import { ICONS_STYLE } from './icons.js';
import { CAPTURE_STYLE } from './style-capture.js';
import { DESTINATION_STYLE } from './style-destination.js';
import { FOOTER_STYLE } from './style-footer.js';
import { PREVIEWS_STYLE } from './style-previews.js';
import { RECORDING_STYLE } from './style-recording.js';
import { RECORDING_EDITOR_STYLE } from './style-recording-editor.js';
import { SESSION_PICKER_STYLE } from './style-session-picker.js';
import { SHELL_STYLE } from './style-shell.js';
import { THEME_ATTR, TOKENS_STYLE } from './style-tokens.js';
import { TOOLS_STYLE } from './style-tools.js';

/**
 * Compose the plugin's shadow-root stylesheet while preserving component cascade order.
 *
 * Boundary: icon masks and design tokens come first because every later fragment reads them (light and dark themes
 * both live in the tokens), then shell defaults precede dependent controls, and the destination brand marks follow the
 * destination picker whose kind glyphs they override; omitting or reordering fragments can alter button, picker, or
 * editor presentation. Session-menu overrides remain appended by `createUi`, and the editor
 * styles by `installDialogReferenceStyle`.
 * @type {string} Complete base CSS text for consumers that render or inject the plugin UI.
 */
export const STYLE_TEXT = ICONS_STYLE + TOKENS_STYLE + SHELL_STYLE + PREVIEWS_STYLE + FOOTER_STYLE + TOOLS_STYLE
    + DESTINATION_STYLE + AGENT_ICONS_STYLE + RECORDING_STYLE + RECORDING_EDITOR_STYLE + CAPTURE_STYLE;

/**
 * Create an isolated shadow-DOM host for all plugin UI so page CSS cannot leak
 * in and our styles cannot leak out. The host carries the marker attribute so
 * the picker never selects our own UI, and the theme attribute that TOKENS_STYLE
 * keys the dark tokens on.
 *
 * @param {string} [theme] `'light'` / `'auto'` / `'dark'`, normally `normalizeTheme(config.theme) ?? DEFAULT_THEME`.
 * Omitted or any other value renders the light theme.
 * @returns {{ host: HTMLElement, root: ShadowRoot }} The page-level host and the shadow root that holds every UI node.
 */
export function createUi(theme = DEFAULT_THEME) {
    const host = document.createElement('div');
    host.setAttribute(PLUGIN_NODE_ATTR, '');
    host.setAttribute(THEME_ATTR, theme);
    host.setAttribute('popover', 'manual');
    host.style.cssText = [
        'all: initial',
        'position: fixed',
        'inset: 0',
        'width: 100vw',
        'height: 100vh',
        'margin: 0',
        'padding: 0',
        'border: 0',
        'background: transparent',
        'overflow: visible',
        'pointer-events: none',
        `z-index: ${DIALOG_Z_INDEX}`,
    ].join(';');
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE_TEXT + SESSION_PICKER_STYLE;
    root.appendChild(style);
    document.body.appendChild(host);
    if (!showUiHost(host))
        keepUiHostLast(host);
    return { host, root };
}

function showUiHost(host) {
    if (typeof host.showPopover !== 'function')
        return false;
    try {
        if (!host.matches(':popover-open'))
            host.showPopover();
        return host.matches(':popover-open');
    }
    catch {
        // Fall back to the fixed z-index host when the Popover API is unavailable or blocked.
        return false;
    }
}

function keepUiHostLast(host) {
    const ensureLast = () => {
        if (host.parentNode === document.body && document.body.lastElementChild !== host)
            document.body.appendChild(host);
    };
    ensureLast();
    new MutationObserver(ensureLast).observe(document.body, { childList: true });
}
