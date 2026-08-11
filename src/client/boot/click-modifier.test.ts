import assert from 'node:assert/strict';
import test from 'node:test';
import { platformDefaultModifier, resolveClickModifier } from './click-modifier.js';

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
