import { isPluginNode } from '../inspect/dom.js';
import {
    applyKeyboardModifierEvent,
    emptyHeldModifiers,
    matchingClickModifier,
    matchesClickModifier,
    mergeModifierFlags,
} from './click-modifier.js';
import {
    LONG_PRESS_HINT_MS,
    PICK_CONSUME_MS,
    isPrimaryPress,
    longPressDurationMs,
    pointerMovementExceeded,
    pointFromEvent,
} from './pick-gesture-utils.js';

export {
    LONG_PRESS_DURATION_MS,
    LONG_PRESS_DURATION_TOUCH_MS,
    LONG_PRESS_HINT_MS,
    LONG_PRESS_MOVE_PX,
    PICK_CONSUME_MS,
    isPrimaryPress,
    isTouchLikePointer,
    longPressDurationMs,
    pointerMovementExceeded,
    pointFromEvent,
} from './pick-gesture-utils.js';

/**
 * Create the pick-gesture state machine (modifier+pointer and long-press).
 *
 * Purpose: Chrome device mode turns clicks into touch and drops `metaKey` on the synthesized event; this controller
 * tracks Command/Ctrl from keydown and treats `pointerup`/`click` as the same pick. A stationary press opens the
 * dialog with no modifier: 1s on touch (mobile / device mode), 4s on mouse.
 * Boundary: does not attach listeners (see `installPickGestures`). `picker.selectTarget` is the only way it opens the
 * dialog — if that returns false (plugin UI, picker already active, dialog open), the gesture is a no-op. Timers come
 * from `schedule`/`cancelSchedule` so tests can fire the hold path without waiting. Omitting `matchModifier` disables
 * ⌘/Ctrl picking but long-press stays on.
 *
 * @param {{ picker: { isActive: () => boolean, dialog: { isOpen: () => boolean }, previewTarget: Function, hidePreview: Function, selectTarget: Function }, matchModifier: string | null, schedule?: Function, cancelSchedule?: Function, now?: () => number, root?: HTMLElement | null }} options
 * @returns {{ onKeyDown: Function, onKeyUp: Function, onPointerDown: Function, onPointerMove: Function, onPointerUp: Function, onPointerCancel: Function, onClick: Function, onContextMenu: Function, onSelectStart: Function, onScroll: Function, onBlur: Function, dispose: Function }}
 */
