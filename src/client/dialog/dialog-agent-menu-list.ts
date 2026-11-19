import { el } from './dialog-utils.js';
import { t } from '../lib/i18n.js';
import { splitAgentRows, type AgentMenuRow } from './dialog-agent-model.js';
import { agentIcon, agentRowTitle } from './dialog-agent-menu.js';

/** Row actions forwarded by {@link fillAgentMenu}. All required; none of them changes the menu by itself. */
export interface AgentMenuHooks {
    onSelect: (row: AgentMenuRow) => void;
    onSessions: (row: AgentMenuRow) => void;
    onTogglePin: (row: AgentMenuRow) => void;
    onToggleMore: () => void;
    onDismissTip: () => void;
}

/** Render options: whether "More agents" starts open, and whether the pin tip is still shown. */
export interface AgentMenuView {
    expanded: boolean;
    tip: boolean;
}

/** One keyboard stop: a destination row (`row`) or the "More agents" toggle (`row: null`). */
export interface AgentMenuEntry {
    button: HTMLButtonElement;
    row: AgentMenuRow | null;
    /** True for rows inside the folded section; they are reachable only while it is open. */
    folded: boolean;
}

/** What {@link fillAgentMenu} built. `region`/`inner`/`list`/`toggle` are null for a flat (unfolded) menu. */
export interface AgentMenuParts {
    entries: AgentMenuEntry[];
    region: HTMLElement | null;
    inner: HTMLElement | null;
    list: HTMLElement | null;
    toggle: HTMLButtonElement | null;
}

/** Class on the menu while the folded section is open; the stylesheet animates the region from it. */
export const AGENT_MENU_EXPANDED_CLASS = 'cii-agent-menu-expanded';

/** Shadow-root id of the folded region, so the toggle can name it in `aria-controls`. One menu exists at a time. */
const AGENT_MORE_REGION_ID = 'cii-agent-more-region';

/** Tip template tokens replaced by markup: the pin glyph and the config option name. */
const TIP_TOKEN = /(\{pin\}|\{option\})/;

/** Option name shown in the tip. Not translated: it is the literal plugin option. */
const PINNED_OPTION_NAME = 'pinnedAgents';

/**
 * Keep the intent editor's focus and caret while a menu control is pressed.
 * @param {Event} event `mousedown` on a menu control. @returns {void}
 */
function keepFocus(event: Event): void {
    event.preventDefault();
}

/**
 * Small menu button that keeps editor focus and never lets its click reach the menu's outside-press handling.
 *
 * @param {string} className Button class. @param {string} label Accessible name (and tooltip when `title` is true).
 * @param {() => void} onClick Click action. @param {boolean} [title] Also show `label` as a native tooltip.
 * @returns {HTMLButtonElement} Button, not yet attached.
 */
function menuButton(className: string, label: string, onClick: () => void, title = true): HTMLButtonElement {
    const button: HTMLButtonElement = el('button', className);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    if (title)
        button.title = label;
    button.addEventListener('mousedown', keepFocus);
    button.addEventListener('click', (event) => {
        event.stopPropagation();
        onClick();
    });
    return button;
}

/**
 * One destination row: icon, label (with "(unavailable)" on the same line, so every row has one height), stored
 * session subtitle, Enter-target check, a pin button (shown on hover / keyboard highlight) and, for agents that list
 * sessions, the trailing sessions button.
 *
 * @param {AgentMenuRow} row Row from `agentMenuRows`. @param {AgentMenuHooks} hooks Row actions.
 * @returns {{ item: HTMLElement, main: HTMLButtonElement }} Row element and its main (choose) button.
 */
function agentRowEl(row: AgentMenuRow, hooks: AgentMenuHooks): { item: HTMLElement; main: HTMLButtonElement } {
    const item: HTMLElement = el('div', 'cii-agent-row');
    item.classList.toggle('cii-agent-row-selected', row.selected);
    item.classList.toggle('cii-agent-row-unavailable', row.unavailable);
    item.classList.toggle('cii-agent-row-pinned', row.pinned);
    const main: HTMLButtonElement = el('button', 'cii-agent-row-main');
    main.type = 'button';
    main.title = agentRowTitle(row);
    main.setAttribute('role', 'menuitemradio');
    main.setAttribute('aria-checked', row.selected ? 'true' : 'false');
    const text: HTMLElement = el('span', 'cii-agent-row-text');
    const label: HTMLElement = el('span', 'cii-agent-row-label', row.label);
    if (row.unavailable)
        label.append(el('span', 'cii-agent-row-state', t('agent.menu.unavailable')));
    text.append(label);
    if (row.target)
        text.append(el('span', 'cii-agent-row-sub cii-agent-row-session', row.target.title || t('session.untitled')));
    main.append(agentIcon(row.kind, row.name), text, el('span', 'cii-agent-row-check'));
    main.addEventListener('mousedown', keepFocus);
    main.addEventListener('click', (event) => {
        event.stopPropagation();
        hooks.onSelect(row);
    });
    const pin = menuButton('cii-agent-row-pin', t(row.pinned ? 'agent.menu.unpin' : 'agent.menu.pin'), () => hooks.onTogglePin(row));
    pin.setAttribute('aria-pressed', row.pinned ? 'true' : 'false');
    item.append(main, pin);
    if (row.sessions)
        item.append(menuButton('cii-agent-row-sessions', t('agent.menu.sessions'), () => hooks.onSessions(row)));
    return { item, main };
}

/**
 * The single-line "More agents" toggle: caret, a label that never changes (so nothing reflows when it opens), count.
 *
 * @param {number} count Folded rows. @param {boolean} expanded Initial state. @param {() => void} onToggle Click action.
 * @returns {{ item: HTMLElement, button: HTMLButtonElement }} Row element and its button.
 */
