import assert from 'node:assert/strict';
import test from 'node:test';
import { LABEL_GAP, VIEWPORT_MARGIN, formatBoxSize, formatLineColumn, placeLabel } from './overlay-layout.js';

const viewport = { width: 1200, height: 800 };
const label = { width: 200, height: 22 };

/** Viewport rect from left / top / width / height. */
function box(left: number, top: number, width: number, height: number) {
    return { left, top, right: left + width, bottom: top + height };
}

test('the label sits above the box, start-aligned, when there is room', () => {
    assert.deepEqual(placeLabel(box(100, 200, 300, 50), label, viewport), { left: 100, top: 200 - LABEL_GAP - 22 });
});

test('a box at the top of the viewport gets its label below', () => {
    assert.deepEqual(placeLabel(box(100, 10, 300, 50), label, viewport), { left: 100, top: 60 + LABEL_GAP });
});

test('a box covering the viewport height gets its label inside the top-left corner', () => {
    assert.deepEqual(placeLabel(box(0, -40, 1200, 1000), label, viewport), { left: LABEL_GAP, top: LABEL_GAP });
});

test('a box near the right edge end-aligns its label', () => {
    const placed = placeLabel(box(1100, 300, 90, 40), label, viewport);
    assert.equal(placed.left, 1190 - 200);
});

test('the label never starts left of the viewport margin', () => {
    assert.equal(placeLabel(box(-60, 300, 400, 40), label, viewport).left, VIEWPORT_MARGIN);
    assert.equal(placeLabel(box(0, 300, 40, 40), { width: 2000, height: 22 }, viewport).left, VIEWPORT_MARGIN);
});

test('line / column suffix and size readout', () => {
    assert.equal(formatLineColumn(99, 9), ':99:9');
    assert.equal(formatLineColumn(99), ':99');
    assert.equal(formatLineColumn(undefined, 9), '');
    assert.equal(formatBoxSize(1923.6, 1120.2), '1924 × 1120');
});
