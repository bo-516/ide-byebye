import assert from 'node:assert/strict';
import test from 'node:test';
import { observeSessionMenuPosition } from './dialog-session-position.js';

/**
 * Install a deterministic layout/animation harness without a browser.
 * @param {import('node:test').TestContext} t Test owner; required to restore globals after each case.
 * @returns {object} Mutable trigger bounds, observer notifications, and queued animation frames for assertions.
 */
function setup(t) {
    const previousWindow = globalThis.window;
    const previousObserver = globalThis.ResizeObserver;
    const listeners = new Map();
    const frames = new Map();
    const observed = [];
    let notifyResize;
    let disconnected = false;
    let nextFrame = 0;
    globalThis.window = {
        innerWidth: 1000, innerHeight: 800,
        addEventListener: (name, callback) => listeners.set(name, callback),
        removeEventListener: (name) => listeners.delete(name),
        requestAnimationFrame: (callback) => { frames.set(++nextFrame, callback); return nextFrame; },
        cancelAnimationFrame: (id) => frames.delete(id),
    } as any;
    globalThis.ResizeObserver = class {
        constructor(callback) { notifyResize = callback; }
        observe(node) { observed.push(node); }
        disconnect() { disconnected = true; }
    } as any;
    t.after(() => {
        globalThis.window = previousWindow;
        globalThis.ResizeObserver = previousObserver;
    });
    const bounds = { left: 470, right: 500, top: 400, bottom: 438 };
    const anchor = { getBoundingClientRect: () => bounds };
    const actions = {};
    const dialog = {
        querySelector: () => actions,
        getBoundingClientRect: () => ({ left: 100, top: 100, bottom: 600 }),
    };
    const menu = { isConnected: true, hidden: false, style: {}, offsetParent: dialog, offsetWidth: 300, offsetHeight: 160 };
    const stop = observeSessionMenuPosition(dialog as any, () => ({ anchor, menu }) as any);
    return {
        bounds, menu, dialog, actions, frames, observed, listeners, stop,
        notify: () => notifyResize(),
        disconnected: () => disconnected,
        flush: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback()); },
    };
}

test('menu follows the live caret after responsive grid layout and dialog clamping settle', (t) => {
    const h = setup(t);
    assert.deepEqual(h.observed, [h.dialog, h.actions]);
    h.notify();
    h.listeners.get('resize')();
    assert.equal(h.frames.size, 1, 'layout and viewport changes share one frame');
    // The host layout changes after the resize event, before the scheduled measurement.
    Object.assign(h.bounds, { left: 674, right: 704, top: 500, bottom: 538 });
    h.flush();
    assert.equal(h.menu.style.left, '304px');
    assert.equal(h.menu.style.bottom, '108px');
    h.stop();
});

test('closed menus are ignored and disposal cancels queued placement and listeners', (t) => {
    const h = setup(t);
    h.menu.hidden = true;
    h.notify();
    h.flush();
    assert.deepEqual(h.menu.style, {});
    h.menu.hidden = false;
    h.notify();
    h.stop();
    assert.equal(h.frames.size, 0);
    assert.equal(h.listeners.size, 0);
    assert.equal(h.disconnected(), true);
    h.flush();
    assert.deepEqual(h.menu.style, {});
});