function moreToggleEl(count: number, expanded: boolean, onToggle: () => void): { item: HTMLElement; button: HTMLButtonElement } {
    const item: HTMLElement = el('div', 'cii-agent-row cii-agent-more');
    const button = menuButton('cii-agent-row-main', t('agent.menu.more'), onToggle, false);
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.setAttribute('aria-controls', AGENT_MORE_REGION_ID);
    const text: HTMLElement = el('span', 'cii-agent-row-text');
    text.append(el('span', 'cii-agent-row-label', t('agent.menu.more')));
    button.append(el('span', 'cii-agent-more-caret'), text, el('span', 'cii-agent-more-count', String(count)));
    item.append(button);
    return { item, button };
}

/**
 * The dismissible one-line tip: how to pin, and the option that sets the default.
 *
 * Boundary: the template comes from i18n with `{pin}` / `{option}` tokens; text pieces go through text nodes, the
 * tokens become a glyph and a `<code>` element, so no translated string is parsed as markup.
 *
 * @param {() => void} onDismiss Close action. @returns {HTMLElement} Tip element.
 */
function pinTipEl(onDismiss: () => void): HTMLElement {
    const tip: HTMLElement = el('div', 'cii-agent-tip');
    const text: HTMLElement = el('span', 'cii-agent-tip-text');
    for (const part of t('agent.menu.pinTip').split(TIP_TOKEN)) {
        if (part === '{pin}') {
            const glyph: HTMLElement = el('i', 'cii-agent-tip-pin');
            glyph.setAttribute('aria-hidden', 'true');
            text.append(glyph);
        }
        else if (part === '{option}')
            text.append(el('code', '', PINNED_OPTION_NAME));
        else if (part)
            text.append(document.createTextNode(part));
    }
    tip.append(text, menuButton('cii-agent-tip-close', t('agent.menu.pinTipClose'), onDismiss));
    return tip;
}

/**
 * Open or close the folded section in place, without rebuilding the menu, so the stylesheet's height transition plays.
 *
 * Boundary: no-op for a flat menu. A closed region is `inert`, so its rows cannot be tabbed to while invisible.
 *
 * @param {HTMLElement} menuEl Menu container. @param {AgentMenuParts} parts From {@link fillAgentMenu}.
 * @param {boolean} expanded New state. @returns {void}
 */
export function setAgentMenuExpanded(menuEl: HTMLElement, parts: AgentMenuParts, expanded: boolean): void {
    if (!parts.region || !parts.toggle)
        return;
    menuEl.classList.toggle(AGENT_MENU_EXPANDED_CLASS, expanded);
    parts.region.inert = !expanded;
    parts.toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

/**
 * fillAgentMenu(menuEl, rows, hooks, view): render the destination menu ("Send to") into an existing element.
 *
 * Purpose: pinned rows first; every other row folds into a region under a "More agents" toggle that sits below it (the
 * stylesheet moves the region under the toggle when the menu opens downward, so the toggle stays under the pointer);
 * then the pin tip. With nothing pinned or nothing left to fold, one flat list is shown instead, still with pin buttons.
 * Boundary: only builds DOM and forwards clicks; it never changes the Enter target, the pins, or the open state
 * itself. Replaces all previous children. Rebuilding always renders the final open state, so call
 * {@link setAgentMenuExpanded} rather than this to animate a toggle.
 *
 * @param {HTMLElement} menuEl Menu container, already in the dialog.
 * @param {AgentMenuRow[]} rows Rows from `agentMenuRows`, in catalog order.
 * @param {AgentMenuHooks} hooks Row actions.
 * @param {AgentMenuView} view Whether the folded section is open and whether the tip is shown.
 * @returns {AgentMenuParts} Keyboard stops in DOM order (pinned, folded, toggle) and the folding nodes.
 */
export function fillAgentMenu(menuEl: HTMLElement, rows: AgentMenuRow[], hooks: AgentMenuHooks, view: AgentMenuView): AgentMenuParts {
    const { pinned, more } = splitAgentRows(rows);
    const folding = pinned.length > 0 && more.length > 0;
    const entries: AgentMenuEntry[] = [];
    menuEl.replaceChildren(el('div', 'cii-menu-caption', t('agent.menu.title')));
    menuEl.classList.remove(AGENT_MENU_EXPANDED_CLASS);
    const addRows = (list: AgentMenuRow[], parent: HTMLElement, folded: boolean) => list.forEach((row) => {
        const { item, main } = agentRowEl(row, hooks);
        parent.append(item);
        entries.push({ button: main, row, folded });
    });
    if (!folding) {
        addRows(rows, menuEl, false);
        if (view.tip)
            menuEl.append(pinTipEl(hooks.onDismissTip));
        return { entries, region: null, inner: null, list: null, toggle: null };
    }
    addRows(pinned, menuEl, false);
    const region: HTMLElement = el('div', 'cii-agent-more-region');
    region.id = AGENT_MORE_REGION_ID;
    const inner: HTMLElement = el('div', 'cii-agent-more-inner');
    const list: HTMLElement = el('div', 'cii-agent-more-list');
    addRows(more, list, true);
    inner.append(el('div', 'cii-menu-sep'), list);
    region.append(inner);
    const toggle = moreToggleEl(more.length, view.expanded, hooks.onToggleMore);
    entries.push({ button: toggle.button, row: null, folded: false });
    menuEl.append(region, el('div', 'cii-menu-sep'), toggle.item);
    if (view.tip)
        menuEl.append(pinTipEl(hooks.onDismissTip));
    const parts = { entries, region, inner, list, toggle: toggle.button };
    setAgentMenuExpanded(menuEl, parts, view.expanded);
    return parts;
}
