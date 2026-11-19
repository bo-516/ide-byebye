/** One offered destination, in menu order. `kind` defaults to `custom` when the action omits it. */
interface AgentMenuAction {
    name: string;
    label: string;
    title?: string;
    kind?: string;
}

/** One `GET /agents` row. A missing entry counts as available; only `available: false` marks the row down. */
interface AgentAvailabilityInfo {
    name?: string;
    available?: boolean;
    reason?: string;
}

/** Stored session a send would resume. `title` is optional because older entries saved only the id. */
interface AgentStoredTarget {
    id?: string;
    title?: string;
}

/**
 * Inputs that vary between renders. Every field is optional so a partially loaded dialog still produces rows:
 * missing `enabledAgents` marks every row unavailable, missing `availability` leaves them available, missing `pinned`
 * pins nothing (every row folds under "More agents").
 */
interface AgentMenuState {
    lastAgent?: string;
    enabledAgents?: string[];
    pinned?: string[];
    availability?: Array<AgentAvailabilityInfo | null>;
    targets?: Record<string, AgentStoredTarget | null | undefined>;
    supports?: (name: string) => boolean;
}

/**
 * One rendered destination. `target` is set only when that agent currently lists sessions and has a stored id.
 * `pinned` rows are listed above "More agents"; the rest fold under it.
 */
export interface AgentMenuRow {
    name: string;
    label: string;
    title: string;
    kind: string;
    selected: boolean;
    pinned: boolean;
    configured: boolean;
    unavailable: boolean;
    reason: string;
    sessions: boolean;
    target: { id: string; title: string } | null;
}

/**
 * agentMenuRows(actions, state): view model for the destination menu and the trigger that shows the current choice.
 *
 * Purpose: one row per offered agent, carrying everything the menu renders — whether it is the Enter target, whether
 * it is pinned above "More agents", whether it can take a prompt right now, whether it lists existing sessions, and the
 * session a send would land in.
 * Boundary: pure; no DOM, storage, or i18n. Copy is chosen by the renderer from `configured` / `reason` / `title`, so
 * the same rows serve every locale. An agent missing from `availability` counts as available (discovery is
 * best-effort), while one absent from `enabledAgents` is unavailable because both the dialog's send guard and the
 * server would reject it (a malformed, empty `enabledAgents` therefore marks every row unavailable).
 *
 * @param {Array<{ name: string, label: string, title?: string, kind?: string }> | null | undefined} actions Offered
 * destinations, in menu order (normally `visibleAgentActions(config)`). A missing list yields no rows.
 * @param {{ lastAgent?: string, enabledAgents?: string[], availability?: Array<{ name?: string, available?: boolean,
 * reason?: string } | null>, targets?: Record<string, { id?: string, title?: string } | null | undefined>,
 * supports?: (name: string) => boolean, pinned?: string[] }} [state] Current Enter target, plugin config,
 * `GET /agents` result, stored session targets, session support, and pinned ids (`loadPinnedAgents`). Omitted means
 * no agent is enabled, none is the Enter target, and none is pinned.
 * @returns {AgentMenuRow[]} Rows in `actions` order; `target` is set only for agents that currently list sessions.
 */
export function agentMenuRows(actions: AgentMenuAction[] | null | undefined, state: AgentMenuState = {}): AgentMenuRow[] {
    // Tuple annotation only: `.map` would otherwise widen the pair and lose `available` / `reason`.
    const availability = new Map((state.availability ?? []).map((info): [string | undefined, AgentAvailabilityInfo | null] => [info?.name, info]));
    const enabled = Array.isArray(state.enabledAgents) ? state.enabledAgents : [];
    const pinned = Array.isArray(state.pinned) ? state.pinned : [];
    return (actions ?? []).map((action) => {
        const configured = enabled.includes(action.name);
        const info = availability.get(action.name);
        const sessions = Boolean(state.supports?.(action.name));
        const stored = sessions ? state.targets?.[action.name] : null;
        return {
            name: action.name,
            label: action.label,
            title: action.title ?? '',
            kind: action.kind ?? 'custom',
            selected: action.name === state.lastAgent,
            pinned: pinned.includes(action.name),
            configured,
            unavailable: !configured || info?.available === false,
            reason: typeof info?.reason === 'string' ? info.reason : '',
            sessions,
            target: stored?.id ? { id: stored.id, title: stored.title ?? '' } : null,
        };
    });
}

/**
 * splitAgentRows(rows): the menu's two sections, each in catalog order.
 *
 * Boundary: pure. When nothing is pinned, or nothing is left to fold, the menu shows one flat list instead of a
 * "More agents" toggle with an empty side — callers check `more.length` / `pinned.length` for that.
 *
 * @param {AgentMenuRow[]} rows Rows from {@link agentMenuRows}.
 * @returns {{ pinned: AgentMenuRow[], more: AgentMenuRow[] }} Pinned rows and the rows folded under "More agents".
 */
export function splitAgentRows(rows: AgentMenuRow[]): { pinned: AgentMenuRow[]; more: AgentMenuRow[] } {
    return { pinned: rows.filter((row) => row.pinned), more: rows.filter((row) => !row.pinned) };
}
