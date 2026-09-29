import { t } from '../lib/i18n.js';
import { el } from './dialog-utils.js';
import { fillSessionMenu } from './dialog-session-menu.js';
import { observeSessionMenuPosition } from './dialog-session-position.js';
import {
    applySessionMenuKey,
    applySessionSendResult,
    payloadTargetId,
    readSessionTargets,
    sessionLoadingView,
    withSessionTarget,
    writeSessionTargets,
    type SessionCatalog,
    type SessionMenuState,
    type SessionMenuView,
    type SessionTarget,
} from './dialog-session-model.js';

/**
 * Dialog hooks. `api.sessions` is optional only because the dialog's api interface does not list it; the live client
 * provides the method and {@link DialogSessionController.loadMenu} calls it. Omitting `onChange` skips the destination
 * repaint and nothing else.
 */
interface SessionControllerDeps {
    // `agents` overlaps the dialog's api type, which does not declare `sessions` (a weak type with only `sessions` would reject it).
    api: {
        agents?: () => Promise<unknown>;
        sessions?: (agent: string) => Promise<SessionCatalog>;
    };
    getLastAgent: () => string;
    rememberAgent: (agent: string) => void;
    showError: (text: string) => void;
    onChange?: () => void;
}

/** Agents that list sessions before discovery; opt-in adapters stay off until `GET /agents` advertises them. */
const DEFAULT_SESSION_AGENTS = new Set(['codex-app', 'grok-build']);

/**
 * Stored per-agent session targets and the session menu the destination picker opens.
 *
 * Boundary: the dialog owns send and the destination picker owns the agent list; this owns the stored target, which
 * agents list sessions, and the catalog menu. The menu is anchor-agnostic: it opens at whatever element the caller
 * passes and can hand control back through an optional back callback. A failed catalog fetch leaves "new session"
 * usable. Every target change is reported through `deps.onChange` so the destination can repaint.
 */
export class DialogSessionController {
    deps: SessionControllerDeps;
    onKey: (event: KeyboardEvent) => void;
    targets: Record<string, SessionTarget> = {};
    /** Session support per agent from `GET /agents`; agents not reported yet fall back to DEFAULT_SESSION_AGENTS. */
    support = new Map<string, boolean>();
    dialogEl: HTMLElement | null = null;
    menuEl: HTMLElement | null = null;
    menuAgent = '';
    menuState: SessionMenuState | null = null;
    menuButtons: HTMLButtonElement[] = [];
    menuAnchor: HTMLElement | null = null;
    menuBack: (() => void) | null = null;
    stopPositioning: (() => void) | null = null;
    busy = false;
    /** Last successful catalog per agent, so a refresh can keep those rows on screen. */
    catalogs = new Map<string, SessionCatalog>();

    /**
     * @param {SessionControllerDeps} deps Dialog hooks. `rememberAgent` makes a chosen agent the Enter target; `onChange`
     * runs after any stored target changes (omitting it only means the destination is not repainted).
     */
    constructor(deps: SessionControllerDeps) {
        this.deps = deps;
        this.onKey = (event: KeyboardEvent) => this.onMenuKey(event);
    }

    /**
     * Bind fresh dialog DOM and restore targets, releasing any previous menu and placement observers first.
     * @param {HTMLElement} dialogEl Required current dialog; a stale node would attach menus to a closed dialog.
     * @returns {void}
     */
    attach(dialogEl: HTMLElement): void {
        this.dispose();
        this.dialogEl = dialogEl;
        this.menuEl = null;
        this.targets = readSessionTargets();
        document.addEventListener('keydown', this.onKey, true);
        this.notify();
    }

    /** Release listeners, queued placement, and the open menu; safe before first attach. @returns {void} */
    dispose(): void {
        this.stopPositioning?.();
        this.stopPositioning = null;
        document.removeEventListener('keydown', this.onKey, true);
        this.closeMenu();
    }

    /**
     * Whether `agent` currently lists existing sessions.
     * @param {string} agent Agent name.
     * @returns {boolean} The server's `sessions` flag once known, else the built-in default.
     */
    supports(agent: string): boolean {
        // `Map.get` stays `boolean | undefined` after `has`. The assertion erases; `has` still tells a stored
        // `undefined` from a missing key, which `=== undefined` would collapse onto the default.
        return this.support.has(agent) ? this.support.get(agent)! : DEFAULT_SESSION_AGENTS.has(agent);
    }

    /**
     * Stored session for `agent`, or null when the next send starts a new session.
     * @param {string} agent Agent name.
     * @returns {{ id: string, title: string } | null} Stored target.
     */
    targetFor(agent: string): SessionTarget | null {
        return this.targets[agent] ?? null;
    }

    /**
     * Record session support from `GET /agents`; a menu open for an agent that lost support closes.
     * @param {Array<{ name: string, sessions?: boolean }> | null | undefined} agents Availability list. A missing list
     * leaves previously recorded support in place.
     * @returns {void}
     */
    applyAgentList(agents: Array<{ name: string; sessions?: boolean }> | null | undefined): void {
        for (const agent of agents ?? [])
            this.support.set(agent.name, agent.sessions === true);
        if (this.menuAgent && !this.supports(this.menuAgent))
            this.closeMenu();
        this.notify();
    }

