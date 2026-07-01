import { basename, parseInspPathLite } from '../inspect/dom.js';
import { t } from '../lib/i18n.js';
import { validStyleKeys } from '../style/style-keys.js';

export const SCREENSHOT_PREF_KEY = 'code-intent-inspector:screenshot-scopes';
export const LAST_AGENT_PREF_KEY = 'code-intent-inspector:last-app-agent';
export const STYLE_KEYS_PREF_KEY = 'code-intent-inspector:style-keys';
export const STYLE_SCOPE_PREF_KEY = 'code-intent-inspector:style-scope';

/**
 * Screenshot scopes in render and persistence order.
 * Boundary: values must match `captureScreenshot` branches; stale or unsupported stored values are filtered out by
 * `loadScreenshotChoices` before they reach the capture pipeline.
 */
export const SCREENSHOT_SCOPE_ORDER = ['selection', 'parent', 'viewport'];

/**
 * Human-readable labels for app agents surfaced in errors and result messages.
 *
 * Boundary: keys must match `AGENT_ACTIONS` names. Missing labels fall back to raw agent ids, which is useful for
 * hidden/custom agents but looks rough for footer buttons.
 *
 * @type {Record<string, string>} Label text by app agent id.
 */
export const AGENT_LABELS = {
    'codex-app': 'Codex App',
    'claude-app': 'Claude App',
    'cursor-app': 'Cursor',
    clipboard: 'Clipboard',
};
/**
 * App-agent actions displayed in the dialog footer.
 *
 * Boundary: this list is UI-only; availability still comes from the server registry. Adding an action without a
 * matching registered adapter shows an unavailable button instead of sending to a missing route. `titleKey` is resolved
 * to a localized title at call time by `configuredActions()`, so the tooltip follows the active locale.
 *
 * @type {Array<{ name: string, label: string, titleKey: string }>} Ordered footer app actions.
 */
export const AGENT_ACTIONS = [
    {
        name: 'codex-app',
        label: 'Codex App',
        titleKey: 'agent.codexApp.title',
    },
    {
        name: 'claude-app',
        label: 'Claude App',
        titleKey: 'agent.claudeApp.title',
    },
    {
        name: 'cursor-app',
        label: 'Cursor',
        titleKey: 'agent.cursorApp.title',
    },
];

/**
 * Create a DOM node for the shadow-root dialog UI.
 *
 * Boundary: `tag` must be a valid HTML tag name; passing untrusted text is safe because it is assigned through
 * `textContent`, while callers that need rich children must append nodes themselves.
 *
 * @param {string} tag HTML tag name to create.
 * @param {string | undefined} className Optional class string assigned directly to the element.
 * @param {string | undefined} text Optional plain text content.
 * @returns {HTMLElement} Created element ready for caller-specific attributes and listeners.
 */
export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className)
        node.className = className;
    if (text != null)
        node.textContent = text;
    return node;
}

/**
 * Return the app actions displayed in the dialog footer.
 *
 * Boundary: this currently exposes only app deeplink agents; adding non-app agents here also makes Enter target them,
 * so callers should keep the list limited to user-visible app buttons.
 *
 * @returns {Array<{ name: string, label: string, title: string }>} Ordered footer app actions.
 */
export function configuredActions() {
    return AGENT_ACTIONS.map((action) => ({
        name: action.name,
        label: action.label,
        title: t(action.titleKey),
    }));
}

/**
 * Read and JSON-parse a stored preference, returning a fallback on any failure.
 *
 * Boundary: the single choke point for best-effort preference reads. Missing, unparsable, or storage-blocked values all
 * collapse to `fallback`, so private browsing / quota errors never throw into the dialog. Callers own value-shape
 * validation (e.g. array/enum checks) on the returned value.
 *
 * @param {string} key Storage key.
 * @param {unknown} fallback Value returned when missing or malformed.
 * @param {Storage} [store] Storage area; defaults to `window.localStorage`.
 * @returns {unknown} Parsed value or fallback.
 */
export function readJsonStore(key, fallback, store = window.localStorage) {
    try {
        const raw = store.getItem(key);
        if (!raw)
            return fallback;
        const value = JSON.parse(raw);
        return value ?? fallback;
    }
    catch {
        return fallback;
    }
}

