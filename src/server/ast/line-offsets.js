/**
 * Pure line↔offset helpers for AST position math.
 *
 * Purpose: Babel exposes `loc` (1-based line, 0-based column) while oxc exposes
 * byte-offset-compatible UTF-16 `start`/`end`. These helpers keep both engines
 * on one mapping so hit detection stays equivalent.
 *
 * Boundary: no I/O, no globals. Offsets are JS string indices (UTF-16 code units),
 * matching `String.prototype.slice` and both parsers' `start`/`end` fields.
 * Passing a wrong line (0 or beyond last line) yields clamped or out-of-range
 * offsets that must not be used as truth without a bounds check by the caller.
 */

/**
 * Build an array of start offsets for each 1-based line (index 0 unused-style:
 * `lineStartOffsets[0]` is offset of line 1).
 *
 * @param {string} code Full source text.
 * @returns {number[]} `lineStartOffsets[line - 1]` is the start offset of that line.
 */
export function buildLineStartOffsets(code) {
    const offsets = [0];
    for (let i = 0; i < code.length; i++) {
        if (code.charCodeAt(i) === 10 /* \n */) {
            offsets.push(i + 1);
        }
    }
    return offsets;
}

/**
 * Convert 1-based line + 0-based column to a UTF-16 string offset.
 *
 * Boundary: Babel columns are 0-based — do not add 1. Column may exceed the line
 * length (e.g. click past EOL); the raw sum is returned so containment checks
 * match Babel's loc math.
 *
 * @param {number[]} lineStartOffsets From {@link buildLineStartOffsets}.
 * @param {number} line 1-based line number.
 * @param {number} column 0-based column.
 * @returns {number} Offset into the source string.
 */
export function offsetFromLineColumn(lineStartOffsets, line, column) {
    const idx = Math.max(0, line - 1);
    if (idx >= lineStartOffsets.length) {
        const last = lineStartOffsets[lineStartOffsets.length - 1] ?? 0;
        return last + Math.max(0, column);
    }
    return lineStartOffsets[idx] + Math.max(0, column);
}

/**
 * Convert a UTF-16 offset back to 1-based line and 0-based column.
 *
 * @param {number[]} lineStartOffsets From {@link buildLineStartOffsets}.
 * @param {number} offset UTF-16 code unit offset.
 * @returns {{ line: number, column: number }}
 */
export function lineColumnFromOffset(lineStartOffsets, offset) {
    let lo = 0;
    let hi = lineStartOffsets.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStartOffsets[mid] <= offset) {
            lo = mid;
        }
        else {
            hi = mid - 1;
        }
    }
    return {
        line: lo + 1,
        column: offset - lineStartOffsets[lo],
    };
}
