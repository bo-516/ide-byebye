import { agentLabel, revealDropdownPanel, visibleAgentActions } from './dialog-utils.js';
import { agentMenuRows, type AgentMenuRow } from './dialog-agent-model.js';
import { createAgentPickerDom, paintAgentTrigger } from './dialog-agent-menu.js';
import { fillAgentMenu, setAgentMenuExpanded, type AgentMenuEntry, type AgentMenuParts } from './dialog-agent-menu-list.js';
import { AGENT_MENU_DOWN_CLASS, fitAgentMenu } from './dialog-agent-fit.js';
import { dismissPinTip, isPinTipDismissed, loadPinnedAgents, setAgentPinned } from './dialog-agent-pins.js';
import { DialogAgentNotice } from './dialog-agent-notice.js';
import { type DialogSessionController } from './dialog-session-picker.js';

/**
 * Dialog hooks. `sessions` is the session controller when the dialog has one; omitting it hides every session
 * affordance. `config` only needs `enabledAgents` and `pinnedAgents` — the live config object has more keys and still
 * fits; a missing `pinnedAgents` (older server) pins the built-in default. `onLayout` runs when the destination notice
 * shows or hides on an open dialog; omitting it leaves the panel unmeasured after that change.
 */
interface AgentPickerDeps {
    config: () => { enabledAgents?: string[]; pinnedAgents?: unknown };
    sessions?: DialogSessionController | null;
    getLastAgent: () => string;
    rememberAgent: (name: string) => void;
    onPicked?: () => void;
    onLayout?: () => void;
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

/** Empty menu parts, used before the first paint. */
const NO_PARTS: AgentMenuParts = { entries: [], region: null, inner: null, list: null, toggle: null };

/**
 * Destination picker: the compact trigger beside Send that shows where the prompt goes, and the menu that changes it.
 *
 * Boundary: choosing a row only changes the Enter target (`deps.rememberAgent`); sending stays with the dialog, so a
 * rarely-changed destination costs no space. Pinned rows sit on top and the rest fold under "More agents"; pinning and
 * the open state never change the Enter target. The open state is per open: it starts closed unless the Enter target is
 * folded. Rows that list sessions hand off to the session controller's menu, anchored at the same trigger, which can
 * come back here. Keyboard navigation and the resize refit listen only while the menu is open (like the session menu);
 * Escape is left to the dialog through {@link consumeEscape}. One instance lives across dialog opens and `render()`
 * rebuilds its DOM each time; methods called before the first render are no-ops. It also drives the destination
 * notice ({@link DialogAgentNotice}): every repaint syncs it to the Enter target, and choosing a row re-arms it, so
 * picking a destination with a caveat (WorkBuddy) always shows the caveat again.
 */
export class DialogAgentPicker {
    deps: AgentPickerDeps;
    onKey: (event: KeyboardEvent) => void;
    onResize: () => void;
    notice: DialogAgentNotice;
    dom: AgentPickerDom | null = null;
    rootEl: HTMLElement | null = null;
    triggerEl: HTMLButtonElement | null = null;
    menuEl: HTMLElement | null = null;
    rows: AgentMenuRow[] = [];
    parts: AgentMenuParts = NO_PARTS;
    activeIndex = 0;
    availability: PickerAvailability[] = [];
    disabled = false;
    expanded = false;

    /**
     * @param {AgentPickerDeps} deps Dialog hooks; `onPicked` runs after a row is chosen (the dialog returns focus to the
     * editor). Omitting `sessions` hides every session affordance.
     */
    constructor(deps: AgentPickerDeps) {
        this.deps = deps;
        this.onKey = (event: KeyboardEvent) => this.onMenuKey(event);
        this.onResize = () => this.place();
        this.notice = new DialogAgentNotice(() => this.deps.onLayout?.());
    }

