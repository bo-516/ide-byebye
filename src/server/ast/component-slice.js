/**
 * Pure helpers that slice source text around AST nodes for prompt context.
 *
 * Purpose: turn a hit node / containing component into the same string + range
 * fields that `SourceContext` expects, including truncation markers when a
 * component exceeds `maxComponentLines`.
 *
 * Boundary: pure string math only — no parser, no fs. Nodes must expose
 * `start`/`end` (offsets) and optionally `loc` with 1-based lines. Omitting
 * `loc` falls back to a raw offset slice without truncation by line count.
 */

/**
 * 1-based inclusive slice of a line array, clamped to bounds.
 *
 * @param {string[]} lines Full file lines (0-indexed array).
 * @param {number} startLine 1-based start.
 * @param {number} endLine 1-based end inclusive.
 * @returns {string}
 */
export function sliceLines(lines, startLine, endLine) {
    const s = Math.max(1, startLine);
    const e = Math.min(lines.length, endLine);
    return lines.slice(s - 1, e).join('\n');
}

/**
 * Slice source by node offsets.
 *
 * @param {string} code Full source.
 * @param {{ start?: number|null, end?: number|null }} node AST node with ranges.
 * @returns {string|undefined}
 */
export function codeSlice(code, node) {
    if (node.start == null || node.end == null)
        return undefined;
    return code.slice(node.start, node.end);
}

/**
 * Line range from a node that has Babel-style `loc`, or line-offset map + offsets.
 *
 * @param {{ loc?: { start: { line: number }, end: { line: number } }, start?: number|null, end?: number|null }} node
 * @param {((offset: number) => { line: number })|undefined} offsetToLine Optional converter when `loc` is missing.
 * @returns {{ startLine: number, endLine: number }|undefined}
 */
export function nodeRange(node, offsetToLine) {
    if (node?.loc) {
        return { startLine: node.loc.start.line, endLine: node.loc.end.line };
    }
    if (offsetToLine && node?.start != null && node?.end != null) {
        // end is exclusive; last character of the node is at end - 1 (or start if empty).
        const endPos = Math.max(node.start, node.end - 1);
        return {
            startLine: offsetToLine(node.start).line,
            endLine: offsetToLine(endPos).line,
        };
    }
    return undefined;
}

/**
 * Cap a component slice around the hit line, keeping it valid-ish source.
 *
 * Purpose: large components would blow the prompt budget; we keep a window
 * centered on the hit with the same truncation markers Babel used.
 *
 * @param {string} code Full source.
 * @param {string[]} lines Split lines.
 * @param {{ loc?: { start: { line: number }, end: { line: number } }, start?: number|null, end?: number|null }} node
 * @param {number} hitLine 1-based hit line.
 * @param {number} maxComponentLines Max lines to keep.
 * @param {((offset: number) => { line: number })|undefined} offsetToLine Used when node has no `loc`.
 * @returns {string|undefined}
 */
export function cappedComponentCode(code, lines, node, hitLine, maxComponentLines, offsetToLine) {
    const range = nodeRange(node, offsetToLine);
    if (!range) {
        return codeSlice(code, node);
    }
    const startLine = range.startLine;
    const endLine = range.endLine;
    const total = endLine - startLine + 1;
    if (total <= maxComponentLines) {
        return codeSlice(code, node);
    }
    const half = Math.floor(maxComponentLines / 2);
    let windowStart = Math.max(startLine, hitLine - half);
    let windowEnd = Math.min(endLine, windowStart + maxComponentLines - 1);
    windowStart = Math.max(startLine, windowEnd - maxComponentLines + 1);
    const body = sliceLines(lines, windowStart, windowEnd);
    const head = windowStart > startLine ? '// … (component truncated above)\n' : '';
    const tail = windowEnd < endLine ? '\n// … (component truncated below)' : '';
    return head + body + tail;
}
