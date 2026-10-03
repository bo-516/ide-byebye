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
 * Page-config fields the destination helpers read.
 *
 * Boundary: the live config has more keys. Only these two affect which agents are offered and which one Enter
 * targets. A missing object, a missing list, or an empty `enabledAgents` keeps every agent. The field is `unknown`
 * so both the dialog's typed config and a raw record can be passed; non-arrays are treated as "no list".
 */
interface AgentVisibilityConfig {
    enabledAgents?: unknown;
    defaultAgent?: unknown;
}

/** Footer action registered from `agents.custom`. `title` is optional; the menu fills in generic copy. */
interface CustomAgentAction {
    name: string;
    label: string;
    title?: string;
}

/** Spacing overrides for dropdown placement, in pixels. Omitted fields use the same defaults as the callers. */
interface DropdownSpacing {
    gap?: number;
    margin?: number;
    minHeight?: number;
}

/**
 * Viewport measurements for {@link computeDropdownPlacement}. Numbers are CSS pixels. `anchor` is the trigger's
 * border box and `wrap` is the panel's offset parent, both as `getBoundingClientRect` reports them.
 */
interface DropdownPlacementInput {
    anchor: { top: number; bottom: number; left: number; right: number };
    wrap: { top: number; bottom: number; left: number };
    panelHeight: number;
    panelWidth: number;
    viewportWidth: number;
    viewportHeight: number;
    gap: number;
    margin: number;
    minHeight: number;
}

/** Persisted style-capture scope. Anything else stored under the preference key is treated as `self`. */
type StyleScope = 'self' | 'children' | 'ancestors' | 'both';

/**
 * Preference set passed to the savers.
 *
 * Boundary: `choices = new Set()` is `Set<unknown>` under strict checking, and `Set` is invariant, so a `Set<string>`
 * parameter would reject those fields. Screenshot saving only calls `has` with known scope strings.
 */
interface ChoiceSet {
    has(value: string): boolean;
}

/**
 * Whether `value` is one of {@link STYLE_SCOPE_ORDER}.
 *
 * Boundary: `localStorage.getItem` returns `string | null`, and `Array.includes` on `string[]` rejects null. The
 * predicate lets {@link loadStyleScope} return the four-value union instead of `string | null`. The union must stay
 * in sync with `STYLE_SCOPE_ORDER`.
 *
 * @param {string | null} value Stored scope, or null when the key is missing.
 * @returns {boolean} True when `value` is a supported scope.
 */
function isStyleScope(value: string | null): value is StyleScope {
    return value != null && STYLE_SCOPE_ORDER.includes(value);
}

/**
 * Human-readable labels for app agents surfaced in errors and result messages.
 *
 * Boundary: keys must match `AGENT_ACTIONS` names. Missing labels fall back to raw agent ids, which is useful for
 * hidden/custom agents but looks rough in the destination picker.
 *
 * @type {Record<string, string>} Label text by app agent id.
 */
export const AGENT_LABELS = {
    'codex-app': 'Codex App',
    'claude-app': 'Claude App',
    'cursor-app': 'Cursor',
    'grok-build': 'Grok Build',
    'claude-cli': 'Claude Code CLI',
    opencode: 'OpenCode',
    'antigravity-ide': 'Antigravity IDE',
    antigravity: 'Antigravity',
    clipboard: 'Clipboard',
};
/**
 * App-agent actions offered as send destinations in the dialog.
 *
 * Boundary: this list is UI-only; an agent is offered only when `enabledAgents` includes its name. Antigravity IDE
 * and Antigravity stay off unless the plugin config registers them, so a zero-config page does not list them.
 * Adding an action without a matching registered adapter lists an unavailable destination instead of sending to a
 * missing route. `titleKey` is resolved to a localized title at call time by `configuredActions()`. `kind` describes the
 * handoff (`app` opens a desktop app, `ide` an editor, `terminal` a CLI in a new terminal) and picks the icon only
 * when the destination has no brand mark in `AGENT_MARK_BRANDS` (lib/agent-icons.ts): Grok Build, Claude Code CLI and
 * Antigravity are CLI handoffs (Terminal launchers or `claude-cli://`); OpenCode opens the desktop app or its CLI;
 * Antigravity IDE launches `antigravity-ide chat`.
 *
 * @type {Array<{ name: string, label: string, titleKey: string, kind: 'app' | 'ide' | 'terminal' }>} Ordered actions.
 */
