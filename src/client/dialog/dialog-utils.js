import { basename, parseInspPathLite } from '../inspect/dom.js';
import { t } from '../lib/i18n.js';
import { validStyleKeys } from '../style/style-keys.js';
import { clampNodeLimit, DEFAULT_NODE_LIMIT } from '../style/style-capture.js';

export const SCREENSHOT_PREF_KEY = 'code-intent-inspector:screenshot-scopes';
export const LAST_AGENT_PREF_KEY = 'code-intent-inspector:last-app-agent';
export const STYLE_KEYS_PREF_KEY = 'code-intent-inspector:style-keys';
export const STYLE_SCOPE_PREF_KEY = 'code-intent-inspector:style-scope';
export const STYLE_NODES_PREF_KEY = 'code-intent-inspector:style-nodes';

/**
 * Style-capture scopes in render and persistence order.
 * Boundary: values must match the `captureStyles` scope branches; a stale or unsupported stored value falls back to
 * `self` in {@link loadStyleScope} so a bad preference cannot widen the capture unexpectedly.
 */
export const STYLE_SCOPE_ORDER = ['self', 'children', 'ancestors', 'both'];

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
    'grok-build': 'Grok Build',
    clipboard: 'Clipboard',
};
/**
 * App-agent actions displayed in the dialog footer.
 *
 * Boundary: this list is UI-only; availability still comes from the server registry. Adding an action without a
 * matching registered adapter shows an unavailable button instead of sending to a missing route. `titleKey` is resolved
 * to a localized title at call time by `configuredActions()`, so the tooltip follows the active locale. Grok Build is a
 * CLI handoff (Terminal launcher) rather than an app deeplink, but it still gets a footer button like the app agents.
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
    {
        name: 'grok-build',
        label: 'Grok Build',
        titleKey: 'agent.grokBuild.title',
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
 * Boundary: this currently exposes footer handoff agents (app deeplinks + Grok Build). Adding agents here also makes
 * Enter target them, so callers should keep the list limited to user-visible footer buttons.
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
 * Decide where an absolutely-placed dropdown panel should sit so it stays fully inside the viewport.
 *
 * Boundary: this is the pure geometry behind {@link placeDropdownPanel}, split out so it can be unit-tested without a
 * DOM. All inputs are in viewport coordinates (as {@link Element.getBoundingClientRect} returns); the returned edge
 * offsets are wrapper-relative (subtracting the wrapper origin) so the caller can write them straight to inline
 * `top`/`bottom`/`left`. Exactly one of `top`/`bottom` is a number and the other is `null`, mirroring the pinned edge.
 * Placement rules: keep the panel above the trigger when the room above can hold it; otherwise flip below when the room
 * below is larger; clamp the height (`maxHeight`, non-null only when the panel must shrink) to the chosen side so it
 * scrolls internally instead of spilling; and clamp the horizontal position so a trigger near either rail cannot push a
 * wide panel off-screen. The `margin`/`gap` arithmetic guarantees the resulting panel rect stays within `margin` of
 * every viewport edge (down to a `minHeight` floor for pathologically short viewports).
 *
 * @param {{ anchor: { top: number, bottom: number, left: number, right: number }, wrap: { top: number, bottom: number, left: number }, panelHeight: number, panelWidth: number, viewportWidth: number, viewportHeight: number, gap: number, margin: number, minHeight: number }} input Measured rects and spacing.
 * @returns {{ openDown: boolean, top: number | null, bottom: number | null, left: number, maxHeight: number | null }} Wrapper-relative placement.
 */
export function computeDropdownPlacement(input) {
    const { anchor, wrap, panelHeight, panelWidth, viewportWidth, viewportHeight, gap, margin, minHeight } = input;
    // Vertical: prefer opening upward (the design default); flip below only when the room above cannot hold the panel
    // and the room below is larger. Clamp the height to the chosen side so the list scrolls instead of leaving the view.
    const spaceAbove = anchor.top - margin;
    const spaceBelow = viewportHeight - anchor.bottom - margin;
    const openDown = panelHeight + gap > spaceAbove && spaceBelow > spaceAbove;
    const room = (openDown ? spaceBelow : spaceAbove) - gap;
    const maxHeight = panelHeight > room ? Math.max(minHeight, room) : null;
    // Horizontal: keep the panel right-aligned to the trigger, then clamp both edges into the viewport so a trigger near
    // either rail cannot shove a wide panel off-screen.
    const rightAlignedLeft = anchor.right - panelWidth;
    const clampedLeft = clamp(rightAlignedLeft, margin, Math.max(margin, viewportWidth - panelWidth - margin));
    const left = clampedLeft - wrap.left;
    if (openDown)
        return { openDown, top: (anchor.bottom + gap) - wrap.top, bottom: null, left, maxHeight };
    return { openDown, top: null, bottom: wrap.bottom - (anchor.top - gap), left, maxHeight };
}

