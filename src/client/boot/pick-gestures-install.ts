import { matchingClickModifier } from './click-modifier.js';
import { createPickGestureController } from './pick-gestures.js';
import type { GesturePicker } from './pick-gesture-utils.js';

/**
 * Attach pick gestures to the host document.
 *
 * Purpose: wires the controller from `createPickGestureController` to capture-phase listeners so the inspector sees
 * Command/Ctrl (and, when enabled, a long-press) before the page. Device-mode touch and desktop mouse share this one
 * path.
 * Boundary: listeners live for the page lifetime (the client does not hot-unmount). `clickModifierRaw` of `false` /
 * `null` skips modifier-picking; with `longPress` off as well, every listener stays installed but no press is ever
 * tracked. Passing a picker whose `dialog` is missing will throw on the first pointerdown.
 *
 * @param {{ picker: GesturePicker, clickModifierRaw: string | false | null | undefined, platform: string, longPress?: boolean, target?: EventTarget, view?: Window }} options
 * @returns {() => void} Detach function (tests; production boot never calls it).
 */
export function installPickGestures(options: {
    picker: GesturePicker;
    clickModifierRaw: string | false | null | undefined;
    platform: string;
    /** `true` picks on a stationary hold (1s touch / 4s mouse). Omitted or `false` leaves plain presses to the page. */
    longPress?: boolean;
    /** Defaults to `document`. Typed as `EventTarget` because tests may pass a stand-in; its listeners see `Event`. */
    target?: EventTarget;
    view?: Window;
}): () => void {
    const view = options.view || window;
    const target = options.target || document;
    const matchModifier = matchingClickModifier(options.clickModifierRaw, options.platform);
    const controller = createPickGestureController({
        picker: options.picker,
        matchModifier,
        longPress: options.longPress,
    });
    const capture = true;
    const captureActive = { capture: true, passive: false };
    // `EventTarget` types every listener as `Event`. Pointer handlers are not `Event`s, so the cast goes through `unknown`.
    // Both assertions erase: add and remove still share the same function.
    target.addEventListener('pointerdown', controller.onPointerDown as unknown as EventListener, captureActive);
    target.addEventListener('pointermove', controller.onPointerMove as unknown as EventListener, capture);
    target.addEventListener('pointerup', controller.onPointerUp as unknown as EventListener, capture);
    target.addEventListener('pointercancel', controller.onPointerCancel, capture);
    target.addEventListener('mouseup', controller.onPointerUp as unknown as EventListener, capture);
    target.addEventListener('touchend', controller.onPointerUp as unknown as EventListener, captureActive);
    target.addEventListener('click', controller.onClick as unknown as EventListener, capture);
    target.addEventListener('contextmenu', controller.onContextMenu as unknown as EventListener, captureActive);
    target.addEventListener('selectstart', controller.onSelectStart as unknown as EventListener, captureActive);
    target.addEventListener('keydown', controller.onKeyDown as unknown as EventListener, capture);
    target.addEventListener('keyup', controller.onKeyUp as unknown as EventListener, capture);
    view.addEventListener('scroll', controller.onScroll, capture);
    view.addEventListener('blur', controller.onBlur);
    target.addEventListener('visibilitychange', controller.onBlur, capture);
    return () => {
        target.removeEventListener('pointerdown', controller.onPointerDown as unknown as EventListener, capture);
        target.removeEventListener('pointermove', controller.onPointerMove as unknown as EventListener, capture);
        target.removeEventListener('pointerup', controller.onPointerUp as unknown as EventListener, capture);
        target.removeEventListener('pointercancel', controller.onPointerCancel, capture);
        target.removeEventListener('mouseup', controller.onPointerUp as unknown as EventListener, capture);
        target.removeEventListener('touchend', controller.onPointerUp as unknown as EventListener, capture);
        target.removeEventListener('click', controller.onClick as unknown as EventListener, capture);
        target.removeEventListener('contextmenu', controller.onContextMenu as unknown as EventListener, capture);
        target.removeEventListener('selectstart', controller.onSelectStart as unknown as EventListener, capture);
        target.removeEventListener('keydown', controller.onKeyDown as unknown as EventListener, capture);
        target.removeEventListener('keyup', controller.onKeyUp as unknown as EventListener, capture);
        view.removeEventListener('scroll', controller.onScroll, capture);
        view.removeEventListener('blur', controller.onBlur);
        target.removeEventListener('visibilitychange', controller.onBlur, capture);
        controller.dispose();
    };
}
