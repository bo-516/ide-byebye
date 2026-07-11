import assert from 'node:assert/strict';
import test from 'node:test';
import { Dialog } from './dialog.js';

// Both are plain positioning helpers on the prototype — they read only their arguments plus `window`, never instance
// state — so they can be exercised in isolation with a mock viewport and a stand-in dialog element.
const positionDialog = Dialog.prototype.positionDialog;
const keepDialogInView = Dialog.prototype.keepDialogInView;

/**
 * A minimal stand-in for the dialog element. `getBoundingClientRect()` reports the given box, and `style.top`/`left`
 * capture what the method writes back. The dialog's `style` coordinates equal viewport coordinates in the real UI
 * because the shadow host is a `position: fixed; inset: 0` box, so the mock uses one coordinate space throughout.
 */
function makeDialog({ left = 100, top = 100, width = 400, height = 400 }) {
    const style = {};
    return {
        style,
        getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }),
        get top() { return Math.round(parseFloat(style.top)); },
        get left() { return Math.round(parseFloat(style.left)); },
    };
}

/** Run `fn` with a mocked viewport, restoring any prior global `window` afterward. */
function withViewport(innerWidth, innerHeight, fn) {
    const prev = globalThis.window;
    globalThis.window = { innerWidth, innerHeight };
    try {
        fn();
    }
    finally {
        globalThis.window = prev;
    }
}

test('positionDialog re-anchors from the live height — the jump the fix stops routing content changes through', () => {
    withViewport(1200, 800, () => {
        // Click low in the viewport, so the dialog opens ABOVE the point (topY branch): top = anchor.y - height - 14.
        const anchor = { x: 600, y: 700 };
        const small = makeDialog({ width: 400, height: 400 });
        positionDialog.call(null, small, anchor);
        assert.equal(small.top, 286);

        // Ticking a style property adds the preview chip → the dialog grows 40px. Re-running positionDialog re-derives
        // the top from the new height, so the box hops upward even though the user only toggled a checkbox.
        const grown = makeDialog({ width: 400, height: 440 });
        positionDialog.call(null, grown, anchor);
        assert.equal(grown.top, 246);
        assert.notEqual(grown.top, small.top); // the visible jump the bug report describes
    });
});

test('keepDialogInView holds the top fixed when grown content still fits — no jump', () => {
    withViewport(1200, 800, () => {
        // The dialog is already anchored at top=286; adding the chip grows it to 440 tall, but its top edge has not
        // moved (content expands downward). keepDialogInView must leave the top where it is.
        const dialog = makeDialog({ left: 300, top: 286, width: 400, height: 440 });
        keepDialogInView.call(null, dialog);
        assert.equal(dialog.top, 286);
        assert.equal(dialog.left, 300);
    });
});

test('keepDialogInView pulls the dialog up only when growth overflows the viewport bottom', () => {
    withViewport(1200, 800, () => {
        // Grown so tall its bottom (286 + 700 = 986) crosses the viewport minus margin (788): clamp the top to the
        // largest value that keeps it fully visible — maxY = 800 - 700 - 12 = 88 — a one-time pull-in, not a re-anchor.
        const dialog = makeDialog({ left: 300, top: 286, width: 400, height: 700 });
        keepDialogInView.call(null, dialog);
        assert.equal(dialog.top, 88);
    });
});

test('keepDialogInView clamps a dialog that grew past the right edge back inside, leaving a fitting top alone', () => {
    withViewport(1200, 800, () => {
        const dialog = makeDialog({ left: 1000, top: 100, width: 400, height: 300 });
        keepDialogInView.call(null, dialog);
        assert.equal(dialog.left, 788); // right would be 1400 > 1188 → clamp left to maxX = 1200 - 400 - 12 = 788
        assert.equal(dialog.top, 100); // top already fits → untouched
    });
});