/**
 * Position an absolutely-placed dropdown panel so it stays fully inside the viewport.
 *
 * Boundary: the panel must be a `position: absolute` child of its trigger's `position: relative` wrapper (its
 * `offsetParent`) and already un-hidden so it can be measured. The stylesheet default opens these panels upward and
 * right-aligned relative to the trigger, which clips whenever the dialog sits high in — or hard against a side of — the
 * viewport. This measures the trigger against the live viewport, delegates the geometry to
 * {@link computeDropdownPlacement}, and writes `top`/`bottom`/`left`/`right`/`max-height` inline. All inline overrides
 * are cleared first so a re-open re-measures from the natural, stylesheet-capped size. Exactly one vertical edge is
 * pinned and the other forced to `auto`; the stylesheet default sets `bottom`, so leaving it in place while opening
 * downward would stretch the panel between both edges instead of letting it size to its content.
 *
 * @param {HTMLElement} button Trigger button the panel anchors to.
 * @param {HTMLElement} panel Absolutely-positioned dropdown panel, already visible.
 * @param {{ gap?: number, margin?: number, minHeight?: number }} [options] Spacing overrides (px).
 * @returns {void}
 */
export function placeDropdownPanel(button, panel, options = {}) {
    const gap = options.gap ?? 8;
    const margin = options.margin ?? 8;
    const minHeight = options.minHeight ?? 140;
    // Drop prior overrides so the measurement below reflects the natural, stylesheet-capped size, not last open's clamp.
    panel.style.top = '';
    panel.style.bottom = '';
    panel.style.left = '';
    panel.style.right = '';
    panel.style.maxHeight = '';
    panel.style.overflowY = '';

    const placement = computeDropdownPlacement({
        anchor: button.getBoundingClientRect(),
        wrap: (panel.offsetParent ?? button).getBoundingClientRect(),
        panelHeight: panel.offsetHeight,
        panelWidth: panel.offsetWidth,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        gap,
        margin,
        minHeight,
    });

    if (placement.maxHeight != null) {
        panel.style.maxHeight = `${placement.maxHeight}px`;
        panel.style.overflowY = 'auto';
    }
    if (placement.openDown) {
        panel.style.top = `${placement.top}px`;
        panel.style.bottom = 'auto';
    }
    else {
        panel.style.bottom = `${placement.bottom}px`;
        panel.style.top = 'auto';
    }
    panel.style.left = `${placement.left}px`;
    panel.style.right = 'auto';
}

/**
 * Reveal a hidden dropdown panel at its viewport-fitted position without a first-frame flash.
 *
 * Boundary: opening a panel with `hidden = false` and then positioning it can let the browser paint one frame at the
 * stylesheet default (up + right-aligned) before {@link placeDropdownPanel}'s computed offsets apply — seen as the panel
 * appearing in one spot and jumping to another. Un-hiding under `visibility: hidden` keeps the panel laid out (so it is
 * measurable) but unpainted; only after it is placed do we clear `visibility`, so the panel's first painted frame is
 * already at its final spot. Callers own the toggle: this is the open half; closing stays a plain `hidden = true`.
 *
 * @param {HTMLElement} button Trigger button the panel anchors to.
 * @param {HTMLElement} panel Absolutely-positioned dropdown panel to open.
 * @param {{ gap?: number, margin?: number, minHeight?: number }} [options] Spacing overrides forwarded to placement.
 * @returns {void}
 */
export function revealDropdownPanel(button, panel, options = {}) {
    panel.style.visibility = 'hidden';
    panel.hidden = false;
    try {
        placeDropdownPanel(button, panel, options);
    }
    finally {
        // Always restore visibility, even if measurement threw — a panel stuck at `visibility: hidden` would be open
        // but invisible, worse than an unpositioned one.
        panel.style.visibility = '';
    }
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
 * Boundary: only values in {@link STYLE_SCOPE_ORDER} are valid; any other stored value falls back to `self` so a stale
 * preference cannot widen the capture unexpectedly.
 *
 * @returns {'self' | 'children' | 'ancestors' | 'both'} Persisted scope, defaulting to `self`.
 */
export function loadStyleScope() {
    try {
        const value = window.localStorage.getItem(STYLE_SCOPE_PREF_KEY);
        return STYLE_SCOPE_ORDER.includes(value) ? value : 'self';
    }
    catch {
        return 'self';
    }
}

/**
 * Persist the style-capture scope as a best-effort preference.
 *
 * @param {'self' | 'children' | 'ancestors' | 'both'} scope Scope chosen in the current dialog.
 * @returns {void}
 */
export function saveStyleScope(scope) {
    try {
        window.localStorage.setItem(STYLE_SCOPE_PREF_KEY, STYLE_SCOPE_ORDER.includes(scope) ? scope : 'self');
    }
    catch {
        // Preference persistence is best effort.
    }
}

/**
 * Load the persisted node-count cap for the tree scopes (children/ancestors).
 *
 * Boundary: the cap is a per-user preference reused as the initial value on the next open; an absent or malformed value
 * yields {@link DEFAULT_NODE_LIMIT}. The value is clamped into the supported range so a hand-edited store cannot push
 * the capture past what the server also enforces.
 *
 * @returns {number} Node cap in the supported range.
 */
export function loadStyleNodeLimit() {
    return clampNodeLimit(readJsonStore(STYLE_NODES_PREF_KEY, DEFAULT_NODE_LIMIT));
}

/**
 * Persist the node-count cap as a best-effort preference.
 *
 * @param {number} limit Node cap chosen in the current dialog.
 * @returns {void}
 */
export function saveStyleNodeLimit(limit) {
    writeJsonStore(STYLE_NODES_PREF_KEY, clampNodeLimit(limit));
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
