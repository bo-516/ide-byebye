import { agentLabel, revealDropdownPanel, visibleAgentActions } from './dialog-utils.js';
import { agentMenuRows } from './dialog-agent-model.js';
import { createAgentPickerDom, fillAgentMenu, paintAgentTrigger } from './dialog-agent-menu.js';

/**
 * Destination picker: the compact trigger beside Send that shows where the prompt goes, and the menu that changes it.
 *
 * Boundary: choosing a row only changes the Enter target (`deps.rememberAgent`); sending stays with the dialog, so a
 * rarely-changed destination costs no space. Rows that list sessions hand off to the session controller's menu,
 * anchored at the same trigger, which can come back here. Keyboard navigation listens on the document only while the
 * menu is open (like the session menu); Escape is left to the dialog through {@link consumeEscape}. One instance lives
 * across dialog opens and `render()` rebuilds its DOM each time; methods called before the first render are no-ops.
 */
export class DialogAgentPicker {
    deps;
    onKey;
    dom = null;
    rootEl = null;
    triggerEl = null;
    menuEl = null;
    rows = [];
    buttons = [];
    activeIndex = 0;
    availability = [];
    disabled = false;

    /**
     * @param {{ config: () => Record<string, unknown>, sessions: { targets: object, supports: Function,
     * isMenuOpen: Function, closeMenu: Function, openMenu: Function }, getLastAgent: () => string,
     * rememberAgent: (name: string) => void, onPicked?: () => void }} deps Dialog hooks; `onPicked` runs after a row
     * is chosen (the dialog returns focus to the editor). Omitting `sessions` hides every session affordance.
     */
    constructor(deps) {
        this.deps = deps;
        this.onKey = (event) => this.onMenuKey(event);
    }

    /** Build the trigger + menu for a fresh dialog. @returns {HTMLElement} Wrapper; hidden with no destination. */
    render() {
        this.close();
        this.dom = createAgentPickerDom(() => this.toggle());
        this.rootEl = this.dom.root;
        this.triggerEl = this.dom.trigger;
        this.menuEl = this.dom.menu;
        this.refresh();
        return this.rootEl;
    }

    /** Apply `GET /agents` availability (a non-array clears it). @param {Array<object>} agents List. @returns {void} */
    setAvailability(agents) {
        this.availability = Array.isArray(agents) ? agents : [];
        this.refresh();
    }

    /** The row for the current Enter target, or null. @returns {Record<string, any> | null} */
    current() {
        return this.rows.find((row) => row.selected) ?? null;
    }

    /** Whether any destination is offered on this page. @returns {boolean} */
    hasDestinations() {
        return this.rows.length > 0;
    }

    /**
     * Recompute rows from config, availability, the Enter target, and stored sessions; repaint the trigger (and the
     * menu when open). Safe to call at any time.
     * @returns {void}
     */
    refresh() {
        const config = this.deps.config() ?? {};
        const sessions = this.deps.sessions;
        const lastAgent = this.deps.getLastAgent();
        this.rows = agentMenuRows(visibleAgentActions(config), {
            lastAgent,
            enabledAgents: config.enabledAgents,
            availability: this.availability,
            targets: sessions?.targets,
            supports: (name) => sessions?.supports(name) === true,
        });
        if (!this.dom)
            return;
        this.rootEl.hidden = this.rows.length === 0;
        paintAgentTrigger(this.dom, this.current(), agentLabel(lastAgent));
        if (this.isOpen())
            this.paint();
    }

    /** Open, or close whichever destination menu is showing. @returns {void} */
    toggle() {
        if (this.disabled)
            return;
        if (this.isOpen())
            this.close();
        else if (this.deps.sessions?.isMenuOpen())
            this.deps.sessions.closeMenu();
        else
            this.open();
    }

    /** Show the menu with the Enter target highlighted. @returns {void} */
    open() {
        if (!this.menuEl || this.disabled || !this.rows.length)
            return;
        this.activeIndex = Math.max(0, this.rows.findIndex((row) => row.selected));
        this.paint();
        revealDropdownPanel(this.triggerEl, this.menuEl);
        document.addEventListener('keydown', this.onKey, true);
    }

    /** Hide the menu and stop listening for its keys; safe when already closed. @returns {void} */
    close() {
        document.removeEventListener('keydown', this.onKey, true);
        if (this.menuEl)
            this.menuEl.hidden = true;
    }

    /** Whether the destination menu is showing. @returns {boolean} */
    isOpen() {
        return Boolean(this.menuEl && !this.menuEl.hidden);
    }

    /** Rebuild the menu rows. @returns {void} */
    paint() {
        this.buttons = fillAgentMenu(this.menuEl, this.rows, {
            onSelect: (row) => this.select(row),
            onSessions: (row) => this.openSessions(row),
        });
        this.paintActive();
    }

    /** Highlight the keyboard row. @returns {void} */
    paintActive() {
        this.buttons.forEach((button, index) => {
            button.parentElement?.classList.toggle('cii-agent-row-active', index === this.activeIndex);
        });
    }

    /**
     * While open: ArrowUp/ArrowDown move, Enter chooses, ArrowRight opens sessions; handled keys never reach the editor.
     * @param {KeyboardEvent} event Keydown in the capture phase. @returns {void}
     */
    onMenuKey(event) {
        if (!this.isOpen() || !this.rows.length)
            return;
        const row = this.rows[this.activeIndex];
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const step = event.key === 'ArrowDown' ? 1 : -1;
            this.activeIndex = (this.activeIndex + step + this.rows.length) % this.rows.length;
            this.paintActive();
        }
        else if (event.key === 'Enter' && row)
            this.select(row);
        else if (event.key === 'ArrowRight' && row?.sessions)
            this.openSessions(row);
        else
            return;
        event.preventDefault();
        event.stopPropagation();
    }

    /** Make `row` the Enter target. @param {Record<string, any>} row Chosen row. @returns {void} */
    select(row) {
        this.close();
        this.deps.rememberAgent(row.name);
        this.deps.onPicked?.();
    }

    /** Swap to `row`'s session menu at the same trigger. @param {Record<string, any>} row Row. @returns {void} */
    openSessions(row) {
        this.close();
        this.deps.sessions?.openMenu({ name: row.name, label: row.label }, this.triggerEl, () => this.open());
    }

    /** Lock the trigger while the dialog is busy. @param {boolean} disabled Busy state. @returns {void} */
    setDisabled(disabled) {
        this.disabled = disabled;
        if (this.triggerEl)
            this.triggerEl.disabled = disabled;
        if (disabled)
            this.close();
    }

    /** Close when a press lands outside the picker. @param {EventTarget | null} target Press target. @returns {void} */
    closeMenuFromOutside(target) {
        if (this.isOpen() && target instanceof Node && !this.rootEl.contains(target))
            this.close();
    }

    /** Escape closes an open menu first. @returns {boolean} True when the menu was closed. */
    consumeEscape() {
        if (!this.isOpen())
            return false;
        this.close();
        return true;
    }
}
