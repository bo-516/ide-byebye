/** Mouse / trackpad hold duration that opens the intent dialog. */
export const LONG_PRESS_DURATION_MS = 4000;
/** Touch / DevTools-mobile hold duration that opens the intent dialog. */
export const LONG_PRESS_DURATION_TOUCH_MS = 1000;
/** Show the inspect overlay before the dialog so a hold is not silent. */
export const LONG_PRESS_HINT_MS = 400;
/** Pointer travel (px) above which a press is treated as a scroll/drag, not a long-press. */
export const LONG_PRESS_MOVE_PX = 16;
/** Swallow the synthesized click/pointerup that follows a successful pick. */
export const PICK_CONSUME_MS = 500;

/**
 * Whether this pointer event should use the short (touch) long-press duration.
 *
 * Purpose: DevTools device mode and real phones fire `pointerType === 'touch'` even on a Mac, so the 1s hold applies
 * when the developer toggles mobile emulation without reloading onto a different OS string.
 * Boundary: only `'touch'` (and TouchEvent-like objects with `touches`) count. Missing `pointerType` is treated as
 * mouse so unit tests and desktop clicks keep the 4s duration. Pen stays on the 4s mouse path.
 *
 * @param {{ pointerType?: string, touches?: unknown, changedTouches?: unknown } | null | undefined} event Pointer or touch event.
 * @returns {boolean} True when the 1s mobile duration should apply.
 */
export function isTouchLikePointer(event) {
    const type = String(event?.pointerType || '').toLowerCase();
    if (type === 'touch')
        return true;
    if (type === 'mouse' || type === 'pen')
        return false;
    return !!(event && (event.touches || event.changedTouches));
}

/**
 * Long-press duration for this pointer event.
 *
 * Purpose: 1s on touch (mobile / device mode), 4s on mouse, so a preview box on a phone is followed quickly by the
 * dialog instead of another three seconds of holding.
 * Boundary: delegates to `isTouchLikePointer`; a missing event is mouse (4s). Callers must pass the original
 * pointerdown — using a later pointerup with a different `pointerType` would pick the wrong timer.
 *
 * @param {{ pointerType?: string, touches?: unknown, changedTouches?: unknown } | null | undefined} event Pointerdown-like event.
 * @returns {number} Duration in milliseconds.
 */
export function longPressDurationMs(event) {
    return isTouchLikePointer(event) ? LONG_PRESS_DURATION_TOUCH_MS : LONG_PRESS_DURATION_MS;
}

/**
 * Whether the pointer left the long-press origin by more than `tolerancePx`.
 *
 * Purpose: cancel the long-press timer on scroll/drag so a flick does not open the dialog.
 * Boundary: uses squared distance (no `Math.hypot`) so it stays cheap on every `pointermove`. A missing coordinate
 * is treated as 0, which can false-cancel if the caller forgot `clientX`/`clientY`; pass the same pair used at
 * pointerdown.
 *
 * @param {number} startX Origin X from pointerdown.
 * @param {number} startY Origin Y from pointerdown.
 * @param {number} x Current X.
 * @param {number} y Current Y.
 * @param {number} [tolerancePx] Max travel in CSS pixels; defaults to `LONG_PRESS_MOVE_PX`.
 * @returns {boolean} True when the pointer has moved far enough to cancel.
 */
export function pointerMovementExceeded(startX, startY, x, y, tolerancePx = LONG_PRESS_MOVE_PX) {
    const dx = x - startX;
    const dy = y - startY;
    return (dx * dx) + (dy * dy) > (tolerancePx * tolerancePx);
}

/**
 * Whether a down/up event is the primary left-button / single-touch press.
 *
 * Purpose: ignore right-click, extra mouse buttons, and non-primary multi-touch so long-press / modifier-pick only
 * follow the same gesture as a normal left click.
 * Boundary: `isPrimary === false` always rejects. `button !== 0` rejects (right/middle). Touch pointer events use
 * `button === 0`; a missing `button` is treated as primary so a TouchEvent-like object can reuse this helper.
 *
 * @param {{ isPrimary?: boolean, button?: number }} event Pointer-like event.
 * @returns {boolean} True when this event should start or finish a pick gesture.
 */
export function isPrimaryPress(event) {
    if (event.isPrimary === false)
        return false;
    if (typeof event.button === 'number' && event.button !== 0)
        return false;
    return true;
}

/**
 * Client coordinates from a pointer, mouse, or touch event.
 *
 * Purpose: `touchend` leaves `clientX` at 0 and stores the point on `changedTouches`; modifier-pick and long-press
 * both need a stable point for dialog anchoring.
 * Boundary: prefers `clientX`/`clientY` when they look real (non-zero, or no touch list). A missing event returns
 * `{x:0,y:0}`, which would pin the dialog to the origin — callers must pass the original browser event.
 *
 * @param {{ clientX?: number, clientY?: number, changedTouches?: Array<{ clientX: number, clientY: number }>, touches?: Array<{ clientX: number, clientY: number }> } | null | undefined} event
 * @returns {{ x: number, y: number }} Viewport point.
 */
export function pointFromEvent(event) {
    const touch = event?.changedTouches?.[0] || event?.touches?.[0];
    const hasClient = event && typeof event.clientX === 'number';
    if (hasClient && (event.clientX !== 0 || event.clientY !== 0 || !touch))
        return { x: event.clientX, y: event.clientY };
    if (touch)
        return { x: touch.clientX, y: touch.clientY };
    return { x: 0, y: 0 };
}