    /**
     * Build the destination notice card for a fresh dialog; call before {@link render} so its first repaint fills it.
     * @returns {HTMLElement} Hidden card for the dialog to place above its action bar.
     */
    renderNotice(): HTMLElement {
        return this.notice.render();
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
     * Recompute rows from config, pins, availability, the Enter target, and stored sessions; repaint the trigger (and
     * the menu when open). Safe to call at any time.
     * @returns {void}
     */
    refresh(): void {
        const config = this.deps.config() ?? {};
        const sessions = this.deps.sessions;
        const lastAgent = this.deps.getLastAgent();
        this.rows = agentMenuRows(visibleAgentActions(config), {
            lastAgent,
            enabledAgents: config.enabledAgents,
            pinned: loadPinnedAgents(config.pinnedAgents),
            availability: this.availability,
            targets: sessions?.targets,
            supports: (name: string) => sessions?.supports(name) === true,
        });
        const current = this.current();
        this.notice.sync(current?.name ?? null, current?.unavailable === true);
        if (!this.dom)
            return;
        // render() sets rootEl with dom; this return already handled the pre-render call.
        (this.rootEl as HTMLElement).hidden = this.rows.length === 0;
        paintAgentTrigger(this.dom, this.current(), agentLabel(lastAgent));
        if (this.isOpen()) {
            this.paint();
            this.fit();
        }
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

    /** Show the menu with the Enter target highlighted, folded section open only if that target is in it. @returns {void} */
    open(): void {
        if (!this.menuEl || this.disabled || !this.rows.length)
            return;
        this.expanded = this.current()?.pinned === false;
        this.paint();
        this.place();
        // After placing: the side it opened on decides the keyboard order (see navEntries).
        this.activeIndex = Math.max(0, this.navEntries().findIndex((entry) => entry.row?.selected));
        this.paintActive();
        document.addEventListener('keydown', this.onKey, true);
        window.addEventListener('resize', this.onResize);
    }

    /** Hide the menu and stop listening for its keys and resizes; safe when already closed. @returns {void} */
    close(): void {
        document.removeEventListener('keydown', this.onKey, true);
        window.removeEventListener('resize', this.onResize);
        if (this.menuEl)
            this.menuEl.hidden = true;
    }

    /** Whether the destination menu is showing. @returns {boolean} */
    isOpen(): boolean {
        return Boolean(this.menuEl && !this.menuEl.hidden);
    }

    /** Rebuild the menu rows in the current open state, keeping the keyboard row on the same item. @returns {void} */
    paint(): void {
        const activeName = this.navEntries()[this.activeIndex]?.row?.name;
        // Callers open or refresh an existing menu; a missing element still throws inside fill, as before.
        this.parts = fillAgentMenu(this.menuEl as HTMLElement, this.rows, {
            onSelect: (row) => this.select(row),
            onSessions: (row) => this.openSessions(row),
            onTogglePin: (row) => this.togglePin(row),
            onToggleMore: () => this.setExpanded(!this.expanded),
            onDismissTip: () => this.dismissTip(),
        }, { expanded: this.expanded, tip: !isPinTipDismissed() });
        if (activeName)
            this.activeIndex = Math.max(0, this.navEntries().findIndex((entry) => entry.row?.name === activeName));
        this.paintActive();
    }

    /**
     * Show the menu by its trigger (re-measuring the side and edges), then cap it to the viewport. Used on open and on
     * window resize while open.
     * @returns {void}
     */
    place(): void {
        if (!this.menuEl)
            return;
        revealDropdownPanel(this.triggerEl, this.menuEl);
        this.fit();
    }

    /** Cap the open menu to the room on its side (see `fitAgentMenu`). @returns {void} */
    fit(): void {
        if (this.isOpen() && this.triggerEl && this.menuEl)
            fitAgentMenu(this.triggerEl, this.menuEl, this.parts);
    }

    /**
     * Keyboard stops in visual order: folded rows count only while open, and the toggle sits above them when the menu
     * opened downward (the stylesheet moves the region below it there).
     * @returns {AgentMenuEntry[]} Reachable entries.
     */
    navEntries(): AgentMenuEntry[] {
        const entries = this.parts.entries;
        const folded = this.expanded ? entries.filter((entry) => entry.folded) : [];
        const head = entries.filter((entry) => !entry.folded && entry.row);
        const toggle = entries.filter((entry) => !entry.row);
        const down = this.menuEl?.classList.contains(AGENT_MENU_DOWN_CLASS) === true;
        return down ? [...head, ...toggle, ...folded] : [...head, ...folded, ...toggle];
    }

    /** Highlight the keyboard row and keep it scrolled into the folded list's view. @returns {void} */
    paintActive(): void {
        const active = this.navEntries()[this.activeIndex];
        this.parts.entries.forEach((entry) => {
            entry.button.parentElement?.classList.toggle('cii-agent-row-active', entry === active);
        });
        if (active?.folded)
            active.button.parentElement?.scrollIntoView?.({ block: 'nearest' });
    }

    /**
     * While open: ArrowUp/ArrowDown move, Enter chooses (or opens/closes "More agents" on its toggle), ArrowRight opens
     * sessions; handled keys never reach the editor.
     * @param {KeyboardEvent} event Keydown in the capture phase. @returns {void}
     */
    onMenuKey(event: KeyboardEvent): void {
        const entries = this.navEntries();
        if (!this.isOpen() || !entries.length)
            return;
        const entry = entries[this.activeIndex];
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const step = event.key === 'ArrowDown' ? 1 : -1;
            this.activeIndex = (this.activeIndex + step + entries.length) % entries.length;
            this.paintActive();
        }
        else if (event.key === 'Enter' && entry?.row)
            this.select(entry.row);
        else if (event.key === 'Enter' && entry)
            this.setExpanded(!this.expanded);
        else if (event.key === 'ArrowRight' && entry?.row?.sessions)
            this.openSessions(entry.row);
        else
            return;
        event.preventDefault();
        event.stopPropagation();
    }

    /**
     * Open or close "More agents" in place (animated by the stylesheet), keeping the keyboard row on the same item.
     * @param {boolean} expanded New state. @returns {void}
     */
    setExpanded(expanded: boolean): void {
        const active = this.navEntries()[this.activeIndex];
        this.expanded = expanded;
        setAgentMenuExpanded(this.menuEl as HTMLElement, this.parts, expanded);
        const next = this.navEntries().indexOf(active);
        this.activeIndex = Math.max(0, next);
        this.paintActive();
    }

    /**
     * Pin or unpin `row` and repaint. Unpinning opens "More agents" (animated) so the row stays in sight.
     * @param {AgentMenuRow} row Row whose pin was pressed. @returns {void}
     */
    togglePin(row: AgentMenuRow): void {
        setAgentPinned(row.name, !row.pinned, this.deps.config()?.pinnedAgents);
        const reveal = row.pinned && !this.expanded;
        this.refresh();
        if (!reveal || !this.parts.region)
            return;
        // Commit the closed layout first, or the class flip lands in the same style pass and nothing animates.
        void this.parts.region.offsetHeight;
        this.setExpanded(true);
    }

    /** Hide the pin tip for good and refit the menu. @returns {void} */
    dismissTip(): void {
        dismissPinTip();
        this.refresh();
    }

    /** Make `row` the Enter target and re-show its notice, if any. @param {AgentMenuRow} row Chosen row. @returns {void} */
    select(row: AgentMenuRow): void {
        this.close();
        this.notice.rearm();
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
