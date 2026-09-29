import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LONG_PRESS_DURATION_MS,
    LONG_PRESS_DURATION_TOUCH_MS,
    LONG_PRESS_HINT_MS,
    LONG_PRESS_MOVE_PX,
    PICK_CONSUME_MS,
    createPickGestureController,
    isMatchingPress,
    isPrimaryPress,
    longPressDurationMs,
    pointerMovementExceeded,
    pointFromEvent,
    resolvePickTarget,
} from './pick-gestures.js';

function createClock() {
    let current = 0;
    let nextId = 0;
    const timers = new Map<number, { fn: () => void; due: number }>();
    return {
        now: () => current,
        schedule(fn: () => void, ms: number) {
            nextId += 1;
            timers.set(nextId, { fn, due: current + ms });
            return nextId;
        },
        cancel(id: number) {
            timers.delete(id);
        },
        advance(ms: number) {
            current += ms;
            const due: { fn: () => void; due: number }[] = [];
            for (const [id, timer] of timers) {
                if (timer.due <= current) {
                    timers.delete(id);
                    due.push(timer);
                }
            }
            due.sort((a, b) => a.due - b.due);
            for (const timer of due)
                timer.fn();
        },
    };
}

function pageNode() {
    return { closest: () => null };
}

function pluginNode() {
    return { closest: () => ({}) };
}

function mockPicker() {
    const calls: {
        select: { target: unknown; point: { x: number; y: number } }[];
        preview: number;
        previewTargets: unknown[];
        hide: number;
    } = { select: [], preview: 0, previewTargets: [], hide: 0 };
    const picker = {
        active: false,
        open: false,
        dialog: { isOpen: () => picker.open },
        isActive: () => picker.active,
        previewTarget(target: unknown) {
            calls.preview += 1;
            calls.previewTargets.push(target);
        },
        hidePreview() {
            calls.hide += 1;
        },
        selectTarget(target: unknown, point: { x: number; y: number }) {
            if (picker.active || picker.open)
                return false;
            calls.select.push({ target, point });
            picker.open = true;
            return true;
        },
        calls,
    };
    return picker;
}

function capturingNode() {
    const node: {
        closest: () => null;
        captured: number[];
        released: number[];
        setPointerCapture(id: number): void;
        releasePointerCapture(id: number): void;
        hasPointerCapture(): boolean;
    } = {
        closest: () => null,
        captured: [],
        released: [],
        setPointerCapture(id: number) {
            node.captured.push(id);
        },
        releasePointerCapture(id: number) {
            node.released.push(id);
        },
        hasPointerCapture() {
            return true;
        },
    };
    return node;
}

function makeController(matchModifier: string | null = 'auto') {
    const clock = createClock();
    const picker = mockPicker();
    const controller = createPickGestureController({
        picker,
        matchModifier,
        schedule: (fn, ms) => clock.schedule(fn, ms),
        cancelSchedule: (id) => clock.cancel(id),
        now: () => clock.now(),
    });
    return { clock, picker, controller };
}

function keyEvent(flags: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}) {
    return { key: 'Meta', ...flags };
}

/** Fields the gesture machine reads, plus the flags tests assert after `preventDefault`. */
interface PointerFixture {
    pointerId?: number;
    button?: number;
    isPrimary?: boolean;
    pointerType?: string;
    clientX: number;
    clientY: number;
    target: unknown;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    preventDefault(): void;
    stopPropagation(): void;
    stopImmediatePropagation(): void;
    /** Absent until `preventDefault` runs, so tests can still see `undefined`. */
    prevented?: boolean;
    stopped?: boolean;
    immediate?: boolean;
}

function pointerEvent(overrides: Partial<PointerFixture> = {}): PointerFixture {
    return {
        pointerId: 1,
        button: 0,
        isPrimary: true,
        clientX: 10,
        clientY: 20,
        target: pageNode(),
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        preventDefault(this: PointerFixture) {
            this.prevented = true;
        },
        stopPropagation(this: PointerFixture) {
            this.stopped = true;
        },
        stopImmediatePropagation(this: PointerFixture) {
            this.immediate = true;
        },
        ...overrides,
    } as PointerFixture;
}

test('longPressDurationMs is 1s on touch and 4s on mouse', () => {
    assert.equal(longPressDurationMs({ pointerType: 'touch' }), LONG_PRESS_DURATION_TOUCH_MS);
    assert.equal(longPressDurationMs({ pointerType: 'mouse' }), LONG_PRESS_DURATION_MS);
    assert.equal(longPressDurationMs({}), LONG_PRESS_DURATION_MS);
    assert.equal(longPressDurationMs({ touches: [{ clientX: 1, clientY: 1 }] }), LONG_PRESS_DURATION_TOUCH_MS);
});

