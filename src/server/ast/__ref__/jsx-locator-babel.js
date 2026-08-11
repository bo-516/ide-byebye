/**
 * Frozen Babel-based JSX extract — test-only reference for parity diffs.
 *
 * Purpose: snapshot of the pre-oxc `extractJsxFromCode` behavior so the
 * shipped locator can be compared field-by-field. Not imported by production.
 *
 * Boundary: only tests may import this module. Remove after burn-in (design
 * doc phase 4). Throws on parse failures the same way the historical Babel
 * path did; callers that need SourceContext-style degradation should catch.
 */

import { parse } from '@babel/parser';
import traverseImport from '@babel/traverse';

const traverse = (traverseImport.default ?? traverseImport);

const PARSER_PLUGINS = [
    'jsx',
    'typescript',
    'decorators-legacy',
    'classProperties',
    'objectRestSpread',
    'optionalChaining',
    'nullishCoalescingOperator',
];

function sliceLines(lines, startLine, endLine) {
    const s = Math.max(1, startLine);
    const e = Math.min(lines.length, endLine);
    return lines.slice(s - 1, e).join('\n');
}

function nodeContains(node, line, column) {
    if (!node.loc)
        return false;
    const { start, end } = node.loc;
    const afterStart = line > start.line || (line === start.line && column >= start.column);
    const beforeEnd = line < end.line || (line === end.line && column <= end.column);
    return afterStart && beforeEnd;
}

function nodeSpansLine(node, line) {
    if (!node.loc)
        return false;
    return node.loc.start.line <= line && line <= node.loc.end.line;
}

function spanLength(node) {
    if (node.start == null || node.end == null)
        return Number.MAX_SAFE_INTEGER;
    return node.end - node.start;
}

function codeSlice(code, node) {
    if (node.start == null || node.end == null)
        return undefined;
    return code.slice(node.start, node.end);
}

function nodeRange(node) {
    if (!node?.loc)
        return undefined;
    return { startLine: node.loc.start.line, endLine: node.loc.end.line };
}

function cappedComponentCode(code, lines, node, hitLine, maxComponentLines) {
    if (!node.loc)
        return codeSlice(code, node);
    const startLine = node.loc.start.line;
    const endLine = node.loc.end.line;
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

function findComponentNode(jsxPath) {
    const fnPath = jsxPath.findParent((p) => p.isFunctionDeclaration() ||
        p.isFunctionExpression() ||
        p.isArrowFunctionExpression() ||
        p.isClassDeclaration() ||
        p.isClassExpression());
    if (!fnPath)
        return undefined;
    let candidate = fnPath;
    const parent = fnPath.parentPath;
    if (parent?.isVariableDeclarator() && parent.parentPath?.isVariableDeclaration()) {
        candidate = parent.parentPath;
    }
    const wrapper = candidate.parentPath;
    if (wrapper && (wrapper.isExportNamedDeclaration() || wrapper.isExportDefaultDeclaration())) {
        candidate = wrapper;
    }
    else if (fnPath.parentPath?.isExportDefaultDeclaration() ||
        fnPath.parentPath?.isExportNamedDeclaration()) {
        candidate = fnPath.parentPath;
    }
    return candidate.node;
}

/**
 * Babel reference extract matching historical `extractJsxFromCode` behavior.
 *
 * @param {string} code Source text (JS/TS/JSX/TSX).
 * @param {number} line 1-based hit line.
 * @param {number} column 0-based hit column.
 * @param {number} maxContextLines Unused (kept for signature parity).
 * @param {number} maxComponentLines Cap for node/component slices.
 * @returns {Partial<{ selectedNodeCode: string, selectedNodeRange: object, containingComponentCode: string, containingComponentRange: object, importsCode: string, importsRange: object, astError: string }>}
 */
export function extractJsxFromCodeBabel(code, line, column, maxContextLines, maxComponentLines) {
    const lines = code.split('\n');
    const out = {};
    void maxContextLines;
    const ast = parse(code, {
        sourceType: 'module',
        plugins: [...PARSER_PLUGINS],
        ranges: true,
        errorRecovery: true,
    });
    const matches = {};
    const imports = [];
    traverse(ast, {
        ImportDeclaration(p) {
            imports.push(p.node);
        },
        'JSXElement|JSXFragment'(p) {
            const node = p.node;
            if (nodeContains(node, line, column)) {
                if (!matches.chosen || spanLength(node) < spanLength(matches.chosen.node)) {
                    matches.chosen = { node, path: p };
                }
            }
            else if (nodeSpansLine(node, line)) {
                if (!matches.lineFallback ||
                    spanLength(node) < spanLength(matches.lineFallback.node)) {
                    matches.lineFallback = { node, path: p };
                }
            }
        },
    });
    const hit = matches.chosen ?? matches.lineFallback;
    if (imports.length > 0) {
        const first = imports[0];
        const last = imports[imports.length - 1];
        if (first.start != null && last.end != null) {
            out.importsCode = code.slice(first.start, last.end);
            if (first.loc && last.loc) {
                out.importsRange = {
                    startLine: first.loc.start.line,
                    endLine: last.loc.end.line,
                };
            }
        }
    }
    if (hit) {
        out.selectedNodeCode = cappedComponentCode(code, lines, hit.node, line, maxComponentLines);
        out.selectedNodeRange = nodeRange(hit.node);
        const componentNode = findComponentNode(hit.path);
        if (componentNode) {
            out.containingComponentCode = cappedComponentCode(code, lines, componentNode, line, maxComponentLines);
            out.containingComponentRange = nodeRange(componentNode);
        }
    }
    else {
        out.astError = 'No JSX element found at the selected position';
    }
    return out;
}
