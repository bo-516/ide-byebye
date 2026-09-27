import assert from 'node:assert/strict';
import test from 'node:test';
import { DialogSessionController } from './dialog-session-picker.js';

/** UI-only action used by controller renders; its name must match the fixture's target map. */
const ACTION = { name: 'codex-app', label: 'Codex App' };

/** Ignore DOM hooks unrelated to geometry; accepts any arguments and returns nothing. */
function ignore(..._args) {}

/**
 * Create only the DOM surface used by menu rendering; this intentionally does not simulate CSS or events.
 * @param {string} _tag Required DOM tag, ignored because node identity does not affect these positioning assertions.
 * @returns {any} Mutable node that retains rendered children for measuring the fixture menu.
 */
function makeNode(_tag) {
    return {
        children: [], className: '', style: {}, hidden: false, scrollTop: 0,
        classList: { add: ignore, toggle: ignore }, addEventListener: ignore, setAttribute: ignore,
        /** Append required child nodes in DOM order; wrong children invalidate the fixture measurement. */
        append(...children) { this.children.push(...children); },
        /** Replace required child nodes, matching a menu repaint without retaining old rows. */
        replaceChildren(...children) { this.children = children; },
    };
}

/**
 * Install a minimal browser boundary and always restore previous globals, even after a failed assertion.
 * @param {number} width Required viewport width in CSS pixels; invalid values invalidate placement assertions.
 * @param {number} height Required viewport height in CSS pixels.
 * @param {Function} run Required synchronous test body; asynchronous bodies would outlive these globals.
 * @returns {void}
 */
function withDOM(width, height, run) {
    const saved = ['window', 'document'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { innerWidth: width, innerHeight: height } });
    Object.defineProperty(globalThis, 'document', {
        configurable: true, value: { createElement: makeNode, addEventListener: ignore, removeEventListener: ignore },
    });
    try { run(); }
    finally {
        for (const [key, descriptor] of saved) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    }
}

/**
 * Build a real controller prototype around deterministic DOM measurements, with the menu parented to the dialog.
 * @param {number} width Optional menu width, default 380px; invalid widths invalidate visual-edge assertions.
 * @param {object} dialog Optional viewport bounds of the positioned dialog; malformed bounds invalidate offsets.
 * @returns {any} Controller fixture; its caret is supplied by each test before painting.
 */
function makeController(width = 380, dialog = { left: 400, top: 150, right: 1040, bottom: 640 }) {
    const footer = { getBoundingClientRect: () => ({ left: 400, top: 408, right: 1040, bottom: 640 }) };
    const dialogEl = { getBoundingClientRect: () => dialog, querySelector: () => footer };
    const menuEl = Object.assign(makeNode('div'), {
        offsetParent: dialogEl, parentElement: dialogEl, offsetWidth: width,
    });
    Object.defineProperty(menuEl, 'offsetHeight', {
        /** Measure rendered rows so loading/results alter height without prescribing any resulting position. */
        get() {
            const rows = menuEl.children[2]?.children.filter((node) => node.className === 'cii-session-row').length ?? 0;
            return Math.min(320, 96 + rows * 48);
        },
    });
    return Object.assign(Object.create(DialogSessionController.prototype), {
        dialogEl, menuEl, targets: {}, busy: false, menuState: null,
    });
}

/**
 * Set the active caret to a new grid cell without moving the dialog or footer.
 * @param {any} controller Required fixture controller; missing it prevents the actual controller render.
 * @param {number} right Required viewport right edge of the 30px caret.
 * @param {number} top Required viewport top edge of the 38px caret.
 * @returns {void}
 */
function moveCaret(controller, right, top) {
    controller.openCaret = { getBoundingClientRect: () => ({ left: right - 30, right, top, bottom: top + 38 }) };
}

/**
 * Resolve rendered menu offsets into viewport edges, independently of the production placement helper.
 * @param {any} controller Required painted fixture; omitted or unpainted nodes produce invalid coordinates.
 * @returns {{ left: number, right: number, top: number, bottom: number }} Visual menu bounds.
 */
