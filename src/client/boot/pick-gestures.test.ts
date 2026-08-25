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
    const timers = new Map();
    return {
        now: () => current,
        schedule(fn, ms) {
            nextId += 1;
            timers.set(nextId, { fn, due: current + ms });
            return nextId;
        },
        cancel(id) {
            timers.delete(id);
        },
        advance(ms) {
            current += ms;
            const due = [];
            for (const [id, t] of timers) {
                if (t.due <= current) {
                    timers.delete(id);
                    due.push(t);
                }
            }
            due.sort((a, b) => a.due - b.due);
            for (const t of due)
                t.fn();
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
    const calls = { select: [], preview: 0, previewTargets: [], hide: 0 };
    const picker = {
        active: false,
        open: false,
        dialog: { isOpen: () => picker.open },
        isActive: () => picker.active,
        previewTarget(target) {
            calls.preview += 1;
            calls.previewTargets.push(target);
        },
        hidePreview() {
            calls.hide += 1;
        },
        selectTarget(target, point) {
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
    const node = {
        closest: () => null,
        captured: [],
        released: [],
        setPointerCapture(id) {
            node.captured.push(id);
        },
        releasePointerCapture(id) {
            node.released.push(id);
        },
        hasPointerCapture() {
            return true;
        },
    };
    return node;
}

function makeController(matchModifier = 'auto') {
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

function keyEvent(flags) {
    return { key: 'Meta', ...flags };
}

function pointerEvent(overrides = {}) {
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
        preventDefault() {
            this.prevented = true;
        },
        stopPropagation() {
            this.stopped = true;
        },
        stopImmediatePropagation() {
            this.immediate = true;
        },
        ...overrides,
    };
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
    controller.onPointerCancel(pointerEvent({ pointerId: 1 }));
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
