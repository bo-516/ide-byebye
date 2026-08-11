/**
 * Best-effort Vue SFC source extraction for intent prompts.
 *
 * Purpose: neither Babel nor oxc can parse a full `.vue` file, so a naive JSX path always failed with
 * "No JSX element found". Templates are sliced by line (open-tag walk); `<script>` blocks optionally
 * re-use the caller's JSX extractor with line offsets.
 *
 * Boundary: not a replacement for `@vue/compiler-dom`. Nested slots, pug templates, and multi-root fragments may yield
 * a wider-than-ideal slice, but the prompt always gets a useful excerpt + `fileLanguage: 'vue'` instead of an AST error.
 */

/** 1-based inclusive slice of a line array, clamped to bounds. */
function sliceLines(lines, startLine, endLine) {
    const s = Math.max(1, startLine);
    const e = Math.min(lines.length, endLine);
    return lines.slice(s - 1, e).join('\n');
}

/**
 * Split a Vue SFC into top-level blocks with 1-based line ranges.
 *
 * Boundary: regex-based, not a full SFC compiler. Handles the common
 * `<template>` / `<script>` / `<script setup>` / `<style>` layout (including attributes).
 *
 * @param {string} code Full `.vue` file source.
 * @returns {Array<{ type: string, attrs: string, content: string, startLine: number, endLine: number, contentStartLine: number }>}
 */
function parseVueSfcBlocks(code) {
    const blocks = [];
    const re = /<(template|script|style)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
    let match;
    while ((match = re.exec(code)) !== null) {
        const full = match[0];
        const type = match[1].toLowerCase();
        const attrs = (match[2] || '').trim();
        const content = match[3];
        const openTag = full.slice(0, full.indexOf('>') + 1);
        const startOffset = match.index;
        const contentOffset = startOffset + openTag.length;
        const startLine = code.slice(0, startOffset).split('\n').length;
        const contentStartLine = code.slice(0, contentOffset).split('\n').length;
        const endLine = code.slice(0, startOffset + full.length).split('\n').length;
        blocks.push({ type, attrs, content, startLine, endLine, contentStartLine });
    }
    return blocks;
}

/**
 * Expand a hit line inside a Vue `<template>` into a reasonable element slice.
 *
 * @param {string[]} lines Full file lines (0-indexed array).
 * @param {number} hitLine 1-based hit line.
 * @param {{ startLine: number, endLine: number, contentStartLine: number }} block Template block bounds.
 * @param {number} maxComponentLines Cap on returned lines.
 * @returns {{ code: string, startLine: number, endLine: number }}
 */
function extractVueTemplateNode(lines, hitLine, block, maxComponentLines) {
    const blockStart = block.contentStartLine;
    const blockEnd = block.endLine - 1;
    const lo = Math.max(blockStart, 1);
    const hi = Math.max(lo, Math.min(blockEnd, lines.length));
    const line = Math.min(Math.max(hitLine, lo), hi);

    let start = line;
    for (let i = line; i >= lo; i--) {
        const text = lines[i - 1];
        if (/<[A-Za-z][\w:-]*/.test(text) && !/^\s*<\//.test(text)) {
            start = i;
            break;
        }
    }

    const openText = lines[start - 1] || '';
    const tagMatch = openText.match(/<([A-Za-z][\w:-]*)/);
    const tag = tagMatch?.[1];
    const selfClosing = /\/>\s*$/.test(openText.trim()) || !tag;

    let end = start;
    if (!selfClosing && tag) {
        const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
        let depth = 0;
        for (let i = start; i <= hi; i++) {
            const text = lines[i - 1];
            const opens = (text.match(new RegExp(`<${tag}(\\s|>)`, 'gi')) || []).length;
            const selfs = (text.match(new RegExp(`<${tag}\\b[^>]*/>`, 'gi')) || []).length;
            const closes = (text.match(closeRe) || []).length;
            depth += (opens - selfs) - closes;
            end = i;
            if (i > start && depth <= 0) {
                break;
            }
            if (i === start && closeRe.test(text) && opens <= closes) {
                break;
            }
        }
    }

    if (end - start + 1 > maxComponentLines) {
        const half = Math.floor(maxComponentLines / 2);
        start = Math.max(start, hitLine - half);
        end = Math.min(end, start + maxComponentLines - 1);
        start = Math.max(blockStart, end - maxComponentLines + 1);
    }

    return {
        code: sliceLines(lines, start, end),
        startLine: start,
        endLine: end,
    };
}

