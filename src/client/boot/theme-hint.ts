import { t } from '../lib/i18n.js';

/**
 * Console style for the brand badge: white on a violet-to-magenta gradient pill, so the hint stands out from the
 * page's own logs. A solid colour comes first for consoles that ignore gradients.
 * @type {string} CSS for a `%c` directive.
 */
const BADGE_STYLE = [
    'background: #6655ff',
    'background: linear-gradient(90deg, #6655ff, #c026d3)',
    'color: #ffffff',
    'font-weight: 700',
    'padding: 2px 8px',
    'border-radius: 999px',
].join(';');

/**
 * Console style for the hint text: a mid violet that stays readable on both the light and the dark DevTools themes.
 * @type {string} CSS for a `%c` directive.
 */
const MESSAGE_STYLE = 'color: #7c6dff; font-weight: 600';

/**
 * themeHintArgs(message): `console.info` arguments that print `message` behind the plugin's badge.
 *
 * Boundary: pure. `message` goes into the format string, so it must not contain `%` directives (localized copy from
 * `console.themeHint` does not).
 *
 * @param {string} message Hint text to print.
 * @returns {string[]} Format string with two `%c` directives, then the badge and message styles.
 */
export function themeHintArgs(message) {
    return [`%cide-byebye%c ${message}`, BADGE_STYLE, MESSAGE_STYLE];
}

/**
 * logThemeHintAfterLoad(win): print the "theme not set" hint once the page has loaded.
 *
 * Purpose: tell a developer who left the `theme` option unset (or invalid) that the dialog defaults to light and how to
 * change it, after the page's own startup logs rather than among them.
 * Boundary: side effects only — one `load` listener and one `console.info`. Logs right away when the document has
 * already finished loading. The caller decides whether the option is unset; this never reads the config.
 *
 * @param {Window} [win] Window whose load to wait for; defaults to the current one.
 * @returns {void}
 */
export function logThemeHintAfterLoad(win = window) {
    const log = () => console.info(...themeHintArgs(t('console.themeHint')));
    if (win.document.readyState === 'complete')
        log();
    else
        win.addEventListener('load', log, { once: true });
}