function menuBounds(controller) {
    const menu = controller.menuEl;
    const parent = menu.offsetParent.getBoundingClientRect();
    const height = menu.style.maxHeight ? Math.min(menu.offsetHeight, parseFloat(menu.style.maxHeight)) : menu.offsetHeight;
    const left = parent.left + parseFloat(menu.style.left);
    const top = menu.style.top === 'auto'
        ? parent.bottom - parseFloat(menu.style.bottom) - height
        : parent.top + parseFloat(menu.style.top);
    return { left, right: left + menu.offsetWidth, top, bottom: top + height };
}

test('controller anchors the menu to the opened caret across different columns and rows', () => {
    withDOM(1440, 1000, () => {
        const controller = makeController();
        for (const [right, top] of [[600, 500], [1000, 500], [600, 546]]) {
            moveCaret(controller, right, top);
            controller.paintMenu(ACTION, { loading: true });
            assert.equal(menuBounds(controller).right, right);
            assert.equal(menuBounds(controller).bottom, top - 8);
            assert.equal(controller.menuButtons.length, 1);
        }
    });
});

test('loading and result repaints remeasure at the same caret and clear stale vertical offsets', () => {
    withDOM(1440, 1000, () => {
        const controller = makeController();
        moveCaret(controller, 800, 200);
        controller.paintMenu(ACTION, { loading: true });
        assert.equal(menuBounds(controller).bottom, 192);
        const sessions = Array.from({ length: 6 }, (_, index) => ({ id: String(index), title: `Session ${index}` }));
        controller.menuEl.scrollTop = 12;
        controller.paintMenu(ACTION, { res: { sessions } });
        assert.equal(menuBounds(controller).top, 246);
        assert.equal(menuBounds(controller).right, 800);
        assert.equal(controller.menuEl.style.bottom, 'auto');
        assert.equal(controller.menuEl.scrollTop, 12);
        assert.equal(controller.menuButtons.length, 7);
        controller.paintMenu(ACTION, { loading: true, res: { sessions } });
        assert.equal(menuBounds(controller).top, 246);
        controller.paintMenu(ACTION, { res: { sessions: [] } });
        assert.equal(menuBounds(controller).bottom, 192);
        assert.equal(controller.menuEl.style.top, 'auto');
    });
});

test('controller keeps an edge-triggered menu inside a narrow, short viewport', () => {
    withDOM(360, 420, () => {
        const controller = makeController(336, { left: 12, top: 90, right: 348, bottom: 400 });
        moveCaret(controller, 60, 230);
        controller.paintMenu(ACTION, { res: { sessions: Array.from({ length: 6 }, (_, index) => ({ id: String(index) })) } });
        const bounds = menuBounds(controller);
        assert.equal(bounds.left, 8);
        assert.equal(bounds.right, 344);
        assert.equal(bounds.top, 8);
        assert.equal(bounds.bottom, 222);
        assert.equal(controller.menuEl.style.maxHeight, '214px');
        assert.equal(controller.menuEl.style.overflowY, 'auto');
    });
});

test('reattaching the controller releases placement and discards the detached menu', () => {
    withDOM(1440, 1000, () => {
        const controller = new DialogSessionController({});
        const previousMenu = makeNode('div');
        const nextDialog = makeNode('div');
        let stops = 0;
        controller.menuEl = previousMenu;
        controller.menuAgent = ACTION.name;
        controller.openCaret = makeNode('button');
        controller.stopPositioning = () => { stops++; };
        controller.attach(nextDialog);
        assert.equal(stops, 1);
        assert.equal(previousMenu.hidden, true);
        assert.equal(controller.menuEl, null);
        assert.equal(controller.openCaret, null);
        assert.equal(controller.dialogEl, nextDialog);
        controller.dispose();
        assert.equal(stops, 1);
    });
});