    /**
     * Mark the menu busy while the dialog is resolving or sending; rows render disabled and it cannot open.
     * @param {boolean} disabled Whether session choices should ignore clicks.
     * @returns {void}
     */
    setDisabled(disabled: boolean): void {
        this.busy = disabled;
    }

    /**
     * Session id to put on the payload, or `undefined` when this agent has no target.
     * @param {string} agent Agent about to send.
     * @returns {string | undefined}
     */
    targetIdFor(agent: string): string | undefined {
        return payloadTargetId(this.targets, agent);
    }

    /**
     * Map `target-missing` / `target-busy` / `target-invalid` to copy. Other codes return false.
     *
     * Boundary: `target-missing` and `target-invalid` clear only that agent. `target-busy` keeps it. Does not close
     * the dialog.
     *
     * @param {{ code?: string, agent?: string } | null | undefined} result Send response. Only `code` and `agent` are
     * read; other fields stay with the dialog. A missing result is not a session error.
     * @returns {boolean} True when this controller showed the error.
     */
    handleSendError(result: { code?: string; agent?: string } | null | undefined): boolean {
        // `result?.code` would not narrow `result`, so a missing result returns before `agent` is read.
        if (!result)
            return false;
        const code = result.code;
        if (code !== 'target-missing' && code !== 'target-busy' && code !== 'target-invalid')
            return false;
        const agent = result.agent || this.deps.getLastAgent();
        this.targets = applySessionSendResult(this.targets, agent, result);
        writeSessionTargets(undefined, this.targets);
        this.notify();
        this.deps.showError(t(code === 'target-busy' ? 'session.error.targetBusy' : 'session.error.targetMissing'));
        return true;
    }

    /**
     * Close the menu when the pointer is outside it and outside the element it is anchored to.
     * @param {EventTarget | null} target Event target.
     * @returns {void}
     */
    closeMenuFromOutside(target: EventTarget | null): void {
        if (!this.isMenuOpen())
            return;
        // isMenuOpen already requires a rendered menu; the field stays null only while the menu is closed.
        const menu = this.menuEl as HTMLElement;
        if (target instanceof Node && (menu.contains(target) || this.menuAnchor?.contains(target)))
            return;
        this.closeMenu();
    }

    /**
     * Escape closes the menu and leaves the dialog open. Returns false when the menu is already closed.
     * @returns {boolean} True when the menu was closed.
     */
    consumeEscape(): boolean {
        if (!this.isMenuOpen())
            return false;
        this.closeMenu();
        return true;
    }

    /** Whether the session menu is showing. @returns {boolean} */
    isMenuOpen(): boolean {
        return Boolean(this.menuEl && !this.menuEl.hidden);
    }

    /** Hide the menu without changing the stored target. @returns {void} */
    closeMenu(): void {
        if (this.menuEl)
            this.menuEl.hidden = true;
        this.menuState = null;
        this.menuAgent = '';
        this.menuAnchor = null;
        this.menuBack = null;
        this.menuButtons = [];
    }

    /**
     * Open the session menu for one agent at `anchor`.
     *
     * Boundary: ignored while busy. `onBack`, when given, adds a back control (and ArrowLeft) that closes this menu and
     * calls it — the destination picker uses it to return to the agent list.
     *
     * @param {{ name: string, label: string }} action Agent whose sessions to list.
     * @param {HTMLElement | null} anchor Element the menu is placed against. Null leaves it unpositioned until a later
     * paint supplies one; a wrong node misplaces the menu.
     * @param {(() => void) | null} [onBack] Optional back handler.
     * @returns {void}
     */
    openMenu(action: { name: string; label: string }, anchor: HTMLElement | null, onBack: (() => void) | null = null): void {
        if (this.busy)
            return;
        this.menuAgent = action.name;
        this.menuAnchor = anchor;
        this.menuBack = onBack;
        this.menuState = { open: true, index: 0, sessions: [] };
        void this.loadMenu(action);
    }

    /**
     * Fetch the catalog. A refresh covers the previous rows; the first open shows only the loading note.
     * A response for a menu that was closed or switched away is ignored.
     * @param {{ name: string, label: string }} action Agent whose menu is open.
     * @returns {Promise<void>}
     */
    async loadMenu(action: { name: string; label: string }): Promise<void> {
        const previous = this.catalogs.get(action.name);
        this.paintMenu(action, sessionLoadingView(previous));
        try {
            // The dialog's api interface omits `sessions`; the live client provides it. A missing method still throws.
            const res = await this.deps.api.sessions!(action.name);
            if (this.menuAgent !== action.name)
                return;
            this.catalogs.set(action.name, res);
            this.paintMenu(action, { res });
        }
        catch (err) {
            if (this.menuAgent !== action.name)
                return;
            const error = err instanceof Error ? err.message : String(err);
            this.paintMenu(action, previous ? { error, res: previous } : { error });
        }
    }

