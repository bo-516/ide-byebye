import assert from 'node:assert/strict';
import test from 'node:test';
import { ISOLATED_UI_EVENTS, bindScrimDismiss, isolateUiEvents } from './event-isolation.js';

/**
 * Scrim stand-in that records its listeners so a test can fire them with any target. A real `EventTarget` has no
 * children, so it could never deliver a click whose target is the dialog inside the scrim.
 */
function fakeScrim() {
    const listeners = new Map<string, (event: { target: unknown }) => void>();
    return {
        addEventListener(type: string, listener: (event: { target: unknown }) => void) {
            listeners.set(type, listener);
        },
        fire(type: string, target: unknown) {
            listeners.get(type)?.({ target });
        },
    };
}

test('isolateUiEvents stops every UI input event at the shadow root, and only those', () => {
    const root = new EventTarget();
    isolateUiEvents(root);
    const stoppedBy = (type: string) => {
        // Read inside a later listener: the stop flag is cleared once dispatch ends.
        let stopped = false;
        const later = (event: Event) => {
            stopped = event.cancelBubble;
        };
        root.addEventListener(type, later);
        root.dispatchEvent(new Event(type, { bubbles: true }));
        root.removeEventListener(type, later);
        return stopped;
    };
    for (const type of ISOLATED_UI_EVENTS)
        assert.equal(stoppedBy(type), true, type);
    // Focus belongs to the dialog's capture-phase focus guard; page focus traps still need to see focus leave.
    assert.equal(stoppedBy('focusin'), false);
});

test('isolateUiEvents leaves other listeners on the shadow root running', () => {
    const root = new EventTarget();
    let delivered = 0;
    isolateUiEvents(root);
    root.addEventListener('click', () => {
        delivered += 1;
    });
    root.dispatchEvent(new Event('click', { bubbles: true }));
    assert.equal(delivered, 1);
});

test('bindScrimDismiss closes only on the click that ends a press on the scrim', () => {
    const scrim = fakeScrim();
    let closed = 0;
    bindScrimDismiss(scrim as unknown as EventTarget, () => {
        closed += 1;
    });
    scrim.fire('pointerdown', scrim);
    // Still open on press: closing here let the rest of a touch tap fall through to the page.
    assert.equal(closed, 0);
    scrim.fire('click', scrim);
    assert.equal(closed, 1);
});

test('bindScrimDismiss ignores clicks whose press began elsewhere or that end on the dialog', () => {
    const scrim = fakeScrim();
    const dialog = {};
    let closed = 0;
    bindScrimDismiss(scrim as unknown as EventTarget, () => {
        closed += 1;
    });
    // Release of the long-press that opened the dialog: its press began on the page, before the scrim existed.
    scrim.fire('click', scrim);
    // Text selection dragged out of the dialog: the click goes to the common ancestor, the scrim.
    scrim.fire('pointerdown', dialog);
    scrim.fire('click', scrim);
    // Press on the scrim, release on the dialog.
    scrim.fire('pointerdown', scrim);
    scrim.fire('click', dialog);
    // The flag does not outlive its click.
    scrim.fire('click', scrim);
    assert.equal(closed, 0);
});
