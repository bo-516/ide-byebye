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

/** One finger's viewport point on a touch list. A missing list means "not a touch event". */
interface TouchPoint {
    clientX: number;
    clientY: number;
}

/**
 * Pointer, mouse, or touch event the pure helpers read. Every field is optional because `touchend`, compat
 * `mouseup`, and unit-test fixtures each omit a different subset; a missing event is "not a touch / not primary".
 */
interface GestureProbe {
    pointerType?: string;
    pointerId?: number;
    button?: number;
    isPrimary?: boolean;
    clientX?: number;
    clientY?: number;
    target?: unknown;
    touches?: ArrayLike<TouchPoint> | null;
    changedTouches?: ArrayLike<TouchPoint> | null;
}

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
export function isTouchLikePointer(event: GestureProbe | null | undefined): boolean {
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
export function longPressDurationMs(event: GestureProbe | null | undefined): number {
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
export function pointerMovementExceeded(startX: number, startY: number, x: number, y: number, tolerancePx = LONG_PRESS_MOVE_PX): boolean {
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
export function isPrimaryPress(event: Pick<GestureProbe, 'isPrimary' | 'button'>): boolean {
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
export function pointFromEvent(event: GestureProbe | null | undefined): { x: number; y: number } {
    const touch = event?.changedTouches?.[0] || event?.touches?.[0];
    const hasClient = event && typeof event.clientX === 'number';
    if (hasClient && (event.clientX !== 0 || event.clientY !== 0 || !touch))
        // Assertions erase. `hasClient` is a boolean, so it does not narrow these fields; a missing coordinate stays missing.
        return { x: event.clientX as number, y: event.clientY as number };
    if (touch)
        return { x: touch.clientX, y: touch.clientY };
    return { x: 0, y: 0 };
}

/**
 * Whether `event` belongs to the in-flight press snapshot.
 *
 * Purpose: pointerdown records a `pointerId`; later mouseup/touchend often omit it, while a second finger has a
 * different id. Matching has to accept a missing id without treating a different pointer as the same press.
 * Boundary: no press is never a match. If either side lacks a numeric `pointerId`, this is treated as the same
 * (single-pointer) press — callers that already filtered `isPrimaryPress` rely on that. Two numeric ids must be equal.
 *
 * @param {{ pointerId?: number } | null | undefined} press Active press snapshot from pointerdown.
 * @param {{ pointerId?: number } | null | undefined} event Later pointer/mouse/touch event.
 * @returns {boolean} True when `event` should finish or update `press`.
 */
export function isMatchingPress(press: Pick<GestureProbe, 'pointerId'> | null | undefined, event: Pick<GestureProbe, 'pointerId'> | null | undefined): boolean {
    if (!press)
        return false;
    if (typeof press.pointerId !== 'number' || typeof event?.pointerId !== 'number')
        return true;
    return press.pointerId === event.pointerId;
}

/**
 * Element to inspect when a modifier pick or long-press finishes.
 *
 * Purpose: `Element.setPointerCapture` retargets later pointer events to the capturing node. Capturing on
 * `document.documentElement` makes `pointerup.target` the `<html>` root, so ⌘-click highlights the whole page
 * (yellow no-mapping overlay) and never opens the dialog. The pointerdown target stored on `press` is the real hit.
 * Boundary: a matching press with a `target` always wins. Otherwise this returns `event.target` (`click` without a
 * prior pointerdown, or an unmatched pointer). A missing event yields `undefined`.
 *
 * @param {{ pointerId?: number, target?: unknown } | null | undefined} press Active press snapshot.
 * @param {{ pointerId?: number, target?: unknown } | null | undefined} event Pointerup/click-like event.
 * @returns {unknown} Hit target for `selectTarget`. Left unknown so DOM nodes and test doubles both pass through;
 *   a missing event yields `undefined`.
 */
export function resolvePickTarget(press: Pick<GestureProbe, 'pointerId' | 'target'> | null | undefined, event: Pick<GestureProbe, 'pointerId' | 'target'> | null | undefined): unknown {
    // `isMatchingPress` does not narrow `press`. `!` erases; a null press already returned false above and is not read.
    if (isMatchingPress(press, event) && press!.target != null)
        return press!.target;
    return event?.target;
}

/** Picker calls the state machine makes. `selectTarget` returns false when the dialog must stay closed. */
export interface GesturePicker {
    isActive(): boolean;
    dialog: { isOpen(): boolean };
    previewTarget(target: unknown): void;
    hidePreview(): void;
    selectTarget(target: unknown, point: { x: number; y: number }): boolean;
}

/**
 * `documentElement` or a test double. Only identity and `style` are used; a missing `style` skips the callout block.
 * `setPointerCapture` is unused here — capture stays on the press target — but a root double that only implements
 * capture would otherwise fail the weak-type check (every member of this shape is optional).
 */
export interface GestureRoot {
    style?: {
        setProperty(property: string, value: string): void;
        removeProperty(property: string): void;
    };
    setPointerCapture?(pointerId: number): void;
}

/** Node that may own pointer capture. Test doubles implement these; DOM nodes do too. */
export interface PointerCapturer {
    setPointerCapture?(pointerId: number): void;
    releasePointerCapture?(pointerId: number): void;
    hasPointerCapture?(pointerId: number): boolean;
}

/** Keyboard or pointer event reduced to the modifier bits the gesture controller reads. */
export interface ModifierGestureEvent {
    pointerType?: string;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
}

/**
 * Pointer/mouse/touch/click event the controller handles.
 * `addEventListener` on `EventTarget` types the argument as `Event`, so install sites cast; these fields are what the
 * machine actually reads. A missing `clientX` cannot be passed — movement checks subtract coordinates.
 */
export interface PointerGestureEvent extends ModifierGestureEvent {
    pointerId?: number;
    button?: number;
    isPrimary?: boolean;
    clientX: number;
    clientY: number;
    target: unknown;
    touches?: ArrayLike<{ clientX: number; clientY: number }> | null;
    changedTouches?: ArrayLike<{ clientX: number; clientY: number }> | null;
    preventDefault(): void;
    stopPropagation(): void;
    stopImmediatePropagation(): void;
}

/** In-flight press. `timer` is whatever `schedule` returned (`Timeout` in production, a number in tests). */
export interface PressSnapshot<Timer> {
    pointerId?: number;
    x: number;
    y: number;
    target: unknown;
    timer: Timer;
    hintTimer: Timer;
}
