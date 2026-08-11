import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildLineStartOffsets,
    lineColumnFromOffset,
    offsetFromLineColumn,
} from './line-offsets.js';

test('buildLineStartOffsets indexes each line start (1-based via index+1)', () => {
    assert.deepEqual(buildLineStartOffsets(''), [0]);
    assert.deepEqual(buildLineStartOffsets('abc'), [0]);
    assert.deepEqual(buildLineStartOffsets('a\nb\nc'), [0, 2, 4]);
    assert.deepEqual(buildLineStartOffsets('line1\nline2\n'), [0, 6, 12]);
});

test('offsetFromLineColumn maps 1-based line + 0-based column', () => {
    const code = 'hello\nworld\n!';
    const offsets = buildLineStartOffsets(code);
    assert.equal(offsetFromLineColumn(offsets, 1, 0), 0);
    assert.equal(offsetFromLineColumn(offsets, 1, 4), 4);
    assert.equal(offsetFromLineColumn(offsets, 2, 0), 6);
    assert.equal(offsetFromLineColumn(offsets, 2, 3), 9);
    assert.equal(offsetFromLineColumn(offsets, 3, 0), 12);
    // Past last line clamps to last start + column.
    assert.equal(offsetFromLineColumn(offsets, 99, 2), 12 + 2);
    // Negative column treated as 0.
    assert.equal(offsetFromLineColumn(offsets, 1, -5), 0);
});

test('lineColumnFromOffset is inverse of offsetFromLineColumn for in-range points', () => {
    const code = 'ab\ncd\nef';
    const offsets = buildLineStartOffsets(code);
    for (let line = 1; line <= 3; line += 1) {
        for (let column = 0; column < 2; column += 1) {
            const off = offsetFromLineColumn(offsets, line, column);
            assert.deepEqual(lineColumnFromOffset(offsets, off), { line, column });
        }
    }
    assert.deepEqual(lineColumnFromOffset(offsets, 0), { line: 1, column: 0 });
    assert.deepEqual(lineColumnFromOffset(offsets, 5), { line: 2, column: 2 });
});