    /**
     * Rebuild and position the menu at its anchor. `view.res` during loading stays under the cover.
     * @param {{ name: string, label: string }} action Agent the menu belongs to.
     * @param {SessionMenuView} view Fetch state.
     * @returns {void}
     */
    paintMenu(action: { name: string; label: string }, view: SessionMenuView): void {
        const dialogEl = this.dialogEl;
        if (!dialogEl)
            return;
        let menuEl = this.menuEl;
        if (!menuEl) {
            // `el` is typed loose; a fresh HTMLElement keeps `menuEl` narrowed for append and fill.
            const created: HTMLElement = el('div', 'cii-session-menu');
            menuEl = created;
            this.menuEl = created;
            dialogEl.append(created);
            this.stopPositioning = observeSessionMenuPosition(dialogEl, () => ({ anchor: this.menuAnchor, menu: this.menuEl }));
        }
        const filled = fillSessionMenu(menuEl, action, view, {
            busy: this.busy,
            selectedId: this.targets[action.name]?.id,
            onRefresh: () => void this.loadMenu(action),
            onNew: () => this.chooseNew(action.name),
            onChoose: (session, row) => this.chooseRow(action.name, session, row),
            onBack: this.menuBack ? () => this.goBack() : null,
        }, this.menuAnchor);
        this.menuButtons = filled.buttons;
        this.menuState = { open: true, index: this.menuState?.index ?? 0, sessions: filled.rows };
        this.paintActive();
    }

    /** Close this menu and return to whoever opened it. @returns {void} */
    goBack(): void {
        const back = this.menuBack;
        this.closeMenu();
        back?.();
    }

    /** Highlight the keyboard row. @returns {void} */
    paintActive(): void {
        const index = this.menuState?.index ?? 0;
        this.menuButtons.forEach((button, buttonIndex) => {
            button.classList.toggle('cii-session-active', buttonIndex === index);
        });
    }

    /**
     * Arrow keys and Enter while the menu is open; ArrowLeft goes back when a back handler exists. Escape is left to
     * the dialog so it can close the menu first.
     * @param {KeyboardEvent} event Keydown in the capture phase.
     * @returns {void}
     */
    onMenuKey(event: KeyboardEvent): void {
        const state = this.menuState;
        if (!state?.open || !this.menuAgent || event.key === 'Escape')
            return;
        if (event.key === 'ArrowLeft' && this.menuBack) {
            event.preventDefault();
            event.stopPropagation();
            this.goBack();
            return;
        }
        const next = applySessionMenuKey(state, event.key);
        if (!next.action)
            return;
        event.preventDefault();
        event.stopPropagation();
        this.menuState = next;
        if (next.action === 'select-new')
            this.chooseNew(this.menuAgent);
        else if (next.action === 'select') {
            const row = (next.sessions ?? []).find((session) => session.id === next.sessionId);
            this.chooseStored(this.menuAgent, row);
        }
        else
            this.paintActive();
    }

    /**
     * Select a session row from a click.
     * @param {string} agent Agent that owns the menu.
     * @param {unknown} session Catalog row. Non-objects still follow the same property read as a record.
     * @param {{ disabled?: boolean } | null | undefined} row View model; disabled rows are ignored.
     * @returns {void}
     */
    chooseRow(agent: string, session: unknown, row: { disabled?: boolean } | null | undefined): void {
        if (row?.disabled)
            return;
        // The cast does not convert; a missing row still throws on the property read, as before.
        const picked = session as { id?: string; title?: string };
        this.chooseStored(agent, { id: picked.id, title: picked.title || '' });
    }

    /**
     * Store a target, make that agent the Enter target, and close the menu.
     * @param {string} agent Agent name.
     * @param {{ id?: unknown, title?: unknown } | null | undefined} row Selected session; a missing id is ignored.
     * Non-string ids are stored as-is when truthy — the cast only satisfies the target map's string id.
     * @returns {void}
     */
    chooseStored(agent: string, row: { id?: unknown; title?: unknown } | null | undefined): void {
        if (!row?.id)
            return;
        const title = row.title as string | undefined;
        this.targets = withSessionTarget(this.targets, agent, { id: row.id as string, title: title ?? '' });
        writeSessionTargets(undefined, this.targets);
        this.closeMenu();
        this.deps.rememberAgent(agent);
        this.notify();
    }

    /**
     * Send `agent`'s next prompt to a new session: clear only its target and make it the Enter target.
     * @param {string} agent Agent name; empty is ignored.
     * @returns {void}
     */
    chooseNew(agent: string): void {
        if (!agent)
            return;
        this.targets = withSessionTarget(this.targets, agent, null);
        writeSessionTargets(undefined, this.targets);
        this.closeMenu();
        this.deps.rememberAgent(agent);
        this.notify();
    }

    /** Report a stored-target change to the destination. @returns {void} */
    notify(): void {
        this.deps?.onChange?.();
    }
}