test('pointerMovementExceeded uses the long-press pixel tolerance', () => {
    assert.equal(pointerMovementExceeded(0, 0, 0, 0), false);
    assert.equal(pointerMovementExceeded(0, 0, LONG_PRESS_MOVE_PX, 0), false);
    assert.equal(pointerMovementExceeded(0, 0, LONG_PRESS_MOVE_PX + 1, 0), true);
});

test('isPrimaryPress rejects extra buttons and non-primary pointers', () => {
    assert.equal(isPrimaryPress({ button: 0, isPrimary: true }), true);
    assert.equal(isPrimaryPress({ button: 2, isPrimary: true }), false);
    assert.equal(isPrimaryPress({ button: 0, isPrimary: false }), false);
    assert.equal(isPrimaryPress({}), true);
});

test('pointFromEvent prefers changedTouches when clientX is a zeroed touchend', () => {
    assert.deepEqual(pointFromEvent({ clientX: 4, clientY: 8 }), { x: 4, y: 8 });
    assert.deepEqual(pointFromEvent({
        clientX: 0,
        clientY: 0,
        changedTouches: [{ clientX: 12, clientY: 34 }],
    }), { x: 12, y: 34 });
});

test('keydown Command plus a touch click with metaKey false still picks', () => {
    const { picker, controller } = makeController('auto');
    controller.onKeyDown(keyEvent({ metaKey: true }));
    const click = pointerEvent({ metaKey: false, ctrlKey: false });
    controller.onClick(click);
    assert.equal(picker.calls.select.length, 1);
    assert.equal(click.prevented, true);
    assert.equal(click.immediate, true);
});

test('keydown Command plus pointerup without metaKey picks and cancels the long-press timer', () => {
    const { clock, picker, controller } = makeController('auto');
    const node = pageNode();
    controller.onKeyDown(keyEvent({ metaKey: true }));
    controller.onPointerDown(pointerEvent({ target: node, pointerId: 1, metaKey: false }));
    const up = pointerEvent({ target: node, pointerId: 1, metaKey: false });
    controller.onPointerUp(up);
    assert.equal(picker.calls.select.length, 1);
    picker.open = false;
    clock.advance(LONG_PRESS_DURATION_MS);
    assert.equal(picker.calls.select.length, 1);
});

test('touch pointerup with cleared flags still picks from the keyboard tracker', () => {
    const { picker, controller } = makeController('auto');
    const node = pageNode();
    controller.onKeyDown(keyEvent({ metaKey: true }));
    controller.onPointerDown(pointerEvent({ pointerType: 'touch', target: node, pointerId: 2 }));
    controller.onPointerUp(pointerEvent({ pointerType: 'touch', target: node, pointerId: 2 }));
    assert.equal(picker.calls.select.length, 1);
});

test('a Command keyup the page never saw does not turn a plain mouse click into a pick', () => {
    const { picker, controller } = makeController('auto');
    const node = pageNode();
    // keydown reached the page; the keyup was swallowed outside it (system shortcut) and no blur fired.
    controller.onKeyDown(keyEvent({ metaKey: true }));
    controller.onPointerMove(pointerEvent({ pointerType: 'mouse', target: node }));
    assert.equal(picker.calls.preview, 0);
    controller.onPointerDown(pointerEvent({ pointerType: 'mouse', target: node, pointerId: 1 }));
    const up = pointerEvent({ pointerType: 'mouse', target: node, pointerId: 1 });
    controller.onPointerUp(up);
    // The compat mouseup has no pointerType, so it relies on the tracker the pointerup just resynced.
    const mouseUp = pointerEvent({ target: node, pointerId: undefined });
    controller.onPointerUp(mouseUp);
    const click = pointerEvent({ pointerType: 'mouse', target: node });
    controller.onClick(click);
    assert.equal(picker.calls.select.length, 0);
    assert.equal(up.prevented, undefined);
    assert.equal(mouseUp.prevented, undefined);
    assert.equal(click.prevented, undefined);
});

test('a mouse move clears a stale Command before a flagless click can reuse it', () => {
    const { picker, controller } = makeController('auto');
    controller.onKeyDown(keyEvent({ metaKey: true }));
    controller.onPointerMove(pointerEvent({ pointerType: 'mouse' }));
    controller.onClick(pointerEvent());
    assert.equal(picker.calls.select.length, 0);
});

test('a real mouse Command-click picks from its own flags without a prior keydown', () => {
    const { picker, controller } = makeController('auto');
    const node = pageNode();
    controller.onPointerMove(pointerEvent({ pointerType: 'mouse', target: node, metaKey: true }));
    assert.equal(picker.calls.preview, 1);
    controller.onPointerDown(pointerEvent({ pointerType: 'mouse', target: node, pointerId: 1, metaKey: true }));
    controller.onPointerUp(pointerEvent({ pointerType: 'mouse', target: node, pointerId: 1, metaKey: true }));
    assert.equal(picker.calls.select.length, 1);
    assert.equal(picker.calls.select[0].target, node);
});

