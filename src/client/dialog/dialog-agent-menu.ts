import { el } from './dialog-utils.js';
import { t } from '../lib/i18n.js';

/**
 * Tooltip for one destination: why it cannot take a prompt right now, else what sending to it does.
 *
 * @param {{ label: string, title: string, configured: boolean, unavailable: boolean, reason: string }} row Row from
 * `agentMenuRows`.
 * @returns {string} Localized tooltip; the server's own reason wins over generic "unavailable" copy.
 */
export function agentRowTitle(row) {
    if (!row.configured)
        return t('agent.notEnabledInConfig', { label: row.label });
    if (row.unavailable)
        return row.reason || t('agent.currentlyUnavailable', { label: row.label });
    return row.title;
}

/**
 * Icon slot for a destination kind (`app`, `ide`, `terminal`, `custom`); the glyph itself is drawn by CSS.
 *
 * @param {string} kind Destination kind; an unknown kind renders an empty slot of the same size.
 * @returns {HTMLElement} Icon span.
 */
export function agentKindIcon(kind) {
    const icon = el('span', 'cii-agent-kind');
    icon.dataset.kind = kind;
    return icon;
}

/**
 * createAgentPickerDom(onToggle): build the picker wrapper — its trigger (kind icon, label, stored session, caret) and
 * the hidden "Send to" menu.
 *
 * Boundary: the trigger swallows `mousedown` so the intent editor keeps focus and caret, and only calls `onToggle` on
 * click; the caller decides what opening means. Nothing is painted with data yet — see {@link paintAgentTrigger}.
 *
 * @param {() => void} onToggle Required click handler for the trigger.
 * @returns {{ root: HTMLElement, trigger: HTMLButtonElement, kind: HTMLElement, label: HTMLElement,
 * session: HTMLElement, menu: HTMLElement }} Picker nodes; `menu` starts hidden.
 */
export function createAgentPickerDom(onToggle) {
    const root = el('div', 'cii-screenshot-picker cii-agent-picker');
    const trigger = el('button', 'cii-agent-pill');
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'menu');
    const kind = agentKindIcon('app');
    const label = el('span', 'cii-agent-pill-label');
    const session = el('span', 'cii-agent-pill-session');
    trigger.append(kind, label, session, el('span', 'cii-agent-pill-caret'));
    trigger.addEventListener('mousedown', (event) => event.preventDefault());
    trigger.addEventListener('click', (event) => {
        event.stopPropagation();
        onToggle();
    });
    const menu = el('div', 'cii-screenshot-menu cii-agent-menu');
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    root.append(trigger, menu);
    return { root, trigger, kind, label, session, menu };
}

/**
 * paintAgentTrigger(dom, row, fallbackLabel): show the current destination on the trigger.
 *
 * Boundary: a null `row` (the Enter target is not offered, e.g. disabled in config) shows `fallbackLabel` with the
 * generic app icon. A stored session is appended as `/ title`. An unavailable target dims the trigger and uses its
 * reason as the tooltip; otherwise the tooltip names the control.
 *
 * @param {{ trigger: HTMLElement, kind: HTMLElement, label: HTMLElement, session: HTMLElement }} dom Nodes from
 * {@link createAgentPickerDom}.
 * @param {Record<string, any> | null} row Current row from `agentMenuRows`.
 * @param {string} fallbackLabel Label to show without a row.
 * @returns {void}
 */
export function paintAgentTrigger(dom, row, fallbackLabel) {
    dom.kind.dataset.kind = row?.kind ?? 'app';
    dom.label.textContent = row?.label ?? fallbackLabel;
    dom.session.textContent = row?.target ? (row.target.title || t('session.untitled')) : '';
    dom.session.hidden = !row?.target;
    dom.trigger.classList.toggle('cii-agent-pill-unavailable', row?.unavailable === true);
    dom.trigger.dataset.ciiTip = row?.unavailable ? agentRowTitle(row) : t('agent.menu.choose');
}

/**
 * fillAgentMenu(menuEl, rows, hooks): render the destination menu ("Send to") into an existing element.
 *
 * Purpose: one row per destination with its kind icon, label, a subtitle (the stored session, or "unavailable"), a
 * check on the Enter target, and — for agents that list sessions — a trailing button that opens the session menu.
 * Boundary: only builds DOM and forwards clicks; it never changes the Enter target itself. Row buttons swallow
 * `mousedown` so the intent editor keeps focus and caret while the user picks. Replaces all previous children.
 *
 * @param {HTMLElement} menuEl Menu container, already in the dialog.
 * @param {Array<Record<string, any>>} rows Rows from `agentMenuRows`, in display order.
 * @param {{ onSelect: (row: object) => void, onSessions: (row: object) => void }} hooks Row actions; both required.
 * @returns {HTMLButtonElement[]} The main button of each row, in keyboard order.
 */
export function fillAgentMenu(menuEl, rows, hooks) {
    menuEl.replaceChildren(el('div', 'cii-menu-caption', t('agent.menu.title')));
    const keepFocus = (event) => event.preventDefault();
    return rows.map((row) => {
        const item = el('div', 'cii-agent-row');
        item.classList.toggle('cii-agent-row-selected', row.selected);
        item.classList.toggle('cii-agent-row-unavailable', row.unavailable);
        const main = el('button', 'cii-agent-row-main');
        main.type = 'button';
        main.title = agentRowTitle(row);
        main.setAttribute('role', 'menuitemradio');
        main.setAttribute('aria-checked', row.selected ? 'true' : 'false');
        const text = el('span', 'cii-agent-row-text');
        text.append(el('span', 'cii-agent-row-label', row.label));
        if (row.target)
            text.append(el('span', 'cii-agent-row-sub cii-agent-row-session', row.target.title || t('session.untitled')));
        else if (row.unavailable)
            text.append(el('span', 'cii-agent-row-sub', t('agent.menu.unavailable')));
        main.append(agentKindIcon(row.kind), text, el('span', 'cii-agent-row-check'));
        main.addEventListener('mousedown', keepFocus);
        main.addEventListener('click', (event) => {
            event.stopPropagation();
            hooks.onSelect(row);
        });
        item.append(main);
        if (row.sessions) {
            const more = el('button', 'cii-agent-row-sessions');
            more.type = 'button';
            more.title = t('agent.menu.sessions');
            more.setAttribute('aria-label', t('agent.menu.sessions'));
            more.addEventListener('mousedown', keepFocus);
            more.addEventListener('click', (event) => {
                event.stopPropagation();
                hooks.onSessions(row);
            });
            item.append(more);
        }
        menuEl.append(item);
        return main;
    });
}