/**
 * Extract source context specialized for Vue SFCs.
 *
 * @param {object} args
 * @param {string} args.code Full file source.
 * @param {string[]} args.lines Split lines.
 * @param {number} args.line 1-based hit line.
 * @param {number} args.column 0-based hit column.
 * @param {number} args.maxContextLines Excerpt window size (unused for templates; reserved for script JSX).
 * @param {number} args.maxComponentLines Cap for selected node / component slices.
 * @param {object} args.base Partial SourceContext already filled with path/language/excerpt.
 * @param {(code: string, line: number, column: number, maxContextLines: number, maxComponentLines: number) => object} [args.extractJsx]
 *        Optional pure-JSX extractor for `<script>` blocks that contain JSX render functions.
 * @returns {object} Enriched SourceContext.
 */
export function extractVueSourceContext({
    code,
    lines,
    line,
    column,
    maxContextLines,
    maxComponentLines,
    base,
    extractJsx,
}) {
    const blocks = parseVueSfcBlocks(code);
    const hit = blocks.find((b) => line >= b.startLine && line <= b.endLine);

    if (!hit) {
        base.astError = 'Click landed outside <template>/<script>/<style> in the Vue SFC';
        return base;
    }

    if (hit.type === 'template') {
        const node = extractVueTemplateNode(lines, line, hit, maxComponentLines);
        base.selectedNodeCode = node.code;
        base.selectedNodeRange = { startLine: node.startLine, endLine: node.endLine };
        const tplStart = hit.contentStartLine;
        const tplEnd = Math.max(tplStart, hit.endLine - 1);
        const total = tplEnd - tplStart + 1;
        if (total <= maxComponentLines) {
            base.containingComponentCode = sliceLines(lines, tplStart, tplEnd);
            base.containingComponentRange = { startLine: tplStart, endLine: tplEnd };
        }
        else {
            const half = Math.floor(maxComponentLines / 2);
            let wStart = Math.max(tplStart, line - half);
            let wEnd = Math.min(tplEnd, wStart + maxComponentLines - 1);
            wStart = Math.max(tplStart, wEnd - maxComponentLines + 1);
            base.containingComponentCode = sliceLines(lines, wStart, wEnd);
            base.containingComponentRange = { startLine: wStart, endLine: wEnd };
        }
        base.startLine = Math.min(base.startLine, node.startLine);
        base.endLine = Math.max(base.endLine, node.endLine);
        return base;
    }

    if (hit.type === 'script') {
        const scriptCode = hit.content;
        const offset = hit.contentStartLine - 1;
        if (typeof extractJsx === 'function') {
            try {
                const inner = extractJsx(scriptCode, line - offset, column, maxContextLines, maxComponentLines);
                if (inner.selectedNodeCode) {
                    base.selectedNodeCode = inner.selectedNodeCode;
                    if (inner.selectedNodeRange) {
                        base.selectedNodeRange = {
                            startLine: inner.selectedNodeRange.startLine + offset,
                            endLine: inner.selectedNodeRange.endLine + offset,
                        };
                    }
                }
                if (inner.containingComponentCode) {
                    base.containingComponentCode = inner.containingComponentCode;
                    if (inner.containingComponentRange) {
                        base.containingComponentRange = {
                            startLine: inner.containingComponentRange.startLine + offset,
                            endLine: inner.containingComponentRange.endLine + offset,
                        };
                    }
                }
                if (inner.importsCode) {
                    base.importsCode = inner.importsCode;
                }
                if (inner.astError && !base.selectedNodeCode) {
                    base.containingComponentCode = scriptCode.trim();
                    base.containingComponentRange = {
                        startLine: hit.contentStartLine,
                        endLine: Math.max(hit.contentStartLine, hit.endLine - 1),
                    };
                    delete base.astError;
                }
                return base;
            }
            catch {
                // fall through to whole-script slice
            }
        }
        base.containingComponentCode = scriptCode.trim();
        base.containingComponentRange = {
            startLine: hit.contentStartLine,
            endLine: Math.max(hit.contentStartLine, hit.endLine - 1),
        };
        return base;
    }

    base.astError = `Click landed in <${hit.type}>; no template element to extract`;
    return base;
}