test('auto matching also picks from Ctrl when the UA looks like a phone', () => {
    const { picker, controller } = makeController('auto');
    const click = pointerEvent({ ctrlKey: true });
    controller.onClick(click);
    assert.equal(picker.calls.select.length, 1);
});

test('explicit meta does not pick from Ctrl-only flags', () => {
    const { picker, controller } = makeController('meta');
    controller.onClick(pointerEvent({ ctrlKey: true, metaKey: false }));
    assert.equal(picker.calls.select.length, 0);
});

test('modifier picking is off when matchModifier is null; long-press still opens', () => {
    const { clock, picker, controller } = makeController(null);
    const node = pageNode();
    controller.onKeyDown(keyEvent({ metaKey: true }));
    controller.onClick(pointerEvent({ target: node, metaKey: true }));
    assert.equal(picker.calls.select.length, 0);

    controller.onPointerDown(pointerEvent({ target: node, pointerId: 7 }));
    clock.advance(LONG_PRESS_DURATION_MS);
    assert.equal(picker.calls.select.length, 1);
    assert.equal(picker.calls.select[0].target, node);
});

test('long-press 4s selects the pressed target on mouse', () => {
    const { clock, picker, controller } = makeController('auto');
    const node = pageNode();
    controller.onPointerDown(pointerEvent({
        target: node,
        pointerId: 3,
        pointerType: 'mouse',
        clientX: 40,
        clientY: 50,
    }));
    clock.advance(LONG_PRESS_HINT_MS);
    assert.equal(picker.calls.preview, 1);
    assert.equal(picker.calls.select.length, 0);
    clock.advance(LONG_PRESS_DURATION_MS - LONG_PRESS_HINT_MS);
    assert.equal(picker.calls.select.length, 1);
    assert.deepEqual(picker.calls.select[0].point, { x: 40, y: 50 });
});

test('touch / device-mode long-press opens at 1s, not 4s', () => {
    const { clock, picker, controller } = makeController('auto');
    const node = pageNode();
    controller.onPointerDown(pointerEvent({
        target: node,
        pointerId: 4,
        pointerType: 'touch',
        clientX: 12,
        clientY: 18,
    }));
    clock.advance(LONG_PRESS_DURATION_TOUCH_MS - 1);
    assert.equal(picker.calls.select.length, 0);
    clock.advance(1);
    assert.equal(picker.calls.select.length, 1);
    assert.deepEqual(picker.calls.select[0].point, { x: 12, y: 18 });
});