export const AGENT_ACTIONS = [
    {
        name: 'codex-app',
        label: 'Codex App',
        titleKey: 'agent.codexApp.title',
        kind: 'app',
    },
    {
        name: 'claude-app',
        label: 'Claude App',
        titleKey: 'agent.claudeApp.title',
        kind: 'app',
    },
    {
        name: 'cursor-app',
        label: 'Cursor',
        titleKey: 'agent.cursorApp.title',
        kind: 'ide',
    },
    {
        name: 'grok-build',
        label: 'Grok Build',
        titleKey: 'agent.grokBuild.title',
        kind: 'terminal',
    },
    {
        name: 'claude-cli',
        label: 'Claude Code CLI',
        titleKey: 'agent.claudeCli.title',
        kind: 'terminal',
    },
    {
        name: 'opencode',
        label: 'OpenCode',
        titleKey: 'agent.opencode.title',
        kind: 'app',
    },
    {
        name: 'antigravity-ide',
        label: 'Antigravity IDE',
        titleKey: 'agent.antigravityIde.title',
        kind: 'ide',
    },
    {
        name: 'antigravity',
        label: 'Antigravity',
        titleKey: 'agent.antigravity.title',
        kind: 'terminal',
    },
];

/**
 * Footer actions for the custom prompt-delivery clients declared in `agents.custom`.
 *
 * Boundary: module-level because the client bundle is a page singleton and {@link configuredActions} is called from
 * places that hold no config. It stays empty until {@link setCustomAgentActions} runs at boot, so a project without
 * `agents.custom` renders exactly the built-in footer.
 *
 * @type {CustomAgentAction[]} Ordered custom footer actions.
 */
let customAgentActions: CustomAgentAction[] = [];

/**
 * Register the custom client footer actions from the injected page config.
 *
 * Boundary: call once during boot, before the first dialog is built. Entries without a usable `name` are dropped, and
 * a name colliding with a built-in action is ignored so a custom client can never replace a shipped button. Passing a
 * non-array (or nothing) clears the list.
 *
 * @param {unknown} [actions] `customAgents` list from the injected client config. Omitted or a non-array clears the list.
 * @returns {void}
 */
export function setCustomAgentActions(actions?: unknown): void {
    const entries = Array.isArray(actions) ? actions : [];
    customAgentActions = entries
        .filter((action) => action && typeof action.name === 'string' && action.name
            && !AGENT_ACTIONS.some((builtIn) => builtIn.name === action.name))
        .map((action) => ({
            name: action.name,
            label: typeof action.label === 'string' && action.label ? action.label : action.name,
            title: typeof action.title === 'string' && action.title ? action.title : undefined,
        }));
}

/**
 * Resolve the human label for an agent id used in errors and result messages.
 *
 * Boundary: built-in labels win, then registered custom clients; an unknown id falls back to the raw name so a stale
 * stored preference still produces readable copy.
 *
 * @param {string} name Agent id. The `string` overload returns a string for callers that require one.
 * @returns {string} Display label.
 */
export function agentLabel(name: string): string;
/**
 * @param {string | null | undefined} name Agent id. Nullish is returned as-is so `??` at the call site still falls through.
 * @returns {string | null | undefined} Display label, or `name` when nothing is registered.
 */
export function agentLabel(name: string | null | undefined): string | null | undefined;
export function agentLabel(name: string | null | undefined): string | null | undefined {
    // The cast erases. Indexing still stringifies a non-string id, which a `typeof === 'string'` guard would skip.
    const known = AGENT_LABELS[name as keyof typeof AGENT_LABELS];
    return known ?? customAgentActions.find((action) => action.name === name)?.label ?? name;
}

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
/** Create a DOM element; return type is intentionally loose so callers can set input-specific fields without casts. */
export function el(tag: string, className?: string, text?: string | null): any {
    const node = document.createElement(tag);
    if (className)
        node.className = className;
    if (text != null)
        node.textContent = text;
    return node;
}

