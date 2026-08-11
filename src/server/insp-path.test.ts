import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { parseInspPath } from './insp-path.js';

test('parseInspPath accepts colon form with optional tag suffix', () => {
    assert.deepEqual(parseInspPath('/abs/src/App.tsx:12:8'), {
        file: path.normalize('/abs/src/App.tsx'),
        line: 12,
        column: 8,
    });
    assert.deepEqual(parseInspPath('/abs/src/App.tsx:12:8:button'), {
        file: path.normalize('/abs/src/App.tsx'),
        line: 12,
        column: 8,
    });
});

test('parseInspPath accepts query-string form and line-only form', () => {
    assert.deepEqual(parseInspPath('/abs/src/App.tsx?line=12&column=8'), {
        file: path.normalize('/abs/src/App.tsx'),
        line: 12,
        column: 8,
    });
    assert.deepEqual(parseInspPath('/abs/src/App.tsx?l=3&c=2'), {
        file: path.normalize('/abs/src/App.tsx'),
        line: 3,
        column: 2,
    });
    assert.deepEqual(parseInspPath('/abs/src/App.tsx:7'), {
        file: path.normalize('/abs/src/App.tsx'),
        line: 7,
        column: 1,
    });
    // Missing column in query defaults to 1.
    assert.deepEqual(parseInspPath('/abs/src/App.tsx?line=9'), {
        file: path.normalize('/abs/src/App.tsx'),
        line: 9,
        column: 1,
    });
});

test('parseInspPath accepts file:// URLs', () => {
    const parsed = parseInspPath('file:///Users/dev/App.tsx:4:2');
    assert.equal(parsed.line, 4);
    assert.equal(parsed.column, 2);
    assert.ok(parsed.file.includes('App.tsx'));
});

test('parseInspPath rejects empty or unparseable values', () => {
    assert.throws(() => parseInspPath(''), /Empty/);
    assert.throws(() => parseInspPath(null), /Empty/);
    assert.throws(() => parseInspPath('/no/coords/here'), /Cannot parse/);
    assert.throws(() => parseInspPath('/x?line=abc'), /missing a valid line/);
    assert.throws(() => parseInspPath('/x:0:1'), /invalid line/);
});
