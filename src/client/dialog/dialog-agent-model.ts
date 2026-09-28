/**
 * agentMenuRows(actions, state): view model for the destination menu and the trigger that shows the current choice.
 *
 * Purpose: one row per offered agent, carrying everything the menu renders — whether it is the Enter target, whether
 * it can take a prompt right now, whether it lists existing sessions, and the session a send would land in.
 * Boundary: pure; no DOM, storage, or i18n. Copy is chosen by the renderer from `configured` / `reason` / `title`, so
 * the same rows serve every locale. An agent missing from `availability` counts as available (discovery is
 * best-effort), while one absent from `enabledAgents` is unavailable because both the dialog's send guard and the
 * server would reject it (a malformed, empty `enabledAgents` therefore marks every row unavailable).
 *
 * @param {Array<{ name: string, label: string, title: string, kind?: string }>} actions Offered destinations, in menu
 * order (normally `visibleAgentActions(config)`).
 * @param {{ lastAgent?: string, enabledAgents?: string[], availability?: Array<{ name: string, available?: boolean,
 * reason?: string }>, targets?: Record<string, { id: string, title?: string }>, supports?: (name: string) => boolean }}
 * state Current Enter target, plugin config, `GET /agents` result, stored session targets, and session support.
 * @returns {Array<{ name: string, label: string, title: string, kind: string, selected: boolean, configured: boolean,
 * unavailable: boolean, reason: string, sessions: boolean, target: { id: string, title: string } | null }>} Rows in
 * `actions` order; `target` is set only for agents that currently list sessions.
 */
export function agentMenuRows(actions, state: any = {}) {
    const availability = new Map((state.availability ?? []).map((info) => [info?.name, info]));
    const enabled = Array.isArray(state.enabledAgents) ? state.enabledAgents : [];
    return (actions ?? []).map((action) => {
        const configured = enabled.includes(action.name);
        const info: any = availability.get(action.name);
        const sessions = Boolean(state.supports?.(action.name));
        const stored = sessions ? state.targets?.[action.name] : null;
        return {
            name: action.name,
            label: action.label,
            title: action.title ?? '',
            kind: action.kind ?? 'custom',
            selected: action.name === state.lastAgent,
            configured,
            unavailable: !configured || info?.available === false,
            reason: typeof info?.reason === 'string' ? info.reason : '',
            sessions,
            target: stored?.id ? { id: stored.id, title: stored.title ?? '' } : null,
        };
    });
}
