import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_THEME, THEMES, normalizeTheme } from './theme.js';

test('normalizeTheme accepts light, auto and dark, ignoring case and surrounding spaces', () => {
    assert.equal(normalizeTheme('light'), 'light');
    assert.equal(normalizeTheme('auto'), 'auto');
    assert.equal(normalizeTheme('dark'), 'dark');
    assert.equal(normalizeTheme(' Dark '), 'dark');
    assert.equal(normalizeTheme('AUTO'), 'auto');
});

test('normalizeTheme returns null when the option is unset or not a known theme', () => {
    assert.equal(normalizeTheme(undefined), null);
    assert.equal(normalizeTheme(null), null);
    assert.equal(normalizeTheme(''), null);
    assert.equal(normalizeTheme('system'), null);
    assert.equal(normalizeTheme(true), null);
    assert.equal(normalizeTheme({}), null);
});

test('the default theme is light and is one of the accepted themes', () => {
    assert.equal(DEFAULT_THEME, 'light');
    assert.deepEqual(THEMES, ['light', 'auto', 'dark']);
});