/**
 * Return the app actions the dialog offers as send destinations.
 *
 * Boundary: this exposes handoff agents (app deeplinks, IDEs, terminal CLIs) followed by the custom prompt-delivery
 * clients registered by {@link setCustomAgentActions}. Adding agents here also makes Enter target them, so callers
 * should keep the list limited to user-visible destinations. A custom client without a configured `title` gets
 * localized generic copy so its tooltip still follows the active locale, and always has the `custom` kind.
 *
 * @returns {Array<{ name: string, label: string, title: string, kind: string }>} Ordered destination actions.
 */
export function configuredActions() {
    return [
        ...AGENT_ACTIONS.map((action) => ({
            name: action.name,
            label: action.label,
            title: t(action.titleKey),
            kind: action.kind,
        })),
        ...customAgentActions.map((action) => ({
            name: action.name,
            label: action.label,
            title: action.title ?? t('agent.custom.title', { label: action.label }),
            kind: 'custom',
        })),
    ];
}

/**
 * Decide whether agent `name` should be offered on this page (as a send destination, or as the Copy button).
 *
 * Boundary: an agent turned off in plugin config (`agents.codexApp: false`, `agents.clipboard: false`, …) is absent
 * from `enabledAgents` and never becomes usable — the dialog's `send` guard and the server `/send` route both reject
 * it — so it is dropped instead of left as a control that can only alert "not enabled". A missing or empty
 * `enabledAgents` (malformed config) keeps every agent rather than rendering no destination at all.
 *
 * @param {AgentVisibilityConfig | null | undefined} config Browser config injected by the plugin. Nullish keeps every agent.
 * @param {string} name Agent id (`'clipboard'` for the Copy button).
 * @returns {boolean} True when the agent should be offered.
 */
export function isAgentVisible(config: AgentVisibilityConfig | null | undefined, name: string): boolean {
    const enabled = Array.isArray(config?.enabledAgents) ? config.enabledAgents : [];
    return !enabled.length || enabled.includes(name);
}

/**
 * Return the send destinations that should actually be offered on this page.
 *
 * Boundary: filters {@link configuredActions} through {@link isAgentVisible} — that is what makes a project configured
 * with only a custom client offer only that destination. Agents that ARE configured but currently unavailable (missing
 * binary) stay listed and are marked by the destination menu, because that state is actionable. The Copy button is not
 * in this list (it must never become the Enter target), so the dialog gates it with {@link isAgentVisible} directly.
 *
 * @param {AgentVisibilityConfig | null | undefined} config Browser config injected by the plugin. Nullish keeps every destination.
 * @returns {Array<{ name: string, label: string, title: string, kind: string }>} Destinations to offer, in order.
 */
