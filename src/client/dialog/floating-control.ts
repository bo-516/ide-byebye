/** Pointer travel (px, `|dx| + |dy|`) above which a press on the floating control is a drag, not a tap. */
export const DRAG_THRESHOLD = 4;
/** Floating control diameter (px). Also the minimum touch target. */
export const ORB_SIZE = 44;
/** Gap (px) kept between the floating control and the viewport edges. */
export const ORB_MARGIN = 16;
/** Class on the control while a pointer is down on it (the idle pick button turns opaque). */
export const PRESSED_CLASS = 'cii-pressed';
/** Class on the control while it follows a drag (position transitions are off, so it tracks the pointer). */
export const DRAGGING_CLASS = 'cii-dragging';

/**
 * Top-left corner of the control in viewport px. `side` is set once the pick button has snapped to an edge, so it
 * stays on that edge when the viewport is resized or rotated; the plain orb ignores it.
 */
export interface FloatingPoint {
    x: number;
    y: number;
    side?: 'left' | 'right';
}

/** Viewport size in CSS px (`innerWidth` / `innerHeight`). */
export interface ViewportSize {
    width: number;
    height: number;
}

/**
 * What the floating control is right now.
 * - `'orb'`: the plain pinned-dialog orb (pick button off); a tap resumes the pinned intent.
 * - `'pick'`: the pick button; a tap starts touch pick mode.
 * - `'cancel'`: the pick button while pick mode is on; a tap leaves it.
 * - `'resume'`: the pick button while a dialog is pinned; a tap resumes it, and the button shows a badge.
 */
export type FloatingRole = 'orb' | 'pick' | 'cancel' | 'resume';

/**
 * Decide the floating control's role from the dialog and pick-mode state.
 *
 * Purpose: the pick button and the pin orb are one element, so one rule decides which face it shows.
 * Boundary: with the pick button off the control is exactly the old orb — shown only while a dialog is pinned, and
 * never asked whether the dialog is open (pinning closes it). With the button on, the control hides while the dialog is
 * open and shows otherwise; pick mode wins over a pinned draft, though pick mode cannot start while one is pinned.
 *
 * @param {{ button: boolean, dialogOpen: boolean, pinned: boolean, picking: boolean }} state `button`: the pick button
 *        is shown in this mode / media state. `dialogOpen`: the intent dialog is on screen (or hidden for reference
 *        picking). `pinned`: a dialog is pinned. `picking`: touch pick mode is on.
 * @returns {FloatingRole | null} Role to render, or null to remove the control.
 */
export function floatingRole(state: { button: boolean; dialogOpen: boolean; pinned: boolean; picking: boolean }): FloatingRole | null {
    if (!state.button)
        return state.pinned ? 'orb' : null;
    if (state.dialogOpen)
        return null;
    if (state.picking)
        return 'cancel';
    return state.pinned ? 'resume' : 'pick';
}

/**
 * Read a stored control position.
 *
 * Boundary: storage is page-writable and outlives code changes, so anything but two finite numbers is "no position"
 * (the control then uses its default corner) instead of a `NaN` placement. A `side` other than left / right is dropped.
 *
 * @param {unknown} value Parsed JSON from storage.
 * @returns {FloatingPoint | null} The point, or null.
 */
export function toFloatingPoint(value: unknown): FloatingPoint | null {
    if (!value || typeof value !== 'object')
        return null;
    const { x, y, side } = value as Record<string, unknown>;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y))
        return null;
    return side === 'left' || side === 'right' ? { x, y, side } : { x, y };
}

/**
 * Keep the control fully on screen, defaulting to the bottom-right corner.
 *
 * Boundary: a viewport smaller than the control plus margins pins it to the top-left margin rather than producing a
 * negative coordinate. Values are rounded so inline styles stay whole pixels.
 *
 * @param {FloatingPoint | null} point Wanted top-left, or null for the default corner.
 * @param {ViewportSize} viewport Current viewport.
 * @returns {FloatingPoint} Clamped top-left.
 */
export function clampFloatingPoint(point: FloatingPoint | null, viewport: ViewportSize): FloatingPoint {
    const maxX = Math.max(ORB_MARGIN, viewport.width - ORB_SIZE - ORB_MARGIN);
    const maxY = Math.max(ORB_MARGIN, viewport.height - ORB_SIZE - ORB_MARGIN);
    return {
        x: Math.round(Math.min(Math.max(point?.x ?? maxX, ORB_MARGIN), maxX)),
        y: Math.round(Math.min(Math.max(point?.y ?? maxY, ORB_MARGIN), maxY)),
    };
}

