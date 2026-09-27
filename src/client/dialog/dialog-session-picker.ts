import { agentLabel, el } from './dialog-utils.js';
import { t } from '../lib/i18n.js';
import { fillSessionMenu } from './dialog-session-menu.js';
import { createSessionAction } from './dialog-session-action.js';
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

/**
 * Footer split button, session menu, and target line. The dialog owns send; this owns the stored target.
 * A failed catalog fetch leaves "new session" usable.
 */
export class DialogSessionController {
    splits = new Map();
    targets = {};
    dialogEl = null;
    targetEl = null;
    targetLabel = null;
    menuEl = null;
    menuAgent = '';
    menuState = null;
    menuButtons = [];
    openCaret = null;
    stopPositioning = null;
    busy = false;
    /** Last successful catalog per agent, so a refresh can keep those rows on screen. */
    catalogs = new Map();

    /** @param {{ api: { sessions?: Function }, getLastAgent: Function, rememberAgent: Function, showError: Function }} deps Dialog hooks. `rememberAgent` refreshes the target line. */
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
        this.refreshTargetLine();
        this.syncTargetMarkers();
    }

    /** Release listeners, queued placement, and the open menu; safe before first attach. @returns {void} */
    dispose() {
        this.stopPositioning?.();
        this.stopPositioning = null;
        document.removeEventListener('keydown', this.onKey, true);
        this.closeMenu();
    }

    /**
     * Target line under the editor. Hidden until `lastAgent` has a stored target.
     *
     * @returns {HTMLElement} The row. The dialog inserts it.
     */
    renderTargetLine() {
        const row = el('div', 'cii-session-target');
        row.hidden = true;
        const label = el('span', 'cii-session-target-label');
        const clear = el('button', 'cii-session-target-clear', '✕');
        clear.type = 'button';
        clear.title = t('session.target.clear');
        clear.setAttribute('aria-label', t('session.target.clear'));
        clear.addEventListener('click', () => this.clearTarget(this.deps.getLastAgent()));
        row.append(label, clear);
        this.targetEl = row;
        this.targetLabel = label;
        return row;
    }

    /**
     * Register a split control: the main button sends; the caret opens and anchors the menu.
     *
     * Boundary: the caret starts visible for Codex and Grok only. `applyAgentList` hides it when `sessions` is false
     * and shows it for Antigravity when the flag is on. Returns the main button so the dialog can disable it.
     *
     * @param {{ name: string, label: string, title: string }} action Footer action.
     * @param {HTMLElement} container Where the split is appended.
     * @param {(name: string) => void} onSend Dialog send.
     * @returns {HTMLButtonElement} Main send button.
     */
    renderAction(action, container, onSend) {
        const split = createSessionAction(action, container, (name) => {
            this.closeMenu();
            onSend(name);
        }, (caret) => this.toggleMenu(action, caret));
        this.splits.set(action.name, split);
        return split.button;
    }

    /**
     * Hide or show carets from `GET /agents`.
     *
     * @param {Array<{ name: string, sessions?: boolean }>} agents Availability list.
     * @returns {void}
     */
    applyAgentList(agents) {
        const byName = new Map((agents ?? []).map((agent) => [agent.name, agent]));
        for (const [name, split] of this.splits) {
            const on = byName.get(name)?.sessions === true;
            split.caret.hidden = !on;
            split.root.classList.toggle('cii-agent-split-on', on);
            if (!on && this.menuAgent === name)
                this.closeMenu();
        }
        this.syncTargetMarkers();
    }

    /**
     * Disable carets while the dialog is resolving or sending. The dialog disables the main buttons itself.
     *
     * @param {boolean} disabled Whether the caret should ignore clicks.
     * @returns {void}
     */
    setDisabled(disabled) {
        this.busy = disabled;
        for (const split of this.splits.values())
            split.caret.disabled = disabled;
    }

    /**
     * Show a dot on every caret whose agent has a target, not only `lastAgent`.
     * @returns {void}
     */
    syncTargetMarkers() {
        for (const [name, split] of this.splits)
            split.dot.hidden = !this.targets[name];
    }

    /**
     * Show `发送到 {label} · {title}` only when `lastAgent` has a target.
     * @returns {void}
     */
    refreshTargetLine() {
        if (!this.targetEl)
            return;
        const agent = this.deps.getLastAgent();
        const target = agent ? this.targets[agent] : null;
        if (!target) {
            this.targetEl.hidden = true;
            return;
        }
        this.targetEl.hidden = false;
        const title = target.title || t('session.untitled');
        this.targetLabel.textContent = t('session.target.label', { label: agentLabel(agent), title });
    }

    /**
     * Session id to put on the payload, or `undefined` when this agent has no target.
     *
     * @param {string} agent Agent about to send.
     * @returns {string | undefined}
     */
    targetIdFor(agent) {
        return payloadTargetId(this.targets, agent);
    }

    /**
     * Map `target-missing` / `target-busy` to copy. Other codes return false.
     *
     * Boundary: `target-missing` and `target-invalid` clear only that agent. `target-busy` keeps it. Does not close the dialog.
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
        this.refreshTargetLine();
        this.syncTargetMarkers();
        this.deps.showError(t(code === 'target-busy' ? 'session.error.targetBusy' : 'session.error.targetMissing'));
        return true;
    }

    /**
     * Close the menu when the pointer is outside it and outside the caret that opened it.
     *
     * @param {EventTarget | null} target Event target.
     * @returns {void}
     */
    closeMenuFromOutside(target) {
        if (!this.menuEl || this.menuEl.hidden)
            return;
        if (target instanceof Node && (this.menuEl.contains(target) || this.openCaret?.contains(target)))
            return;
        this.closeMenu();
    }

    /**
     * Escape closes the menu and leaves the dialog open. Returns false when the menu is already closed.
     *
     * @returns {boolean} True when the menu was closed.
     */
    consumeEscape() {
        if (!this.menuEl || this.menuEl.hidden)
            return false;
        this.closeMenu();
        return true;
    }

    /**
     * Hide the menu without changing the stored target.
     * @returns {void}
     */
    closeMenu() {
        if (this.menuEl)
            this.menuEl.hidden = true;
        this.menuState = null;
        this.menuAgent = '';
        this.openCaret = null;
        this.menuButtons = [];
    }

    /**
     * Open or close the menu for one agent.
     *
     * @param {{ name: string, label: string }} action Footer action.
     * @param {HTMLButtonElement} caret Caret that was clicked.
     * @returns {void}
     */
    toggleMenu(action, caret) {
        if (this.busy)
            return;
        if (this.menuAgent === action.name && this.menuEl && !this.menuEl.hidden) {
            this.closeMenu();
            return;
        }
        this.menuAgent = action.name;
        this.openCaret = caret;
        this.menuState = { open: true, index: 0, sessions: [] };
        void this.loadMenu(action);
    }

    /**
     * Fetch the catalog. A refresh covers the previous rows; the first open shows only the loading note.
     * A response for a menu that was closed or switched away is ignored.
     *
     * @param {{ name: string, label: string }} action Agent whose caret was opened.
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
     * Rebuild and position the menu at the open caret. `view.res` during loading stays under the cover.
     *
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
            this.stopPositioning = observeSessionMenuPosition(this.dialogEl, () => ({ anchor: this.openCaret, menu: this.menuEl }));
        }
        const filled = fillSessionMenu(this.menuEl, action, view, {
            busy: this.busy,
            selectedId: this.targets[action.name]?.id,
            onRefresh: () => void this.loadMenu(action),
            onNew: () => this.clearTarget(action.name),
            onChoose: (session, row) => this.chooseRow(action.name, session, row),
        }, this.openCaret);
        this.menuButtons = filled.buttons;
        this.menuState = { open: true, index: this.menuState?.index ?? 0, sessions: filled.rows };
        this.paintActive();
    }

    /**
     * Highlight the keyboard row.
     * @returns {void}
     */
    paintActive() {
        const index = this.menuState?.index ?? 0;
        this.menuButtons.forEach((button, buttonIndex) => {
            button.classList.toggle('cii-session-active', buttonIndex === index);
        });
    }

    /**
     * Arrow keys and Enter while the menu is open. Escape is left to the dialog so it can close the menu first.
     *
     * @param {KeyboardEvent} event Keydown in the capture phase.
     * @returns {void}
     */
    onMenuKey(event) {
        if (!this.menuState?.open || !this.menuAgent)
            return;
        if (event.key === 'Escape')
            return;
        const next = applySessionMenuKey(this.menuState, event.key);
        if (!next.action)
            return;
        event.preventDefault();
        event.stopPropagation();
        this.menuState = next;
        if (next.action === 'select-new')
            this.clearTarget(this.menuAgent);
        else if (next.action === 'select') {
            const row = (next.sessions ?? []).find((session) => session.id === next.sessionId);
            this.chooseStored(this.menuAgent, row);
        }
        else
            this.paintActive();
    }

    /**
     * Select a session row from a click.
     *
     * @param {string} agent Agent that owns the menu.
     * @param {Record<string, unknown>} session Catalog row.
     * @param {{ disabled?: boolean, title?: string, id?: string }} row View model.
     * @returns {void}
     */
    chooseRow(agent, session, row) {
        if (row?.disabled)
            return;
        this.chooseStored(agent, { id: session.id, title: session.title || '' });
    }

    /**
     * Store a target, make that agent `lastAgent`, and close the menu.
     *
     * @param {string} agent Agent name.
     * @param {{ id: string, title?: string } | undefined} row Selected session.
     * @returns {void}
     */
    chooseStored(agent, row) {
        if (!row?.id)
            return;
        this.targets = withSessionTarget(this.targets, agent, { id: row.id, title: row.title ?? '' });
        writeSessionTargets(undefined, this.targets);
        this.closeMenu();
        this.deps.rememberAgent(agent);
        this.refreshTargetLine();
        this.syncTargetMarkers();
    }

    /**
     * Remove one agent's target. Other agents keep theirs.
     *
     * @param {string} agent Agent name.
     * @returns {void}
     */
    clearTarget(agent) {
        if (!agent)
            return;
        this.targets = withSessionTarget(this.targets, agent, null);
        writeSessionTargets(undefined, this.targets);
        this.closeMenu();
        this.refreshTargetLine();
        this.syncTargetMarkers();
    }
}
