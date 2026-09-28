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
} from './dialog-session-model.js';

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
    deps;
    onKey;
    targets = {};
    /** Session support per agent from `GET /agents`; agents not reported yet fall back to DEFAULT_SESSION_AGENTS. */
    support = new Map();
    dialogEl = null;
    menuEl = null;
    menuAgent = '';
    menuState = null;
    menuButtons = [];
    menuAnchor = null;
    menuBack = null;
    stopPositioning = null;
    busy = false;
    /** Last successful catalog per agent, so a refresh can keep those rows on screen. */
    catalogs = new Map();

    /**
     * @param {{ api: { sessions?: Function }, getLastAgent: Function, rememberAgent: Function, showError: Function,
     * onChange?: Function }} deps Dialog hooks. `rememberAgent` makes a chosen agent the Enter target; `onChange` runs
     * after any stored target changes (omitting it only means the destination is not repainted).
     */
    constructor(deps) {
        this.deps = deps;
        this.onKey = (event) => this.onMenuKey(event);
    }

    /**
     * Bind fresh dialog DOM and restore targets, releasing any previous menu and placement observers first.
     * @param {HTMLElement} dialogEl Required current dialog; a stale node would attach menus to a closed dialog.
     * @returns {void}
     */
    attach(dialogEl) {
        this.dispose();
        this.dialogEl = dialogEl;
        this.menuEl = null;
        this.targets = readSessionTargets();
        document.addEventListener('keydown', this.onKey, true);
        this.notify();
    }

    /** Release listeners, queued placement, and the open menu; safe before first attach. @returns {void} */
    dispose() {
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
    supports(agent) {
        return this.support.has(agent) ? this.support.get(agent) : DEFAULT_SESSION_AGENTS.has(agent);
    }

    /**
     * Stored session for `agent`, or null when the next send starts a new session.
     * @param {string} agent Agent name.
     * @returns {{ id: string, title: string } | null} Stored target.
     */
    targetFor(agent) {
        return this.targets[agent] ?? null;
    }

    /**
     * Record session support from `GET /agents`; a menu open for an agent that lost support closes.
     * @param {Array<{ name: string, sessions?: boolean }>} agents Availability list.
     * @returns {void}
     */
    applyAgentList(agents) {
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
    setDisabled(disabled) {
        this.busy = disabled;
    }

    /**
     * Session id to put on the payload, or `undefined` when this agent has no target.
     * @param {string} agent Agent about to send.
     * @returns {string | undefined}
     */
    targetIdFor(agent) {
        return payloadTargetId(this.targets, agent);
    }

    /**
     * Map `target-missing` / `target-busy` / `target-invalid` to copy. Other codes return false.
     *
     * Boundary: `target-missing` and `target-invalid` clear only that agent. `target-busy` keeps it. Does not close
     * the dialog.
     *
     * @param {Record<string, unknown>} result Send response.
     * @returns {boolean} True when this controller showed the error.
     */
    handleSendError(result) {
        const code = result?.code;
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
    closeMenuFromOutside(target) {
        if (!this.isMenuOpen())
            return;
        if (target instanceof Node && (this.menuEl.contains(target) || this.menuAnchor?.contains(target)))
            return;
        this.closeMenu();
    }

    /**
     * Escape closes the menu and leaves the dialog open. Returns false when the menu is already closed.
     * @returns {boolean} True when the menu was closed.
     */
    consumeEscape() {
        if (!this.isMenuOpen())
            return false;
        this.closeMenu();
        return true;
    }

    /** Whether the session menu is showing. @returns {boolean} */
    isMenuOpen() {
        return Boolean(this.menuEl && !this.menuEl.hidden);
    }

    /** Hide the menu without changing the stored target. @returns {void} */
    closeMenu() {
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
     * @param {HTMLElement} anchor Element the menu is placed against; a wrong node misplaces the menu.
     * @param {(() => void) | null} [onBack] Optional back handler.
     * @returns {void}
     */
    openMenu(action, anchor, onBack = null) {
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
    async loadMenu(action) {
        const previous = this.catalogs.get(action.name);
        this.paintMenu(action, sessionLoadingView(previous));
        try {
            const res = await this.deps.api.sessions(action.name);
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
     * @param {{ loading?: boolean, overlay?: boolean, error?: string, res?: Record<string, unknown> }} view Fetch state.
     * @returns {void}
     */
    paintMenu(action, view) {
        if (!this.dialogEl)
            return;
        if (!this.menuEl) {
            this.menuEl = el('div', 'cii-session-menu');
            this.dialogEl.append(this.menuEl);
            this.stopPositioning = observeSessionMenuPosition(this.dialogEl, () => ({ anchor: this.menuAnchor, menu: this.menuEl }));
        }
        const filled = fillSessionMenu(this.menuEl, action, view, {
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
    goBack() {
        const back = this.menuBack;
        this.closeMenu();
        back?.();
    }

    /** Highlight the keyboard row. @returns {void} */
    paintActive() {
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
    onMenuKey(event) {
        if (!this.menuState?.open || !this.menuAgent || event.key === 'Escape')
            return;
        if (event.key === 'ArrowLeft' && this.menuBack) {
            event.preventDefault();
            event.stopPropagation();
            this.goBack();
            return;
        }
        const next = applySessionMenuKey(this.menuState, event.key);
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
     * @param {Record<string, unknown>} session Catalog row.
     * @param {{ disabled?: boolean }} row View model; disabled rows are ignored.
     * @returns {void}
     */
    chooseRow(agent, session, row) {
        if (row?.disabled)
            return;
        this.chooseStored(agent, { id: session.id, title: session.title || '' });
    }

    /**
     * Store a target, make that agent the Enter target, and close the menu.
     * @param {string} agent Agent name.
     * @param {{ id: string, title?: string } | undefined} row Selected session; a missing id is ignored.
     * @returns {void}
     */
    chooseStored(agent, row) {
        if (!row?.id)
            return;
        this.targets = withSessionTarget(this.targets, agent, { id: row.id, title: row.title ?? '' });
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
    chooseNew(agent) {
        if (!agent)
            return;
        this.targets = withSessionTarget(this.targets, agent, null);
        writeSessionTargets(undefined, this.targets);
        this.closeMenu();
        this.deps.rememberAgent(agent);
        this.notify();
    }

    /** Report a stored-target change to the destination. @returns {void} */
    notify() {
        this.deps?.onChange?.();
    }
}