/**
 * Clamp the control and move it to a side edge.
 *
 * Purpose: the pick button rests against a side so it covers as little of the page as possible. A drop picks the
 * nearer side; after that the stored `side` wins, so a resize or a DevTools rotation keeps the button on its edge.
 * Boundary: without a stored side, a control centred exactly on the middle goes right, matching the default corner.
 *
 * @param {FloatingPoint | null} point Wanted top-left (for example the drop point of a drag), or null.
 * @param {ViewportSize} viewport Current viewport.
 * @returns {FloatingPoint} Clamped top-left with x on the left or right margin, and the side it chose.
 */
export function snapFloatingPoint(point: FloatingPoint | null, viewport: ViewportSize): FloatingPoint {
    const clamped = clampFloatingPoint(point, viewport);
    const side = point?.side ?? (clamped.x + (ORB_SIZE / 2) < viewport.width / 2 ? 'left' : 'right');
    const edge = clampFloatingPoint({ x: side === 'left' ? 0 : viewport.width, y: clamped.y }, viewport);
    return { x: edge.x, y: clamped.y, side };
}

/** Element surface {@link bindFloatingDrag} needs. A DOM element satisfies it; tests pass an `EventTarget` stand-in. */
export interface DragSurface extends EventTarget {
    classList: { add(...tokens: string[]): void; remove(...tokens: string[]): void };
    getBoundingClientRect(): { left: number; top: number };
    setPointerCapture?(pointerId: number): void;
}

/**
 * Make the floating control draggable with any pointer, and tell taps apart from drags.
 *
 * Purpose: pointer events cover mouse, pen and touch, so the control drags in DevTools device mode and on phones too
 * (the old mouse-only drag never moved on touch). A press that travels {@link DRAG_THRESHOLD} px is a drag: `move`
 * reports each new top-left and the click that may follow is dropped. Anything shorter is a tap, delivered on `click`
 * so a tap that opens UI (pick mode, the dialog) cannot receive the rest of its own touch sequence.
 * Boundary: the control needs `touch-action: none`, or a touch drag pans the page and ends in `pointercancel`. Only a
 * primary, main-button press drags; `mousedown` is cancelled so the control never takes focus or starts a selection.
 * Pointer capture keeps a fast drag attached; when capture throws, the drag simply ends where the pointer leaves.
 *
 * @param {DragSurface} el The control.
 * @param {{ move: (point: FloatingPoint) => void, end: (dragged: boolean) => void, tap: () => void }} handlers
 *        `move`: unclamped top-left during a drag. `end`: the press finished (`dragged` false for a tap). `tap`: a click
 *        that did not finish a drag, including keyboard activation.
 * @returns {void}
 */
export function bindFloatingDrag(el: DragSurface, handlers: { move(point: FloatingPoint): void; end(dragged: boolean): void; tap(): void }): void {
    const start = { x: 0, y: 0, left: 0, top: 0 };
    let pointerId: number | null = null;
    let moved = 0;
    // Set when the last press became a drag, so the click a mouse drag still fires is not a tap.
    let dragged = false;
    el.addEventListener('pointerdown', (event) => {
        const e = event as PointerEvent;
        if (e.isPrimary === false || e.button !== 0)
            return;
        const rect = el.getBoundingClientRect();
        pointerId = e.pointerId;
        moved = 0;
        dragged = false;
        Object.assign(start, { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top });
        try {
            el.setPointerCapture?.(e.pointerId);
        }
        catch {
            // Capture is a nicety: without it the drag ends when the pointer leaves the control.
        }
        el.classList.add(PRESSED_CLASS);
    });
    el.addEventListener('pointermove', (event) => {
        const e = event as PointerEvent;
        if (e.pointerId !== pointerId)
            return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
        if (moved < DRAG_THRESHOLD)
            return;
        el.classList.add(DRAGGING_CLASS);
        handlers.move({ x: start.left + dx, y: start.top + dy });
    });
    const finish = (event: Event) => {
        if ((event as PointerEvent).pointerId !== pointerId)
            return;
        pointerId = null;
        dragged = moved >= DRAG_THRESHOLD;
        el.classList.remove(PRESSED_CLASS, DRAGGING_CLASS);
        handlers.end(dragged);
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('mousedown', (event) => event.preventDefault());
    el.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (dragged) {
            dragged = false;
            return;
        }
        handlers.tap();
    });
}