/**
 * JSON-stringify and write a stored preference, swallowing failures.
 *
 * @param {string} key Storage key.
 * @param {unknown} value Serializable value.
 * @param {Storage} [store] Storage area; defaults to `window.localStorage`.
 * @returns {void}
 */
export function writeJsonStore(key, value, store = window.localStorage) {
    try {
        store.setItem(key, JSON.stringify(value));
    }
    catch {
        // Preference persistence is best effort.
    }
}

/**
 * Load persisted screenshot choices from localStorage.
 *
 * Boundary: malformed storage, unavailable storage, and stale values are ignored. The returned set contains only
 * scopes in `SCREENSHOT_SCOPE_ORDER`; callers must still capture the screenshots before sending.
 *
 * @returns {Set<string>} Valid screenshot scopes selected by the user.
 */
export function loadScreenshotChoices() {
    const value = readJsonStore(SCREENSHOT_PREF_KEY, null);
    if (!Array.isArray(value))
        return new Set();
    return new Set(value.filter((scope) => SCREENSHOT_SCOPE_ORDER.includes(scope)));
}

/**
 * Persist screenshot choices as a best-effort UI preference.
 *
 * Boundary: storage failures are swallowed so private browsing or quota issues do not block the dialog. Passing scopes
 * outside `SCREENSHOT_SCOPE_ORDER` drops them instead of leaking unsupported values into storage.
 *
 * @param {Set<string>} choices Screenshot scope set from the current dialog.
 * @returns {void}
 */
export function saveScreenshotChoices(choices) {
    writeJsonStore(SCREENSHOT_PREF_KEY, SCREENSHOT_SCOPE_ORDER.filter((scope) => choices.has(scope)));
}

/**
 * Pick the app agent that Enter should submit to.
 *
 * Boundary: a stale localStorage value or a disabled configured default falls back to the first visible app action.
 * Returning an unavailable-but-configured agent is intentional because the send path owns availability errors.
 *
 * @param {Record<string, unknown>} config Browser config injected by the plugin.
 * @returns {string} Agent name to use for Enter and the footer marker.
 */
export function loadLastAgent(config) {
    const visibleAgents = configuredActions().map((action) => action.name);
    const enabledAgents = Array.isArray(config.enabledAgents) ? config.enabledAgents : [];
    const fallback = visibleAgents.includes(config.defaultAgent) && enabledAgents.includes(config.defaultAgent)
        ? config.defaultAgent
        : (visibleAgents.find((agent) => enabledAgents.includes(agent)) ?? visibleAgents[0]);
    try {
        const raw = window.localStorage.getItem(LAST_AGENT_PREF_KEY);
        return visibleAgents.includes(raw) && enabledAgents.includes(raw) ? raw : fallback;
    }
    catch {
        return fallback;
    }
}

/**
 * Persist the app agent most recently chosen by button click or Enter.
 *
 * Boundary: only visible app agents are persisted. Invalid values and storage failures are ignored so callers can
 * invoke this optimistically before the agent availability check finishes.
 *
 * @param {string} agent Agent name requested by the user.
 * @returns {void}
 */
export function saveLastAgent(agent) {
    if (!configuredActions().some((action) => action.name === agent))
        return;
    try {
        window.localStorage.setItem(LAST_AGENT_PREF_KEY, agent);
    }
    catch {
        // Preference persistence is best effort; Enter still uses the in-memory value.
    }
}

/**
 * Resolve a screen anchor from the selected page element.
 *
 * Boundary: missing or detached elements return null, which makes the dialog center itself. The returned point is in
 * viewport coordinates and should be consumed before layout changes move the element.
 *
 * @param {Element | null} element Element used to position the dialog near the user's click.
 * @returns {{ x: number, y: number } | null} Center point for dialog placement.
 */
export function anchorFromElement(element) {
    if (!element)
        return null;
    const rect = element.getBoundingClientRect();
    return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
    };
}

/**
 * Clamp a number into an inclusive range.
 *
 * Boundary: when `max` is less than `min`, the minimum is returned so callers can handle cramped viewports without
 * producing NaN or inverted coordinates.
 *
 * @param {number} value Proposed value.
 * @param {number} min Inclusive lower bound.
 * @param {number} max Inclusive upper bound.
 * @returns {number} Clamped value.
 */
