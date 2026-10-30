import { isPluginNode } from '../inspect/dom.js';
import {
    applyKeyboardModifierEvent,
    emptyHeldModifiers,
    hasLiveModifierFlags,
    matchesClickModifier,
    mergeModifierFlags,
} from './click-modifier.js';
import {
    LONG_PRESS_HINT_MS,
    PICK_CONSUME_MS,
    isMatchingPress,
    isPrimaryPress,
    longPressDurationMs,
    pointerMovementExceeded,
    pointFromEvent,
    resolvePickTarget,
    type GesturePicker,
    type GestureRoot,
    type ModifierGestureEvent,
    type PointerCapturer,
    type PointerGestureEvent,
    type PressSnapshot,
} from './pick-gesture-utils.js';

export {
    LONG_PRESS_DURATION_MS,
    LONG_PRESS_DURATION_TOUCH_MS,
    LONG_PRESS_HINT_MS,
    LONG_PRESS_MOVE_PX,
    PICK_CONSUME_MS,
    isMatchingPress,
    isPrimaryPress,
    isTouchLikePointer,
    longPressDurationMs,
    pointerMovementExceeded,
    pointFromEvent,
    resolvePickTarget,
} from './pick-gesture-utils.js';

/**
 * Create the pick-gesture state machine (modifier+pointer, and long-press when enabled).
 *
 * Purpose: Chrome device mode turns clicks into touch and drops `metaKey` on the synthesized event; this controller
 * tracks Command/Ctrl from keydown and treats `pointerup`/`click` as the same pick. Real mouse / pen events resync
 * that tracker from their own flags, so a keyup the page never saw cannot leave ⌘ stuck and make plain clicks pick.
 * With `longPress`, a stationary press opens the dialog with no modifier: 1s on touch (mobile / device mode), 4s on
 * mouse. The finger (or button) is usually still down when the dialog opens; its release is swallowed however late it
 * comes, because a `touchend` that reached the page would end the page's own gesture and its compat mouse events /
 * click would land on whatever is under the finger.
 * Boundary: does not attach listeners (see `installPickGestures`). `picker.selectTarget` is the only way it opens the
 * dialog — if that returns false (plugin UI, picker already active, dialog open), the gesture is a no-op. Timers come
 * from `schedule`/`cancelSchedule` so tests can fire the hold path without waiting. Without `longPress` only a press
 * that starts with the modifier held is tracked: a plain press gets no pointer capture, no `user-select` lock and no
 * swallowed `contextmenu` / `selectstart`, so page long-press menus and text selection keep working. Omitting
 * `matchModifier` disables ⌘/Ctrl picking. Pointer capture, when used, is taken on the press target — never on
 * `document.documentElement` — and `pointerup` inspects `press.target` because capture retargets `event.target`.
 *
 * @param {{ picker: { isActive: () => boolean, dialog: { isOpen: () => boolean }, previewTarget: Function, hidePreview: Function, selectTarget: Function }, matchModifier: string | null, longPress?: boolean, schedule?: Function, cancelSchedule?: Function, now?: () => number, root?: HTMLElement | null }} options
 * @returns {{ onKeyDown: Function, onKeyUp: Function, onPointerDown: Function, onPointerMove: Function, onPointerUp: Function, onPointerCancel: Function, onClick: Function, onContextMenu: Function, onSelectStart: Function, onScroll: Function, onBlur: Function, dispose: Function }}
 */
