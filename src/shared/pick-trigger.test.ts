import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_LONG_PRESS, DEFAULT_PICK_BUTTON, normalizeLongPress, normalizePickButton } from './pick-trigger.js';

test('long-press is off unless the option is literally true', () => {
    assert.equal(DEFAULT_LONG_PRESS, false);
    assert.equal(normalizeLongPress(true), true);
    assert.equal(normalizeLongPress(undefined), false);
    assert.equal(normalizeLongPress(false), false);
    assert.equal(normalizeLongPress('true'), false);
    assert.equal(normalizeLongPress(1), false);
});

test('pickButton accepts true, false and touch; anything else is the touch default', () => {
    assert.equal(DEFAULT_PICK_BUTTON, 'touch');
    assert.equal(normalizePickButton(true), true);
    assert.equal(normalizePickButton(false), false);
    assert.equal(normalizePickButton('touch'), 'touch');
    assert.equal(normalizePickButton(' Touch '), 'touch');
    assert.equal(normalizePickButton(undefined), 'touch');
    assert.equal(normalizePickButton(null), 'touch');
    assert.equal(normalizePickButton('always'), 'touch');
    assert.equal(normalizePickButton(0), 'touch');
});
