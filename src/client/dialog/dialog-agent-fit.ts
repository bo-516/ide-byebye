import { type AgentMenuParts } from './dialog-agent-menu-list.js';

/**
 * Keep the destination menu inside the viewport while its folded section opens and closes.
 *
 * Boundary: `revealDropdownPanel` picks the side (up or down) and clamps the menu only for the height it has at open.
 * Opening "More agents" later would grow past that, so this caps the folded list to whatever room is left on the
 * chosen side; pinned rows, the toggle, and the tip never scroll. Only when even the shortest list cannot fit does the
 * whole menu scroll, as before.
 */

/** Tallest the folded list grows before it scrolls: eight 34px rows plus slack. */
export const AGENT_MORE_LIST_MAX = 288;

/** Shortest the list is squeezed to (three rows) before the whole menu scrolls instead. */
export const AGENT_MORE_LIST_MIN = 104;

/** Custom property the stylesheet reads as the folded list's `max-height`. */
export const AGENT_MORE_MAX_VAR = '--cii-agent-more-max';

/** Class on the menu when it opened below its trigger; the stylesheet then moves the folded region under the toggle. */
export const AGENT_MENU_DOWN_CLASS = 'cii-agent-menu-down';

/** Trigger-to-menu gap and viewport margin, px. Must match `placeDropdownPanel`'s defaults. */
const MENU_GAP = 8;
const MENU_MARGIN = 8;

/**
 * agentMoreListMax(room, fixed): how tall the folded list may be.
 *
 * @param {number} room Height available to the whole menu on its side of the trigger, px.
 * @param {number} fixed Height of everything except the list (rows, toggle, tip, separators, padding), px.
 * @returns {{ list: number, menuScroll: boolean }} List cap within {@link AGENT_MORE_LIST_MIN}..{@link
 * AGENT_MORE_LIST_MAX}; `menuScroll` is true when the menu must also be clamped to `room` and scroll.
 */
export function agentMoreListMax(room: number, fixed: number): { list: number; menuScroll: boolean } {
    const fit = Math.floor(room - fixed);
    return { list: Math.max(AGENT_MORE_LIST_MIN, Math.min(AGENT_MORE_LIST_MAX, fit)), menuScroll: fit < AGENT_MORE_LIST_MIN };
}

/**
 * fitAgentMenu(trigger, menu, parts): size an open, already placed destination menu to the viewport.
 *
 * Purpose: reads which side `placeDropdownPanel` chose (it pins `bottom: auto` when opening down), measures the room on
 * that side, and caps the folded list so the fully open menu still fits. A flat menu is clamped as a whole.
 * Boundary: call after the menu is placed and painted with final content (open, repaint, resize); measuring during a
 * height transition still works because the region's full height is read from its content, not its current size.
 *
 * @param {HTMLElement} trigger Picker trigger the menu anchors to.
 * @param {HTMLElement} menu Open menu element.
 * @param {AgentMenuParts} parts Nodes from `fillAgentMenu`; null folding nodes mean a flat menu.
 * @returns {void}
 */
export function fitAgentMenu(trigger: HTMLElement, menu: HTMLElement, parts: AgentMenuParts): void {
    const anchor = trigger.getBoundingClientRect();
    const openDown = menu.style.bottom === 'auto';
    const room = (openDown ? window.innerHeight - anchor.bottom : anchor.top) - MENU_MARGIN - MENU_GAP;
    menu.classList.toggle(AGENT_MENU_DOWN_CLASS, openDown);
    menu.style.maxHeight = '';
    menu.style.overflowY = '';
    const menuScroll = parts.region && parts.inner && parts.list
        ? capMoreList(menu, room, parts.region, parts.inner, parts.list)
        : menu.offsetHeight > room;
    if (menuScroll) {
        menu.style.maxHeight = `${Math.max(0, Math.floor(room))}px`;
        menu.style.overflowY = 'auto';
    }
}

/**
 * Write the folded list's cap for a menu with `room` px available.
 *
 * Boundary: the region's full height (separator + list) is read from its content, so a closed or animating region still
 * measures; the menu's own `max-height` must already be cleared.
 *
 * @param {HTMLElement} menu Open menu. @param {number} room Height available on its side, px.
 * @param {HTMLElement} region Folded region. @param {HTMLElement} inner Region content box. @param {HTMLElement} list
 * Scrollable list. @returns {boolean} True when even the shortest list does not fit, so the menu must scroll too.
 */
function capMoreList(menu: HTMLElement, room: number, region: HTMLElement, inner: HTMLElement, list: HTMLElement): boolean {
    const fixed = menu.offsetHeight - region.offsetHeight + (inner.scrollHeight - list.offsetHeight);
    const fit = agentMoreListMax(room, fixed);
    menu.style.setProperty(AGENT_MORE_MAX_VAR, `${fit.list}px`);
    return fit.menuScroll;
}
