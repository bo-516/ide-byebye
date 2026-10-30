/**
 * Input events that start inside the plugin's shadow UI and must not reach page listeners.
 *
 * Purpose: shadow DOM retargets composed events to the host, so without a boundary every tap on the dialog reaches the
 * page's listeners on `body` / `document` / `window`: click-away handlers close the page's own popups, gesture code
 * reacts to touches it never started, and keyboard shortcuts fire while the user types — their "ignore editable
 * targets" checks see the plain `<div>` host instead of our editor. The list covers everything a tap, drag or keystroke
 * produces, including the compat mouse events and the click that mobile browsers synthesize after `touchend`.
 * Boundary: focus events stay with the dialog's focus guard (`dialog-layout.ts`), which has to run in the capture
 * phase ahead of page focus traps. Drag-and-drop is left alone: nothing in the UI is a drop target.
 * @type {readonly string[]}
 */
export const ISOLATED_UI_EVENTS = [
    'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerover', 'pointerout',
    'touchstart', 'touchmove', 'touchend', 'touchcancel',
    'mousedown', 'mousemove', 'mouseup', 'mouseover', 'mouseout',
    'click', 'auxclick', 'dblclick', 'contextmenu', 'wheel',
    'keydown', 'keyup', 'keypress',
    'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend',
    'copy', 'cut', 'paste',
] as const;

/**
 * Stop UI input events at the shadow-root boundary so page listeners never see them.
 *
 * Purpose: listeners inside the shadow tree run first (target phase and bubbling up to the shadow root); the
 * `stopPropagation` here then keeps the event from bubbling on to the host, `body`, `document` and `window`.
 * Boundary: page listeners registered in the capture phase on `window` / `document` still run before ours. They
 * cannot be blocked without also blocking our own controls, because script-dispatched copies of an event neither
 * activate buttons nor insert text. Our own document-level listeners (pick gestures, Escape, menu keys, drag tracking)
 * are all capture-phase, so they are unaffected. The listeners are passive: they never cancel a default action, and
 * touch / wheel scrolling inside the UI stays off the main thread.
 *
 * @param {EventTarget} root Shadow root holding every plugin UI node. Passing a node inside the shadow tree instead
 *   would leave events from its siblings unisolated.
 * @returns {void}
 */
export function isolateUiEvents(root: EventTarget): void {
    for (const type of ISOLATED_UI_EVENTS)
        root.addEventListener(type, stopAtBoundary, { passive: true });
}

/**
 * Shared listener for {@link isolateUiEvents}.
 *
 * Boundary: `stopPropagation`, not `stopImmediatePropagation`, so other listeners on the shadow root itself still run.
 *
 * @param {Event} event Any event in {@link ISOLATED_UI_EVENTS} that reached the shadow root.
 * @returns {void}
 */
function stopAtBoundary(event: Event): void {
    event.stopPropagation();
}

/**
 * Close a modal when the user taps or clicks its scrim, once the whole gesture is over.
 *
 * Purpose: on touch, the compat `mousedown` / `mouseup` and the synthesized `click` arrive after `touchend`, and the
 * browser hit-tests again between them. Closing on `mousedown` removed the scrim mid-tap, so the rest of the tap landed
 * on the page element underneath. `click` is the last event of a tap (and of a mouse click), so nothing is left over.
 * Boundary: the press must also start on the scrim. A text selection dragged out of the dialog ends with a click on
 * the scrim (the common ancestor) and must not close it, and neither must the release of a long-press that opened
 * the dialog. Events whose target is inside the dialog never dismiss.
 *
 * @param {EventTarget} scrim Full-screen backdrop; `event.target === scrim` is how a press on the scrim itself is told
 *   apart from one on the dialog it contains.
 * @param {() => void} onDismiss Called once per qualifying click.
 * @returns {void}
 */
export function bindScrimDismiss(scrim: EventTarget, onDismiss: () => void): void {
    let pressedOnScrim = false;
    scrim.addEventListener('pointerdown', (event) => {
        pressedOnScrim = event.target === scrim;
    });
    scrim.addEventListener('click', (event) => {
        const dismiss = pressedOnScrim && event.target === scrim;
        pressedOnScrim = false;
        if (dismiss)
            onDismiss();
    });
}
