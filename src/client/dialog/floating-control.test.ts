import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DRAG_THRESHOLD,
    DRAGGING_CLASS,
    ORB_MARGIN,
    ORB_SIZE,
    PRESSED_CLASS,
    bindFloatingDrag,
    clampFloatingPoint,
    floatingRole,
    snapFloatingPoint,
    toFloatingPoint,
    type FloatingPoint,
} from './floating-control.js';

const PHONE = { width: 412, height: 860 };

/** `EventTarget` stand-in for the control: records classes and pointer capture, sits at (300, 700). */
class FakeControl extends EventTarget {
    classes = new Set<string>();
    captured: number[] = [];
    classList = {
        add: (...tokens: string[]) => tokens.forEach((token) => this.classes.add(token)),
        remove: (...tokens: string[]) => tokens.forEach((token) => this.classes.delete(token)),
    };
    getBoundingClientRect() {
        return { left: 300, top: 700 };
    }
    setPointerCapture(pointerId: number) {
        this.captured.push(pointerId);
    }
}

/** Dispatch a pointer-shaped event; node has no `PointerEvent`, so the fields ride on a plain `Event`. */
function fire(target: EventTarget, type: string, fields: Record<string, unknown> = {}) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 1, button: 0, isPrimary: true, clientX: 0, clientY: 0, ...fields });
    target.dispatchEvent(event);
    return event;
}

function bind() {
    const control = new FakeControl();
    const calls = { moves: [] as FloatingPoint[], ends: [] as boolean[], taps: 0 };
    bindFloatingDrag(control, {
        move: (point) => calls.moves.push(point),
        end: (dragged) => calls.ends.push(dragged),
        tap: () => {
            calls.taps += 1;
        },
    });
    return { control, calls };
}

test('floatingRole keeps the plain orb exactly as before when the pick button is off', () => {
    assert.equal(floatingRole({ button: false, dialogOpen: false, pinned: true, picking: false }), 'orb');
    assert.equal(floatingRole({ button: false, dialogOpen: false, pinned: false, picking: false }), null);
    // Pinning closes the dialog, so the orb never asks whether it is open.
    assert.equal(floatingRole({ button: false, dialogOpen: true, pinned: true, picking: false }), 'orb');
});

test('floatingRole: the pick button hides with the dialog, resumes a pinned draft, and cancels pick mode', () => {
    assert.equal(floatingRole({ button: true, dialogOpen: false, pinned: false, picking: false }), 'pick');
    assert.equal(floatingRole({ button: true, dialogOpen: false, pinned: true, picking: false }), 'resume');
    assert.equal(floatingRole({ button: true, dialogOpen: false, pinned: false, picking: true }), 'cancel');
    assert.equal(floatingRole({ button: true, dialogOpen: true, pinned: false, picking: false }), null);
    assert.equal(floatingRole({ button: true, dialogOpen: true, pinned: true, picking: true }), null);
});

test('toFloatingPoint accepts two finite numbers and nothing else', () => {
    assert.deepEqual(toFloatingPoint({ x: 10, y: 20 }), { x: 10, y: 20 });
    assert.deepEqual(toFloatingPoint({ x: 10, y: 20, side: 'left' }), { x: 10, y: 20, side: 'left' });
    assert.deepEqual(toFloatingPoint({ x: 10, y: 20, side: 'top' }), { x: 10, y: 20 });
    assert.equal(toFloatingPoint(null), null);
    assert.equal(toFloatingPoint('10,20'), null);
    assert.equal(toFloatingPoint({ x: '10', y: 20 }), null);
    assert.equal(toFloatingPoint({ x: Number.NaN, y: 20 }), null);
    assert.equal(toFloatingPoint({ x: 10 }), null);
});

test('clampFloatingPoint defaults to the bottom-right corner and keeps the control on screen', () => {
    const right = PHONE.width - ORB_SIZE - ORB_MARGIN;
    const bottom = PHONE.height - ORB_SIZE - ORB_MARGIN;
    assert.deepEqual(clampFloatingPoint(null, PHONE), { x: right, y: bottom });
    assert.deepEqual(clampFloatingPoint({ x: -50, y: 9999 }, PHONE), { x: ORB_MARGIN, y: bottom });
    assert.deepEqual(clampFloatingPoint({ x: 100.6, y: 200.2 }, PHONE), { x: 101, y: 200 });
    // A viewport too small for the control pins it to the margin instead of going negative.
    assert.deepEqual(clampFloatingPoint(null, { width: 40, height: 40 }), { x: ORB_MARGIN, y: ORB_MARGIN });
});