export function clamp(value, min, max) {
    if (max < min)
        return min;
    return Math.min(Math.max(value, min), max);
}

/**
 * Convert a screenshot scope into the localized label used in previews.
 *
 * Boundary: unknown scopes are treated as viewport screenshots so stale stored choices still get a stable label.
 *
 * @param {string} scope Screenshot scope value.
 * @returns {string} Human-readable label.
 */
export function screenshotScopeLabel(scope) {
    const key = SCREENSHOT_SCOPE_ORDER.includes(scope) ? scope : 'viewport';
    return t(`screenshot.scope.${key}`);
}

/**
 * Convert a screenshot scope into the compact localized label used in the picker title.
 *
 * Boundary: unknown scopes are treated as viewport screenshots; callers should still validate persisted choices through
 * `SCREENSHOT_SCOPE_ORDER` before using them.
 *
 * @param {string} scope Screenshot scope value.
 * @returns {string} Compact title label without the screenshot suffix.
 */
export function screenshotScopeTitleLabel(scope) {
    const key = SCREENSHOT_SCOPE_ORDER.includes(scope) ? scope : 'viewport';
    return t(`screenshot.scopeTitle.${key}`);
}

/**
 * Load persisted style-capture property choices from localStorage.
 *
 * Boundary: style capture is opt-in, so an absent preference returns an empty set (no styles are attached until the user
 * picks properties or applies the common defaults from the panel). Malformed or stale values are filtered against the
 * curated catalog.
 *
 * @returns {Set<string>} Selected computed-style property names.
 */
export function loadStyleChoices() {
    const value = readJsonStore(STYLE_KEYS_PREF_KEY, null);
    if (!Array.isArray(value))
        return new Set();
    return new Set(validStyleKeys(value));
}

/**
 * Persist style-capture property choices as a best-effort preference.
 *
 * Boundary: storage failures are swallowed so private browsing or quota issues do not block the dialog. Only catalog
 * properties are written so unsupported values cannot leak into storage.
 *
 * @param {Set<string>} choices Selected property set from the current dialog.
 * @returns {void}
 */
export function saveStyleChoices(choices) {
    writeJsonStore(STYLE_KEYS_PREF_KEY, validStyleKeys(choices));
}

/**
 * Load the persisted style-capture scope.
 *
 * Boundary: only `self` and `ancestors` are valid; any other stored value falls back to `self` so a stale preference
 * cannot widen the capture unexpectedly.
 *
 * @returns {'self' | 'ancestors'} Persisted scope, defaulting to `self`.
 */
export function loadStyleScope() {
    try {
        return window.localStorage.getItem(STYLE_SCOPE_PREF_KEY) === 'ancestors' ? 'ancestors' : 'self';
    }
    catch {
        return 'self';
    }
}

/**
 * Persist the style-capture scope as a best-effort preference.
 *
 * @param {'self' | 'ancestors'} scope Scope chosen in the current dialog.
 * @returns {void}
 */
export function saveStyleScope(scope) {
    try {
        window.localStorage.setItem(STYLE_SCOPE_PREF_KEY, scope === 'ancestors' ? 'ancestors' : 'self');
    }
    catch {
        // Preference persistence is best effort.
    }
}

/**
 * Build the compact link label for an additional source reference chip.
 *
 * Boundary: invalid or missing `data-insp-path` values fall back to a numbered generic label; callers should still
 * send the original selection so the server can perform authoritative validation. This is only a local fallback; the
 * dialog asks the server for the project-relative `@path #range` label before inserting normal references.
 *
 * @param {Record<string, unknown>} selection Browser selection collected from a page element.
 * @param {number} index Zero-based reference index.
 * @returns {string} Compact fallback label such as `@Button.jsx #42`.
 */
export function sourceReferenceLabel(selection, index) {
    const parsed = parseInspPathLite(selection?.inspPath ?? '');
    if (!parsed.file)
        return t('reference.codeFallback', { n: index + 1 });
    const line = parsed.line != null ? ` #${parsed.line}` : '';
    return `@${basename(parsed.file)}${line}`;
}
