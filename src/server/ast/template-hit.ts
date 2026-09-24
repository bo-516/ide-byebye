/**
 * Shared hit selection + field building for template-language locators (Vue, Svelte).
 *
 * Purpose: every template parser reduces its AST to flat element spans (absolute `[start, end)` offsets). This module
 * owns the one rule for turning a `data-insp-path` position into a hit and the one mapping from hit spans to
 * `SourceContext` fields, so each framework locator stays a thin AST adapter.
 *
 * Boundary: pure string math (no parser, no fs). Positions follow code-inspector's convention for template files:
 * 1-based line and 1-based column pointing at the element's opening `<`.
 */

import { cappedComponentCode, nodeRange } from './component-slice.js';
import { offsetFromLineColumn } from './line-offsets.js';

/** One element (or block) span in absolute UTF-16 offsets; `end` is exclusive. */
export interface ElementSpan {
    start: number;
    end: number;
}

/**
 * Convert a code-inspector template position (1-based line + column) into an absolute offset.
 *
 * Boundary: columns below 1 clamp to the first character of the line, matching `parseInspPath`'s normalization.
 *
 * @param {number[]} lineStartOffsets From `buildLineStartOffsets`.
 * @param {number} line 1-based line.
 * @param {number} column 1-based column of the opening `<`.
 * @returns {number} Offset of that character.
 */
export function templateOffset(lineStartOffsets: number[], line: number, column: number) {
    return offsetFromLineColumn(lineStartOffsets, line, Math.max(1, column) - 1);
}

/**
 * Pick the element a `data-insp-path` position refers to.
 *
 * Purpose: code-inspector stamps each element with the exact position of its opening `<`, so an element starting at
 * `offset` is the answer. The containment and same-line fallbacks only matter when the file changed after the page
 * rendered (stale attribute) — they keep the prompt anchored near the click instead of failing.
 *
 * @param {ElementSpan[]} spans Candidate element spans (any order).
 * @param {number} offset Absolute offset of the clicked element's `<` (see {@link templateOffset}).
 * @param {number} line 1-based line used by the same-line fallback.
 * @param {(offset: number) => { line: number }} offsetToLine Offset → line converter for the same source.
 * @returns {ElementSpan | null} Exact match, else tightest span containing `offset`, else tightest span covering
 *   `line`, else `null`.
 */
export function pickTemplateHit<T extends ElementSpan>(spans: T[], offset: number, line: number, offsetToLine) {
    let containing: T | null = null;
    let onLine: T | null = null;
    for (const span of spans) {
        if (span.start === offset)
            return span;
        const size = span.end - span.start;
        if (span.start <= offset && offset < span.end) {
            if (!containing || size < containing.end - containing.start)
                containing = span;
            continue;
        }
        const startLine = offsetToLine(span.start).line;
        const endLine = offsetToLine(Math.max(span.start, span.end - 1)).line;
        if (startLine <= line && line <= endLine && (!onLine || size < onLine.end - onLine.start))
            onLine = span;
    }
    return containing ?? onLine;
}

/**
 * Build the selected-node and containing-block fields for a template hit.
 *
 * @param {string} code Full file source.
 * @param {string[]} lines `code` split on `\n`.
 * @param {ElementSpan} hit Selected element span.
 * @param {ElementSpan | null} container Enclosing block (e.g. the SFC `<template>` or Svelte markup range); `null`
 *   omits the containing-component fields.
 * @param {number} hitLine 1-based click line; oversized slices are windowed around it.
 * @param {number} maxComponentLines Line cap for both slices (truncation markers added beyond it).
 * @param {(offset: number) => { line: number }} offsetToLine Offset → line converter for `code`.
 * @returns {Record<string, unknown>} `selectedNode*` and (when `container` is set) `containingComponent*` fields.
 */
export function templateHitFields(code, lines, hit: ElementSpan, container: ElementSpan | null, hitLine, maxComponentLines, offsetToLine) {
    const out: Record<string, unknown> = {
        selectedNodeCode: cappedComponentCode(code, lines, hit, hitLine, maxComponentLines, offsetToLine),
        selectedNodeRange: nodeRange(hit, offsetToLine),
    };
    if (container) {
        out.containingComponentCode = cappedComponentCode(code, lines, container, hitLine, maxComponentLines, offsetToLine);
        out.containingComponentRange = nodeRange(container, offsetToLine);
    }
    return out;
}

/**
 * Build `importsCode` / `importsRange` from an absolute import block.
 *
 * @param {{ code: string, start: number, end: number } | null} block Result of `extractScriptImports`.
 * @param {(offset: number) => { line: number }} offsetToLine Offset → line converter for the whole file.
 * @returns {Record<string, unknown>} Import fields, or an empty object when `block` is `null`.
 */
export function importFields(block: { code: string, start: number, end: number } | null, offsetToLine) {
    if (!block)
        return {};
    return {
        importsCode: block.code,
        importsRange: nodeRange(block, offsetToLine),
    };
}