test('snapFloatingPoint moves the control to the nearer side edge and keeps its height', () => {
    const right = PHONE.width - ORB_SIZE - ORB_MARGIN;
    assert.deepEqual(snapFloatingPoint({ x: 60, y: 300 }, PHONE), { x: ORB_MARGIN, y: 300, side: 'left' });
    assert.deepEqual(snapFloatingPoint({ x: 250, y: 300 }, PHONE), { x: right, y: 300, side: 'right' });
    // Dead centre goes right, like the default corner.
    assert.deepEqual(snapFloatingPoint({ x: PHONE.width / 2 - ORB_SIZE / 2, y: 300 }, PHONE), { x: right, y: 300, side: 'right' });
    assert.deepEqual(snapFloatingPoint(null, PHONE), { ...clampFloatingPoint(null, PHONE), side: 'right' });
});

test('snapFloatingPoint keeps a snapped side when the viewport rotates', () => {
    const portrait = snapFloatingPoint({ x: 300, y: 700 }, PHONE);
    const landscape = { width: PHONE.height, height: PHONE.width };
    // In px the old right edge sits left of the new centre; the stored side keeps it on the right.
    assert.deepEqual(snapFloatingPoint(portrait, landscape), { x: landscape.width - ORB_SIZE - ORB_MARGIN, y: landscape.height - ORB_SIZE - ORB_MARGIN, side: 'right' });
    const left = snapFloatingPoint({ x: 20, y: 100 }, PHONE);
    assert.equal(snapFloatingPoint(left, landscape).x, ORB_MARGIN);
});

test('bindFloatingDrag: a short press is a tap, delivered on click', () => {
    const { control, calls } = bind();
    fire(control, 'pointerdown', { clientX: 10, clientY: 10 });
    assert.ok(control.classes.has(PRESSED_CLASS));
    assert.deepEqual(control.captured, [1]);
    fire(control, 'pointermove', { clientX: 11, clientY: 11 });
    fire(control, 'pointerup', { clientX: 11, clientY: 11 });
    assert.deepEqual(calls.moves, []);
    assert.deepEqual(calls.ends, [false]);
    assert.equal(control.classes.has(PRESSED_CLASS), false);
    assert.equal(calls.taps, 0);
    const click = fire(control, 'click');
    assert.equal(calls.taps, 1);
    assert.equal(click.defaultPrevented, true);
});

test('bindFloatingDrag: past the threshold the press drags and its click is not a tap', () => {
    const { control, calls } = bind();
    fire(control, 'pointerdown', { clientX: 10, clientY: 10 });
    fire(control, 'pointermove', { clientX: 10 + DRAG_THRESHOLD, clientY: 10 });
    assert.ok(control.classes.has(DRAGGING_CLASS));
    fire(control, 'pointermove', { clientX: -40, clientY: 60 });
    assert.deepEqual(calls.moves.at(-1), { x: 300 - 50, y: 700 + 50 });
    fire(control, 'pointerup', { clientX: -40, clientY: 60 });
    assert.deepEqual(calls.ends, [true]);
    assert.equal(control.classes.has(DRAGGING_CLASS), false);
    // A mouse drag still fires click on the control; it must not start pick mode.
    fire(control, 'click');
    assert.equal(calls.taps, 0);
    // The next plain click is a tap again.
    fire(control, 'click');
    assert.equal(calls.taps, 1);
});

test('bindFloatingDrag ignores other pointers and secondary buttons, and ends on pointercancel', () => {
    const { control, calls } = bind();
    fire(control, 'pointerdown', { button: 2 });
    fire(control, 'pointerdown', { isPrimary: false, pointerId: 2 });
    assert.deepEqual(control.captured, []);
    fire(control, 'pointerdown', { clientX: 0, clientY: 0 });
    fire(control, 'pointermove', { pointerId: 7, clientX: 90, clientY: 0 });
    assert.deepEqual(calls.moves, []);
    fire(control, 'pointermove', { clientX: 30, clientY: 0 });
    fire(control, 'pointercancel');
    assert.deepEqual(calls.ends, [true]);
    const down = fire(control, 'mousedown');
    assert.equal(down.defaultPrevented, true);
});
