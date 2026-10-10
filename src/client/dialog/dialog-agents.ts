import { t } from '../lib/i18n.js';

/**
 * Agent destination catalog: built-in app actions, custom prompt-delivery clients, visibility rules,
 * and the last-used agent preference.
 *
 * Boundary: `localStorage` reads/writes are best-effort and swallowed; the in-memory custom action
 * list is a page singleton set once at boot.
 */

export const LAST_AGENT_PREF_KEY = 'code-intent-inspector:last-app-agent';

/**
 * Page-config fields the destination helpers read.
 *
 * Boundary: the live config has more keys. Only these two affect which agents are offered and which one Enter
 * targets. A missing object, a missing list, or an empty `enabledAgents` keeps every agent. The field is `unknown`
 * so both the dialog's typed config and a raw record can be passed; non-arrays are treated as "no list".
 */
export interface AgentVisibilityConfig {
    enabledAgents?: unknown;
    defaultAgent?: unknown;
}

/** Footer action registered from `agents.custom`. `title` is optional; the menu fills in generic copy. */
interface CustomAgentAction {
    name: string;
    label: string;
    title?: string;
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