export function visibleAgentActions(config: AgentVisibilityConfig | null | undefined) {
    return configuredActions().filter((action) => isAgentVisible(config, action.name));
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
 * @returns {any} Parsed value or fallback. The return stays `any` (not `unknown`) so existing callers can read fields
 *          without this annotation introducing errors in files that already narrow the value themselves.
 */
export function readJsonStore(key: string, fallback: unknown, store: Storage = window.localStorage): any {
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
export function writeJsonStore(key: string, value: unknown, store: Storage = window.localStorage): void {
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
 * @param {ChoiceSet} choices Screenshot scope set from the current dialog. `Set<unknown>` is accepted because
 *        `new Set()` infers that, and `Set` is invariant.
 * @returns {void}
 */
export function saveScreenshotChoices(choices: ChoiceSet): void {
    writeJsonStore(SCREENSHOT_PREF_KEY, SCREENSHOT_SCOPE_ORDER.filter((scope) => choices.has(scope)));
}

/**
 * Pick the app agent that Enter should submit to.
 *
 * Boundary: a stale localStorage value or a disabled configured default falls back to the first visible app action.
 * Returning an unavailable-but-configured agent is intentional because the send path owns availability errors.
 *
 * @param {AgentVisibilityConfig | null | undefined} config Browser config injected by the plugin. The union is for
 *        callers whose config type includes null; a nullish value still throws on property access, as before.
 * @returns {string} Agent name to use for Enter and the footer marker.
 */
export function loadLastAgent(config: AgentVisibilityConfig | null | undefined): string {
    const visibleAgents = configuredActions().map((action) => action.name);
    // `!` is erased, so a nullish config still throws on `.enabledAgents` instead of being treated as empty.
    const source = config!;
    const enabledAgents: unknown[] = Array.isArray(source.enabledAgents) ? source.enabledAgents : [];
    const defaultAgent = typeof source.defaultAgent === 'string' ? source.defaultAgent : '';
    // A non-string default cannot be in `visibleAgents`; treating it as '' matches `includes` returning false.
    const fallback = defaultAgent && visibleAgents.includes(defaultAgent) && enabledAgents.includes(defaultAgent)
        ? defaultAgent
        : (visibleAgents.find((agent) => enabledAgents.includes(agent)) ?? visibleAgents[0]);
    try {
        const raw = window.localStorage.getItem(LAST_AGENT_PREF_KEY);
        // `includes` rejects null. A missing key is not a stored agent, same as a failed includes check.
        return raw != null && visibleAgents.includes(raw) && enabledAgents.includes(raw) ? raw : fallback;
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
export function saveLastAgent(agent: string): void {
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
 * @param {Element | null | undefined} element Element used to position the dialog near the user's click. Nullish centers the dialog.
 * @returns {{ x: number, y: number } | null} Center point for dialog placement.
 */
export function anchorFromElement(element: Element | null | undefined): { x: number; y: number } | null {
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
export function clamp(value: number, min: number, max: number): number {
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
 * @param {DropdownPlacementInput} input Measured rects and spacing.
 * @returns {{ openDown: boolean, top: number | null, bottom: number | null, left: number, maxHeight: number | null }} Wrapper-relative placement.
 */
export function computeDropdownPlacement(input: DropdownPlacementInput): { openDown: boolean; top: number | null; bottom: number | null; left: number; maxHeight: number | null } {
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
 * @param {HTMLElement | null} button Trigger button the panel anchors to. Null is accepted because some callers'
 *        fields stay typed `null` after render assigns the live node; the body still treats it as an element.
 * @param {HTMLElement | null} panel Absolutely-positioned dropdown panel, already visible. Same null-field caveat.
 * @param {DropdownSpacing} [options] Spacing overrides (px).
 * @returns {void}
 */
export function placeDropdownPanel(button: HTMLElement | null, panel: HTMLElement | null, options: DropdownSpacing = {}) {
    // Strict inference keeps the pre-render `null` on caller fields. The cast does not change the property reads.
    const trigger = button as HTMLElement;
    const menu = panel as HTMLElement;
    const gap = options.gap ?? 8;
    const margin = options.margin ?? 8;
    const minHeight = options.minHeight ?? 140;
    // Drop prior overrides so the measurement below reflects the natural, stylesheet-capped size, not last open's clamp.
    menu.style.top = '';
    menu.style.bottom = '';
    menu.style.left = '';
    menu.style.right = '';
    menu.style.maxHeight = '';
    menu.style.overflowY = '';

    const placement = computeDropdownPlacement({
        anchor: trigger.getBoundingClientRect(),
        wrap: (menu.offsetParent ?? trigger).getBoundingClientRect(),
        panelHeight: menu.offsetHeight,
        panelWidth: menu.offsetWidth,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        gap,
        margin,
        minHeight,
    });

    if (placement.maxHeight != null) {
        menu.style.maxHeight = `${placement.maxHeight}px`;
        menu.style.overflowY = 'auto';
    }
    if (placement.openDown) {
        menu.style.top = `${placement.top}px`;
        menu.style.bottom = 'auto';
    }
    else {
        menu.style.bottom = `${placement.bottom}px`;
        menu.style.top = 'auto';
    }
    menu.style.left = `${placement.left}px`;
    menu.style.right = 'auto';
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
 * @param {HTMLElement | null} button Trigger button the panel anchors to. See {@link placeDropdownPanel} for the null caveat.
 * @param {HTMLElement | null} panel Absolutely-positioned dropdown panel to open.
 * @param {DropdownSpacing} [options] Spacing overrides forwarded to placement.
 * @returns {void}
 */
export function revealDropdownPanel(button: HTMLElement | null, panel: HTMLElement | null, options: DropdownSpacing = {}): void {
    const menu = panel as HTMLElement;
    menu.style.visibility = 'hidden';
    menu.hidden = false;
    try {
        placeDropdownPanel(button, menu, options);
    }
    finally {
        // Always restore visibility, even if measurement threw — a panel stuck at `visibility: hidden` would be open
        // but invisible, worse than an unpositioned one.
        menu.style.visibility = '';
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
export function screenshotScopeLabel(scope: string): string {
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
export function screenshotScopeTitleLabel(scope: string): string {
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
 * properties are written so unsupported values cannot leak into storage. The parameter stays {@link ChoiceSet} (just
 * `has`) so a `Set<unknown>` field still typechecks. `validStyleKeys` iterates; callers pass a `Set`, which is iterable
 * at runtime. `ChoiceSet` and `Iterable` do not overlap, so the value is cast through `unknown` with no runtime change.
 *
 * @param {ChoiceSet} choices Selected property set from the current dialog. See {@link saveScreenshotChoices}.
 * @returns {void}
 */
export function saveStyleChoices(choices: ChoiceSet): void {
    writeJsonStore(STYLE_KEYS_PREF_KEY, validStyleKeys(choices as unknown as Iterable<string>));
}

/**
 * Load the persisted style-capture scope.
 *
 * Boundary: only values in {@link STYLE_SCOPE_ORDER} are valid; any other stored value falls back to `self` so a stale
 * preference cannot widen the capture unexpectedly.
 *
 * @returns {'self' | 'children' | 'ancestors' | 'both'} Persisted scope, defaulting to `self`.
 */
export function loadStyleScope(): StyleScope {
    try {
        const value = window.localStorage.getItem(STYLE_SCOPE_PREF_KEY);
        return isStyleScope(value) ? value : 'self';
    }
    catch {
        return 'self';
    }
}

/**
 * Persist the style-capture scope as a best-effort preference.
 *
 * @param {string} scope Scope chosen in the current dialog. Only `'self' | 'children' | 'ancestors' | 'both'` are stored;
 *        anything else is written as `self`. Callers iterate `STYLE_SCOPE_ORDER` (`string[]`), so the parameter is `string`.
 * @returns {void}
 */
export function saveStyleScope(scope: string): void {
    try {
        window.localStorage.setItem(STYLE_SCOPE_PREF_KEY, isStyleScope(scope) ? scope : 'self');
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
export function saveStyleNodeLimit(limit: number): void {
    writeJsonStore(STYLE_NODES_PREF_KEY, clampNodeLimit(limit));
}

/**
 * Build the compact link label for an additional source reference chip.
 *
 * Boundary: invalid or missing `data-insp-path` values fall back to a numbered generic label; callers should still
 * send the original selection so the server can perform authoritative validation. This is only a local fallback; the
 * dialog asks the server for the project-relative `@path #range` label before inserting normal references.
 *
 * @param {{ inspPath?: unknown } | null | undefined} selection Browser selection collected from a page element.
 *        Nullish or a missing path uses the numbered fallback. `inspPath` is `unknown` because callers pass both the
 *        dialog's selection and loosely typed picker results.
 * @param {number} index Zero-based reference index.
 * @returns {string} Compact fallback label such as `@Button.jsx #42`.
 */
export function sourceReferenceLabel(selection: { inspPath?: unknown } | null | undefined, index: number): string {
    const parsed = parseInspPathLite(selection?.inspPath ?? '');
    if (!parsed.file)
        return t('reference.codeFallback', { n: index + 1 });
    const line = parsed.line != null ? ` #${parsed.line}` : '';
    return `@${basename(parsed.file)}${line}`;
}