export function createPickGestureController<Timer = ReturnType<typeof setTimeout>>(options: {
    picker: GesturePicker;
    /** Omitted is the same as null: modifier-picking stays off. */
    matchModifier?: string | null;
    /** `true` picks on a stationary hold. Omitted or `false` tracks modifier presses only. */
    longPress?: boolean;
    schedule?: (callback: () => void, delayMs: number) => Timer;
    cancelSchedule?: (timer: Timer) => void;
    now?: () => number;
    root?: GestureRoot | null;
}) {
    const picker = options.picker;
    const matchModifier = options.matchModifier ?? null;
    const longPress = options.longPress === true;
    // Casts erase. Tests supply numeric ids; production uses Node/DOM `setTimeout`, which is not a `number`.
    const schedule = options.schedule || (setTimeout as unknown as (callback: () => void, delayMs: number) => Timer);
    const cancelSchedule = options.cancelSchedule || (clearTimeout as unknown as (timer: Timer) => void);
    const now = options.now || Date.now;
    const held = emptyHeldModifiers();
    const root = options.root || (typeof document !== 'undefined' ? document.documentElement : null);
    let press: PressSnapshot<Timer> | null = null;
    let captureEl: PointerCapturer | null = null;
    let capturePointerId: number | null = null;
    let lastPickAt = Number.NEGATIVE_INFINITY;
    // The long-press that picked, while its pointer is still down. Null once released, or when a new press shows the
    // release was missed.
    let heldPick: Pick<PressSnapshot<Timer>, 'pointerId'> | null = null;

    // Mouse / pen flags are the live OS state: resync first, or a Command/Ctrl keyup swallowed outside the page without
    // a window blur (system shortcut, input-source switch, screenshot tool) keeps every later plain click a pick.
    // Touch-synthesized events keep the OR fallback because device mode clears their bits.
    const flagsFrom = (event: ModifierGestureEvent) => {
        if (hasLiveModifierFlags(event))
            applyKeyboardModifierEvent(held, event);
        return mergeModifierFlags(event, held);
    };

    const modifierHeld = (event: ModifierGestureEvent) => matchModifier != null && matchesClickModifier(flagsFrom(event), matchModifier);

    const busy = () => picker.isActive() || picker.dialog.isOpen();

    const recentlyPicked = () => (now() - lastPickAt) < PICK_CONSUME_MS;

    const swallow = (event: Pick<PointerGestureEvent, 'preventDefault' | 'stopPropagation' | 'stopImmediatePropagation'>) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    };

    const blockNativeCallout = (on: boolean) => {
        if (!root?.style)
            return;
        if (on) {
            root.style.setProperty('-webkit-touch-callout', 'none');
            root.style.setProperty('user-select', 'none');
            root.style.setProperty('-webkit-user-select', 'none');
            return;
        }
        root.style.removeProperty('-webkit-touch-callout');
        root.style.removeProperty('user-select');
        root.style.removeProperty('-webkit-user-select');
    };

    const capturePointer = (event: PointerGestureEvent) => {
        // Capture on the press target so later pointer events keep that node as `event.target`. Never capture on
        // `document.documentElement`: that retargets pointerup/move to `<html>`, and ⌘-click then shows the yellow
        // no-mapping overlay on the page root instead of opening the dialog.
        const el = event.target as PointerCapturer | null;
        if (!el || el === root || typeof event.pointerId !== 'number' || typeof el.setPointerCapture !== 'function')
            return;
        try {
            el.setPointerCapture(event.pointerId);
            captureEl = el;
            capturePointerId = event.pointerId;
        }
        catch {
            captureEl = null;
            capturePointerId = null;
        }
    };

    const releasePointer = () => {
        const el = captureEl;
        const pointerId = capturePointerId;
        captureEl = null;
        capturePointerId = null;
        if (!el || typeof pointerId !== 'number' || typeof el.releasePointerCapture !== 'function')
            return;
        try {
            if (!el.hasPointerCapture || el.hasPointerCapture(pointerId))
                el.releasePointerCapture(pointerId);
        }
        catch {
            // Ignore: capture was never taken or already released.
        }
    };

    const clearPress = () => {
        if (!press && captureEl == null)
            return;
        if (press) {
            if (press.timer != null)
                cancelSchedule(press.timer);
            if (press.hintTimer != null)
                cancelSchedule(press.hintTimer);
            press = null;
        }
        releasePointer();
        blockNativeCallout(false);
    };

    const trySelect = (target: unknown, point: { x: number; y: number }, event: PointerGestureEvent | null) => {
        if (recentlyPicked()) {
            clearPress();
            if (event)
                swallow(event);
            return true;
        }
        if (!picker.selectTarget(target, point))
            return false;
        lastPickAt = now();
        clearPress();
        if (event)
            swallow(event);
        return true;
    };

    // First release event of the held pick (pointerup, or touchend / mouseup when they come first): swallow it and
    // restart the consume window, which then swallows the rest. A cancelled `touchend` also stops the browser from
    // synthesizing compat mouse events and the click.
    const releaseHeldPick = (event: PointerGestureEvent) => {
        if (!heldPick || !isMatchingPress(heldPick, event))
            return false;
        heldPick = null;
        lastPickAt = now();
        clearPress();
        swallow(event);
        return true;
    };

    // The hold that picks and the earlier hint preview. Both re-read `press` when they fire, so a cleared press turns
    // them into no-ops even if a cancel was missed.
    const scheduleHold = (event: PointerGestureEvent): Pick<PressSnapshot<Timer>, 'timer' | 'hintTimer'> => ({
        timer: schedule(() => {
            if (!press)
                return;
            const current = press;
            press = null;
            if (trySelect(current.target, { x: current.x, y: current.y }, null))
                heldPick = { pointerId: current.pointerId };
        }, longPressDurationMs(event)),
        hintTimer: schedule(() => {
            if (!press || busy())
                return;
            picker.previewTarget(press.target);
        }, LONG_PRESS_HINT_MS),
    });

    const startPress = (event: PointerGestureEvent) => {
        if (!isPrimaryPress(event))
            return;
        if (isPluginNode(event.target))
            return;
        if (busy())
            return;
        // Without long-press only a modifier press belongs to the inspector. A plain one keeps its native text
        // selection, callout and context menu, and the page keeps its own pointer capture.
        if (!longPress && !modifierHeld(event))
            return;
        clearPress();
        const point = pointFromEvent(event);
        const target = event.target;
        blockNativeCallout(true);
        capturePointer(event);
        const timers = longPress ? scheduleHold(event) : { timer: null, hintTimer: null };
        press = { pointerId: event.pointerId, x: point.x, y: point.y, target, ...timers };
    };

    return {
        onKeyDown(event: ModifierGestureEvent) {
            applyKeyboardModifierEvent(held, event);
        },
        onKeyUp(event: ModifierGestureEvent) {
            applyKeyboardModifierEvent(held, event);
            if (matchModifier && !matchesClickModifier(flagsFrom(event), matchModifier) && !press)
                picker.hidePreview();
        },
        onPointerDown(event: PointerGestureEvent) {
            // Only one primary pointer is down at a time, so a new primary press means the held pick's release was
            // missed (e.g. a page capture listener stopped it). Keeping it would swallow this press's touchend.
            if (isPrimaryPress(event))
                heldPick = null;
            startPress(event);
        },
        onPointerMove(event: PointerGestureEvent) {
            if (isMatchingPress(press, event) &&
                pointerMovementExceeded(press!.x, press!.y, event.clientX, event.clientY)) {
                clearPress();
                if (!modifierHeld(event))
                    picker.hidePreview();
            }
            if (busy())
                return;
            if (matchModifier && modifierHeld(event)) {
                picker.previewTarget(resolvePickTarget(press, event));
                return;
            }
            // Moves over the plugin's own UI leave the highlight alone: touch pick mode paints it from under its glass.
            if (!press && matchModifier && !isPluginNode(event.target))
                picker.hidePreview();
        },
        onPointerUp(event: PointerGestureEvent) {
            if (releaseHeldPick(event))
                return;
            if (recentlyPicked()) {
                swallow(event);
                clearPress();
                return;
            }
            const wasPress = isMatchingPress(press, event);
            const target = resolvePickTarget(press, event);
            // `wasPress` does not narrow `press`. `!` erases; the false branch never reads it.
            const point = wasPress ? { x: press!.x, y: press!.y } : pointFromEvent(event);
            clearPress();
            if (!isPrimaryPress(event) || busy() || isPluginNode(target))
                return;
            if (matchModifier && modifierHeld(event)) {
                trySelect(target, point, event);
                return;
            }
            if (wasPress)
                picker.hidePreview();
        },
        onPointerCancel() {
            // Chrome converts a stationary hold into contextmenu + pointercancel around 500ms.
            // Clearing here would kill the 4s timer right as the native menu appears. Movement
            // and scroll already call clearPress; a cancel without those is the menu conversion.
        },
        onClick(event: PointerGestureEvent) {
            if (recentlyPicked()) {
                swallow(event);
                return;
            }
            if (!matchModifier || busy() || isPluginNode(event.target))
                return;
            if (!isPrimaryPress(event))
                return;
            if (modifierHeld(event))
                trySelect(event.target, pointFromEvent(event), event);
        },
        onContextMenu(event: PointerGestureEvent) {
            // Native ~500ms callouts / trackpad "press and hold for right-click" abort a 4s hold.
            // Swallow while a primary press is in flight; a real right-click (button 2 from the start)
            // never calls startPress, so the page context menu still works.
            if (press || recentlyPicked())
                swallow(event);
        },
        onSelectStart(event: PointerGestureEvent) {
            if (press)
                swallow(event);
        },
        onScroll() {
            if (press) {
                clearPress();
                picker.hidePreview();
            }
        },
        onBlur() {
            held.alt = false;
            held.ctrl = false;
            held.meta = false;
            held.shift = false;
            heldPick = null;
            clearPress();
            picker.hidePreview();
        },
        dispose() {
            heldPick = null;
            clearPress();
        },
    };
}
