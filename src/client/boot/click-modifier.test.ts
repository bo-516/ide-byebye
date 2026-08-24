import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyKeyboardModifierEvent,
    emptyHeldModifiers,
    isAutoClickModifier,
    matchingClickModifier,
    matchesClickModifier,
    mergeModifierFlags,
    normalizeClickModifier,
    platformDefaultModifier,
    resolveClickModifier,
} from './click-modifier.js';

test('platformDefaultModifier picks meta on macOS, ctrl elsewhere', () => {
    assert.equal(platformDefaultModifier('MacIntel'), 'meta');
    assert.equal(platformDefaultModifier('macOS'), 'meta');
    assert.equal(platformDefaultModifier('Win32'), 'ctrl');
    assert.equal(platformDefaultModifier('Linux x86_64'), 'ctrl');
    assert.equal(platformDefaultModifier(''), 'ctrl');
    assert.equal(platformDefaultModifier(undefined), 'ctrl');
});

test('resolveClickModifier expands the auto sentinel per platform', () => {
    assert.equal(resolveClickModifier('auto', 'MacIntel'), 'meta');
    assert.equal(resolveClickModifier('auto', 'Win32'), 'ctrl');
    // Unset / empty config behaves like 'auto'.
    assert.equal(resolveClickModifier(undefined, 'MacIntel'), 'meta');
    assert.equal(resolveClickModifier('', 'Win32'), 'ctrl');
});

test('resolveClickModifier passes explicit modifiers through untouched', () => {
    assert.equal(resolveClickModifier('alt', 'MacIntel'), 'alt');
    assert.equal(resolveClickModifier('cmd', 'Win32'), 'cmd');
    assert.equal(resolveClickModifier('CTRL', 'MacIntel'), 'ctrl');
});

test('resolveClickModifier treats false/null as an explicit opt-out', () => {
    assert.equal(resolveClickModifier(false, 'MacIntel'), null);
    assert.equal(resolveClickModifier(null, 'Win32'), null);
});

test('isAutoClickModifier treats unset and auto as dual-match, not false/null/explicit', () => {
    assert.equal(isAutoClickModifier(undefined), true);
    assert.equal(isAutoClickModifier('auto'), true);
    assert.equal(isAutoClickModifier(''), true);
    assert.equal(isAutoClickModifier('AUTO'), true);
    assert.equal(isAutoClickModifier(false), false);
    assert.equal(isAutoClickModifier(null), false);
    assert.equal(isAutoClickModifier('meta'), false);
    assert.equal(isAutoClickModifier('ctrl'), false);
});

test('matchingClickModifier keeps auto as auto even when the UA platform is spoofed mobile', () => {
    assert.equal(matchingClickModifier('auto', 'MacIntel'), 'auto');
    assert.equal(matchingClickModifier('auto', 'iPhone'), 'auto');
    assert.equal(matchingClickModifier('auto', 'Linux armv8l'), 'auto');
    assert.equal(matchingClickModifier(undefined, 'iPhone'), 'auto');
    assert.equal(matchingClickModifier('meta', 'iPhone'), 'meta');
    assert.equal(matchingClickModifier(false, 'MacIntel'), null);
});

test('normalizeClickModifier aliases cmd/ctrl and preserves auto', () => {
    assert.equal(normalizeClickModifier('auto'), 'auto');
    assert.equal(normalizeClickModifier('cmd'), 'meta');
    assert.equal(normalizeClickModifier('command'), 'meta');
    assert.equal(normalizeClickModifier('ctrl'), 'control');
    assert.equal(normalizeClickModifier('nope'), null);
});

test('matchesClickModifier auto accepts Command or Ctrl so PC/mobile toggling keeps working', () => {
    assert.equal(matchesClickModifier({ metaKey: true }, 'auto'), true);
    assert.equal(matchesClickModifier({ ctrlKey: true }, 'auto'), true);
    assert.equal(matchesClickModifier({ metaKey: true, ctrlKey: true }, 'auto'), true);
    assert.equal(matchesClickModifier({ altKey: true }, 'auto'), false);
    assert.equal(matchesClickModifier({}, 'auto'), false);
    assert.equal(matchesClickModifier({ ctrlKey: true }, 'meta'), false);
    assert.equal(matchesClickModifier({ metaKey: true }, 'ctrl'), false);
    assert.equal(matchesClickModifier({ metaKey: true }, 'cmd'), true);
});

test('mergeModifierFlags recovers Command dropped by a touch-synthesized click', () => {
    const held = emptyHeldModifiers();
    applyKeyboardModifierEvent(held, { altKey: false, ctrlKey: false, metaKey: true, shiftKey: false });
    assert.equal(held.meta, true);
    const touchClick = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
    const merged = mergeModifierFlags(touchClick, held);
    assert.equal(merged.metaKey, true);
    assert.equal(matchesClickModifier(merged, 'auto'), true);
    assert.equal(matchesClickModifier(merged, 'meta'), true);
    assert.equal(matchesClickModifier(touchClick, 'meta'), false);
});

test('applyKeyboardModifierEvent overwrites bits from the latest keyboard event', () => {
    const held = emptyHeldModifiers();
    applyKeyboardModifierEvent(held, { metaKey: true, ctrlKey: true });
    applyKeyboardModifierEvent(held, { metaKey: false, ctrlKey: false, altKey: true });
    assert.deepEqual(held, { alt: true, ctrl: false, meta: false, shift: false });
});
