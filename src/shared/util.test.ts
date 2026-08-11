import assert from 'node:assert/strict';
import test from 'node:test';
import { collapseWhitespace, truncateSnippet } from './util.js';

test('truncateSnippet returns undefined for nullish or empty input', () => {
    assert.equal(truncateSnippet(null, 10), undefined);
    assert.equal(truncateSnippet(undefined, 10), undefined);
    assert.equal(truncateSnippet('', 10), undefined);
});

test('truncateSnippet returns short strings unchanged', () => {
    assert.equal(truncateSnippet('hello', 10), 'hello');
    assert.equal(truncateSnippet('exactly10!', 10), 'exactly10!');
});

test('truncateSnippet appends a dropped-char marker when over max', () => {
    assert.equal(truncateSnippet('abcdefghijklmnop', 5), 'abcde… [+11 chars truncated]');
    assert.equal(truncateSnippet(1234567890, 4), '1234… [+6 chars truncated]');
});

test('collapseWhitespace trims and collapses runs of whitespace', () => {
    assert.equal(collapseWhitespace('  a   b\tc\n d  '), 'a b c d');
    assert.equal(collapseWhitespace('single'), 'single');
    assert.equal(collapseWhitespace('\n\t  '), '');
});