export function createPickGestureController(options) {
    const picker = options.picker;
    const matchModifier = options.matchModifier ?? null;
    const schedule = options.schedule || setTimeout;
    const cancelSchedule = options.cancelSchedule || clearTimeout;
    const now = options.now || Date.now;
    const held = emptyHeldModifiers();
    const root = options.root || (typeof document !== 'undefined' ? document.documentElement : null);
    let press = null;
    let lastPickAt = Number.NEGATIVE_INFINITY;

    const flagsFrom = (event) => mergeModifierFlags(event, held);

    const modifierHeld = (event) => matchModifier != null && matchesClickModifier(flagsFrom(event), matchModifier);

    const busy = () => picker.isActive() || picker.dialog.isOpen();

    const recentlyPicked = () => (now() - lastPickAt) < PICK_CONSUME_MS;

    const swallow = (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    };

    const blockNativeCallout = (on) => {
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

    const capturePointer = (event) => {
        if (!root || typeof event.pointerId !== 'number' || typeof root.setPointerCapture !== 'function')
            return;
        try {
            root.setPointerCapture(event.pointerId);
        }
        catch {
            // Capture can throw on detached nodes; pointerup/touchend still finish the gesture.
        }
    };

    const releasePointer = (pointerId) => {
        if (!root || typeof pointerId !== 'number' || typeof root.releasePointerCapture !== 'function')
            return;
        try {
            if (!root.hasPointerCapture || root.hasPointerCapture(pointerId))
                root.releasePointerCapture(pointerId);
        }
        catch {
            // Ignore: capture was never taken or already released.
        }
    };

    const clearPress = () => {
        if (!press)
            return;
        cancelSchedule(press.timer);
        cancelSchedule(press.hintTimer);
        releasePointer(press.pointerId);
        press = null;
        blockNativeCallout(false);
    };

    const trySelect = (target, point, event) => {
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

    const startPress = (event) => {
        if (!isPrimaryPress(event))
            return;
        if (isPluginNode(event.target))
            return;
        if (busy())
            return;
        clearPress();
        const point = pointFromEvent(event);
        const target = event.target;
        blockNativeCallout(true);
        capturePointer(event);
        press = {
            pointerId: event.pointerId,
            x: point.x,
            y: point.y,
            target,
            timer: schedule(() => {
                if (!press)
                    return;
                const current = press;
                press = null;
                trySelect(current.target, { x: current.x, y: current.y }, null);
            }, longPressDurationMs(event)),
            hintTimer: schedule(() => {
                if (!press || busy())
                    return;
                picker.previewTarget(press.target);
            }, LONG_PRESS_HINT_MS),
        };
    };

    return {
        onKeyDown(event) {
            applyKeyboardModifierEvent(held, event);
        },
        onKeyUp(event) {
            applyKeyboardModifierEvent(held, event);
            if (matchModifier && !matchesClickModifier(flagsFrom(event), matchModifier) && !press)
                picker.hidePreview();
        },
        onPointerDown(event) {
            startPress(event);
        },
        onPointerMove(event) {
            if (press && (press.pointerId == null || event.pointerId === press.pointerId) &&
                pointerMovementExceeded(press.x, press.y, event.clientX, event.clientY)) {
                clearPress();
                if (!modifierHeld(event))
                    picker.hidePreview();
            }
            if (busy())
                return;
            if (matchModifier && modifierHeld(event)) {
                picker.previewTarget(event.target);
                return;
            }
            if (!press && matchModifier)
                picker.hidePreview();
        },
        onPointerUp(event) {
            if (recentlyPicked()) {
                swallow(event);
                clearPress();
                return;
            }
            const wasPress = !!(press && (press.pointerId == null || event.pointerId === press.pointerId));
            clearPress();
            if (!isPrimaryPress(event) || busy() || isPluginNode(event.target))
                return;
            if (matchModifier && modifierHeld(event)) {
                trySelect(event.target, pointFromEvent(event), event);
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
        onClick(event) {
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
        onContextMenu(event) {
            // Native ~500ms callouts / trackpad "press and hold for right-click" abort a 4s hold.
            // Swallow while a primary press is in flight; a real right-click (button 2 from the start)
            // never calls startPress, so the page context menu still works.
            if (press || recentlyPicked())
                swallow(event);
        },
        onSelectStart(event) {
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
            clearPress();
            picker.hidePreview();
        },
        dispose() {
            clearPress();
        },
    };
}

/**
 * Attach pick gestures to the host document.
 *
 * Purpose: wires the controller from `createPickGestureController` to capture-phase listeners so the inspector sees
 * Command/Ctrl and long-press before the page. Device-mode touch and desktop mouse share this one path.
 * Boundary: listeners live for the page lifetime (the client does not hot-unmount). `clickModifierRaw` of `false` /
 * `null` skips modifier-picking but still installs long-press. Passing a picker whose `dialog` is missing will throw
 * on the first pointerdown.
 *
 * @param {{ picker: object, clickModifierRaw: any, platform: string, target?: EventTarget, view?: Window }} options
 * @returns {() => void} Detach function (tests; production boot never calls it).
 */
export function installPickGestures(options) {
    const view = options.view || window;
    const target = options.target || document;
    const matchModifier = matchingClickModifier(options.clickModifierRaw, options.platform);
    const controller = createPickGestureController({
        picker: options.picker,
        matchModifier,
    });
    const capture = true;
    const captureActive = { capture: true, passive: false };
    target.addEventListener('pointerdown', controller.onPointerDown, captureActive);
    target.addEventListener('pointermove', controller.onPointerMove, capture);
    target.addEventListener('pointerup', controller.onPointerUp, capture);
    target.addEventListener('pointercancel', controller.onPointerCancel, capture);
    target.addEventListener('mouseup', controller.onPointerUp, capture);
    target.addEventListener('touchend', controller.onPointerUp, captureActive);
    target.addEventListener('click', controller.onClick, capture);
    target.addEventListener('contextmenu', controller.onContextMenu, captureActive);
    target.addEventListener('selectstart', controller.onSelectStart, captureActive);
    target.addEventListener('keydown', controller.onKeyDown, capture);
    target.addEventListener('keyup', controller.onKeyUp, capture);
    view.addEventListener('scroll', controller.onScroll, capture);
    view.addEventListener('blur', controller.onBlur);
    target.addEventListener('visibilitychange', controller.onBlur, capture);
    return () => {
        target.removeEventListener('pointerdown', controller.onPointerDown, capture);
        target.removeEventListener('pointermove', controller.onPointerMove, capture);
        target.removeEventListener('pointerup', controller.onPointerUp, capture);
        target.removeEventListener('pointercancel', controller.onPointerCancel, capture);
        target.removeEventListener('mouseup', controller.onPointerUp, capture);
        target.removeEventListener('touchend', controller.onPointerUp, capture);
        target.removeEventListener('click', controller.onClick, capture);
        target.removeEventListener('contextmenu', controller.onContextMenu, capture);
        target.removeEventListener('selectstart', controller.onSelectStart, capture);
        target.removeEventListener('keydown', controller.onKeyDown, capture);
        target.removeEventListener('keyup', controller.onKeyUp, capture);
        view.removeEventListener('scroll', controller.onScroll, capture);
        view.removeEventListener('blur', controller.onBlur);
        target.removeEventListener('visibilitychange', controller.onBlur, capture);
        controller.dispose();
    };
}
