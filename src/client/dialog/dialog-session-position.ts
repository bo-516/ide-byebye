import { placeDropdownPanel } from './dialog-utils.js';

/**
 * Keep the open menu anchored when the dialog moves or its action bar reflows (attachments, narrow widths).
 * Boundary: DOM observation stays here; placement math is shared with the other dropdowns. Frame scheduling lets
 * the dialog's resize handler clamp its own position before the menu is measured. Closed menus are ignored.
 * @param {HTMLElement} dialog Connected dialog that owns the menu; a missing element cannot be observed.
 * @param {() => { anchor: HTMLElement | null, menu: HTMLElement | null }} getOpenMenu Required live state reader;
 *        returning stale nodes would position an old menu. Null nodes are valid while the menu is closed.
 * @returns {() => void} Cleanup the owner must call before detaching or replacing the dialog.
 */
export function observeSessionMenuPosition(dialog, getOpenMenu) {
    let frame = null;
    /** Measure after layout settles; the state reader avoids retaining a previously selected agent's caret. */
    const reposition = () => {
        frame = null;
        const { anchor, menu } = getOpenMenu();
        if (anchor && menu?.isConnected && !menu.hidden)
            placeDropdownPanel(anchor, menu);
    };
    /** Coalesce resize events into one frame; no arguments or return value affect placement. */
    const schedule = () => {
        if (frame === null)
            frame = window.requestAnimationFrame(reposition);
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    observer?.observe(dialog);
    const actionBar = dialog.querySelector('.cii-footer');
    if (actionBar)
        observer?.observe(actionBar);
    window.addEventListener('resize', schedule);
    /** Release observation and queued work; safe to call again after the first cleanup. */
    return () => {
        observer?.disconnect();
        window.removeEventListener('resize', schedule);
        if (frame !== null) {
            window.cancelAnimationFrame(frame);
            frame = null;
        }
    };
}
