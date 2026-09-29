import { agentLabel, revealDropdownPanel, visibleAgentActions } from './dialog-utils.js';
import { agentMenuRows, type AgentMenuRow } from './dialog-agent-model.js';
import { createAgentPickerDom, fillAgentMenu, paintAgentTrigger } from './dialog-agent-menu.js';
import { type DialogSessionController } from './dialog-session-picker.js';

/**
 * Dialog hooks. `sessions` is the session controller when the dialog has one; omitting it hides every session
 * affordance. `config` only needs `enabledAgents` — the live config object has more keys and still fits.
 */
interface AgentPickerDeps {
    config: () => { enabledAgents?: string[] };
    sessions?: DialogSessionController | null;
    getLastAgent: () => string;
    rememberAgent: (name: string) => void;
    onPicked?: () => void;
}

/** Nodes from {@link createAgentPickerDom}. Kept so refresh can repaint without querying the DOM. */
interface AgentPickerDom {
    root: HTMLElement;
    trigger: HTMLButtonElement;
    kind: HTMLElement;
    label: HTMLElement;
    session: HTMLElement;
    menu: HTMLElement;
}

/** `GET /agents` fields this picker reads. Session support is owned by the session controller. */
interface PickerAvailability {
    name: string;
    available?: boolean;
    reason?: string;
}

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
    deps: AgentPickerDeps;
    onKey: (event: KeyboardEvent) => void;
    dom: AgentPickerDom | null = null;
    rootEl: HTMLElement | null = null;
    triggerEl: HTMLButtonElement | null = null;
    menuEl: HTMLElement | null = null;
    rows: AgentMenuRow[] = [];
    buttons: HTMLButtonElement[] = [];
    activeIndex = 0;
    availability: PickerAvailability[] = [];
    disabled = false;

    /**
     * @param {AgentPickerDeps} deps Dialog hooks; `onPicked` runs after a row is chosen (the dialog returns focus to the
     * editor). Omitting `sessions` hides every session affordance.
     */
    constructor(deps: AgentPickerDeps) {
        this.deps = deps;
        this.onKey = (event: KeyboardEvent) => this.onMenuKey(event);
    }

    /** Build the trigger + menu for a fresh dialog. @returns {HTMLElement} Wrapper; hidden with no destination. */
    render(): HTMLElement {
        this.close();
        this.dom = createAgentPickerDom(() => this.toggle());
        this.rootEl = this.dom.root;
        this.triggerEl = this.dom.trigger;
        this.menuEl = this.dom.menu;
        this.refresh();
        return this.rootEl as HTMLElement;
    }

    /** Apply `GET /agents` availability (a non-array clears it). @param {PickerAvailability[] | null | undefined} agents List. @returns {void} */
    setAvailability(agents: PickerAvailability[] | null | undefined): void {
        this.availability = Array.isArray(agents) ? agents : [];
        this.refresh();
    }

    /** The row for the current Enter target, or null. @returns {AgentMenuRow | null} */
    current(): AgentMenuRow | null {
        return this.rows.find((row) => row.selected) ?? null;
    }

    /** Whether any destination is offered on this page. @returns {boolean} */
    hasDestinations(): boolean {
        return this.rows.length > 0;
    }

    /**
     * Recompute rows from config, availability, the Enter target, and stored sessions; repaint the trigger (and the
     * menu when open). Safe to call at any time.
     * @returns {void}
     */
    refresh(): void {
        const config = this.deps.config() ?? {};
        const sessions = this.deps.sessions;
        const lastAgent = this.deps.getLastAgent();
        this.rows = agentMenuRows(visibleAgentActions(config), {
            lastAgent,
            enabledAgents: config.enabledAgents,
            availability: this.availability,
            targets: sessions?.targets,
            supports: (name: string) => sessions?.supports(name) === true,
        });
        if (!this.dom)
            return;
        // render() sets rootEl with dom; this return already handled the pre-render call.
        (this.rootEl as HTMLElement).hidden = this.rows.length === 0;
        paintAgentTrigger(this.dom, this.current(), agentLabel(lastAgent));
        if (this.isOpen())
            this.paint();
    }

    /** Open, or close whichever destination menu is showing. @returns {void} */
    toggle(): void {
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
    open(): void {
        if (!this.menuEl || this.disabled || !this.rows.length)
            return;
        this.activeIndex = Math.max(0, this.rows.findIndex((row) => row.selected));
        this.paint();
        revealDropdownPanel(this.triggerEl, this.menuEl);
        document.addEventListener('keydown', this.onKey, true);
    }

    /** Hide the menu and stop listening for its keys; safe when already closed. @returns {void} */
    close(): void {
        document.removeEventListener('keydown', this.onKey, true);
        if (this.menuEl)
            this.menuEl.hidden = true;
    }

    /** Whether the destination menu is showing. @returns {boolean} */
    isOpen(): boolean {
        return Boolean(this.menuEl && !this.menuEl.hidden);
    }

    /** Rebuild the menu rows. @returns {void} */
    paint(): void {
        // Callers open or refresh an existing menu; a missing element still throws inside fill, as before.
        this.buttons = fillAgentMenu(this.menuEl as HTMLElement, this.rows, {
            onSelect: (row) => this.select(row),
            onSessions: (row) => this.openSessions(row),
        });
        this.paintActive();
    }

    /** Highlight the keyboard row. @returns {void} */
    paintActive(): void {
        this.buttons.forEach((button, index) => {
            button.parentElement?.classList.toggle('cii-agent-row-active', index === this.activeIndex);
        });
    }

    /**
     * While open: ArrowUp/ArrowDown move, Enter chooses, ArrowRight opens sessions; handled keys never reach the editor.
     * @param {KeyboardEvent} event Keydown in the capture phase. @returns {void}
     */
    onMenuKey(event: KeyboardEvent): void {
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

    /** Make `row` the Enter target. @param {AgentMenuRow} row Chosen row. @returns {void} */
    select(row: AgentMenuRow): void {
        this.close();
        this.deps.rememberAgent(row.name);
        this.deps.onPicked?.();
    }

    /** Swap to `row`'s session menu at the same trigger. @param {AgentMenuRow} row Row. @returns {void} */
    openSessions(row: AgentMenuRow): void {
        this.close();
        this.deps.sessions?.openMenu({ name: row.name, label: row.label }, this.triggerEl, () => this.open());
    }

    /** Lock the trigger while the dialog is busy. @param {boolean} disabled Busy state. @returns {void} */
    setDisabled(disabled: boolean): void {
        this.disabled = disabled;
        if (this.triggerEl)
            this.triggerEl.disabled = disabled;
        if (disabled)
            this.close();
    }

    /** Close when a press lands outside the picker. @param {EventTarget | null} target Press target. @returns {void} */
    closeMenuFromOutside(target: EventTarget | null): void {
        // An open menu was rendered, so the wrapper exists; the field stays null only while closed.
        if (this.isOpen() && target instanceof Node && !(this.rootEl as HTMLElement).contains(target))
            this.close();
    }

    /** Escape closes an open menu first. @returns {boolean} True when the menu was closed. */
    consumeEscape(): boolean {
        if (!this.isOpen())
            return false;
        this.close();
        return true;
    }
}