test('moving past the tolerance cancels the long-press timer', () => {
    const { clock, picker, controller } = makeController('auto');
    controller.onPointerDown(pointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
    controller.onPointerMove(pointerEvent({
        pointerId: 1,
        clientX: LONG_PRESS_MOVE_PX + 5,
        clientY: 0,
    }));
    clock.advance(LONG_PRESS_DURATION_MS);
    assert.equal(picker.calls.select.length, 0);
});

test('releasing before 4s does not long-press select', () => {
    const { clock, picker, controller } = makeController('auto');
    controller.onPointerDown(pointerEvent({ pointerId: 1 }));
    clock.advance(LONG_PRESS_DURATION_MS - 1);
    controller.onPointerUp(pointerEvent({ pointerId: 1 }));
    clock.advance(1);
    assert.equal(picker.calls.select.length, 0);
});

test('plugin UI and busy picker never start a long-press', () => {
    const { clock, picker, controller } = makeController('auto');
    controller.onPointerDown(pointerEvent({ target: pluginNode() }));
    clock.advance(LONG_PRESS_DURATION_MS);
    assert.equal(picker.calls.select.length, 0);

    picker.active = true;
    controller.onPointerDown(pointerEvent({ target: pageNode() }));
    clock.advance(LONG_PRESS_DURATION_MS);
    assert.equal(picker.calls.select.length, 0);
});

test('a successful pick swallows the following click within the consume window', () => {
    const { clock, picker, controller } = makeController('auto');
    const node = pageNode();
    controller.onPointerDown(pointerEvent({ target: node, pointerId: 1 }));
    clock.advance(LONG_PRESS_DURATION_MS);
    assert.equal(picker.calls.select.length, 1);
    picker.open = false;
    const click = pointerEvent({ target: node, pointerId: 1 });
    controller.onClick(click);
    assert.equal(picker.calls.select.length, 1);
    assert.equal(click.prevented, true);
    clock.advance(PICK_CONSUME_MS);
    const later = pointerEvent({ target: node, metaKey: true });
    controller.onClick(later);
    assert.equal(picker.calls.select.length, 2);
});

test('contextmenu is swallowed only while a press is in flight', () => {
    const { controller } = makeController('auto');
    const idle = pointerEvent();
    controller.onContextMenu(idle);
    assert.equal(idle.prevented, undefined);
    controller.onPointerDown(pointerEvent({ pointerId: 1 }));
    const during = pointerEvent();
    controller.onContextMenu(during);
    assert.equal(during.prevented, true);
});

test('Chrome long-press conversion (contextmenu + pointercancel) still opens at 4s', () => {
    const { clock, picker, controller } = makeController('auto');
    const node = pageNode();
    controller.onPointerDown(pointerEvent({ target: node, pointerId: 1 }));
    const menu = pointerEvent({ button: 2, target: node });
    controller.onContextMenu(menu);
    assert.equal(menu.prevented, true);
    // The handler ignores its event; its type takes none, and the cast keeps passing the fixture through.
    const onPointerCancel: (event?: PointerFixture) => void = controller.onPointerCancel;
    onPointerCancel(pointerEvent({ pointerId: 1 }));
    clock.advance(LONG_PRESS_DURATION_MS);
    assert.equal(picker.calls.select.length, 1);
    assert.equal(picker.calls.select[0].target, node);
});

test('isMatchingPress treats a missing pointerId as the same single-pointer press', () => {
    assert.equal(isMatchingPress(null, { pointerId: 1 }), false);
    assert.equal(isMatchingPress({ pointerId: 1 }, { pointerId: 1 }), true);
    assert.equal(isMatchingPress({ pointerId: 1 }, { pointerId: 2 }), false);
    assert.equal(isMatchingPress({ pointerId: 1 }, {}), true);
    assert.equal(isMatchingPress({}, { pointerId: 1 }), true);
});

test('resolvePickTarget prefers the press snapshot over a capture-retargeted event target', () => {
    const pressed = pageNode();
    const html = pageNode();
    assert.equal(resolvePickTarget({ pointerId: 1, target: pressed }, { pointerId: 1, target: html }), pressed);
    assert.equal(resolvePickTarget(null, { pointerId: 1, target: html }), html);
    assert.equal(resolvePickTarget({ pointerId: 1, target: pressed }, { pointerId: 2, target: html }), html);
});

test('Command-click still picks the press target when pointerup is retargeted to the document root', () => {
    const { picker, controller } = makeController('auto');
    const node = pageNode();
    const html = pageNode();
    controller.onKeyDown(keyEvent({ metaKey: true }));
    controller.onPointerDown(pointerEvent({ target: node, pointerId: 1, metaKey: true, clientX: 40, clientY: 50 }));
    const up = pointerEvent({ target: html, pointerId: 1, metaKey: true, clientX: 40, clientY: 50 });
    controller.onPointerUp(up);
    assert.equal(picker.calls.select.length, 1);
    assert.equal(picker.calls.select[0].target, node);
    assert.deepEqual(picker.calls.select[0].point, { x: 40, y: 50 });
    assert.equal(up.prevented, true);
});

test('modifier preview during press stays on the press target, not a retargeted html root', () => {
    const { picker, controller } = makeController('auto');
    const node = pageNode();
    const html = pageNode();
    controller.onKeyDown(keyEvent({ metaKey: true }));
    controller.onPointerDown(pointerEvent({ target: node, pointerId: 1, metaKey: true, clientX: 10, clientY: 20 }));
    controller.onPointerMove(pointerEvent({ target: html, pointerId: 1, metaKey: true, clientX: 11, clientY: 20 }));
    assert.equal(picker.calls.preview, 1);
    assert.equal(picker.calls.previewTargets[0], node);
});

test('does not setPointerCapture on the documentElement root', () => {
    const root = capturingNode();
    const node = capturingNode();
    const clock = createClock();
    const picker = mockPicker();
    const controller = createPickGestureController({
        picker,
        matchModifier: 'auto',
        schedule: (fn, ms) => clock.schedule(fn, ms),
        cancelSchedule: (id) => clock.cancel(id),
        now: () => clock.now(),
        root,
    });
    controller.onKeyDown(keyEvent({ metaKey: true }));
    controller.onPointerDown(pointerEvent({ target: node, pointerId: 9, metaKey: true }));
    assert.deepEqual(root.captured, []);
    assert.deepEqual(node.captured, [9]);
    controller.onPointerUp(pointerEvent({ target: root, pointerId: 9, metaKey: true }));
    assert.deepEqual(node.released, [9]);
    assert.equal(picker.calls.select.length, 1);
    assert.equal(picker.calls.select[0].target, node);
});
