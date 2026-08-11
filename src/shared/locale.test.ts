import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLocale } from './locale.js';

test('normalizeLocale maps zh* to zh and other languages to en', () => {
    assert.equal(normalizeLocale('zh'), 'zh');
    assert.equal(normalizeLocale('zh-CN'), 'zh');
    assert.equal(normalizeLocale('ZH-Hant'), 'zh');
    assert.equal(normalizeLocale('en'), 'en');
    assert.equal(normalizeLocale('en-US'), 'en');
    assert.equal(normalizeLocale('fr-FR'), 'en');
    assert.equal(normalizeLocale('ja'), 'en');
});

test('normalizeLocale returns null for empty or non-string values', () => {
    assert.equal(normalizeLocale(null), null);
    assert.equal(normalizeLocale(undefined), null);
    assert.equal(normalizeLocale(''), null);
    assert.equal(normalizeLocale('   '), null);
    assert.equal(normalizeLocale(42), null);
    assert.equal(normalizeLocale({}), null);
});
