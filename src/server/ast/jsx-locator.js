/**
 * JSX AST locate + extract for intent source context.
 *
 * Purpose: given pure JS/TS/JSX source and a (line, column) hit, return the
 * selected JSX node slice, containing component, and import block — same
 * fields as the historical Babel `extractJsxFromCode`.
 *
 * Boundary: pure string/AST math only (no fs, no DOM). Parse errors surface
 * as `astError` when possible; catastrophic throws are left for the caller
 * (`extractSourceContext`) to degrade. Uses `oxc-parser` with `lang: 'tsx'`.
 */

import { parseSync } from 'oxc-parser';
import { cappedComponentCode, nodeRange } from './component-slice.js';
import { buildLineStartOffsets, lineColumnFromOffset, offsetFromLineColumn } from './line-offsets.js';

const FN_TYPES = new Set([
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
    'ClassDeclaration',
    'ClassExpression',
]);

/**
 * Span length in UTF-16 units (smaller = tighter hit).
 * @param {{ start?: number|null, end?: number|null }} node
 * @returns {number}
 */
function spanLength(node) {
    if (node.start == null || node.end == null)
        return Number.MAX_SAFE_INTEGER;
    return node.end - node.start;
}

/**
 * Whether offset is inside `[start, end]` inclusive on both ends (Babel loc parity).
 * @param {{ start?: number|null, end?: number|null }} node
 * @param {number} offset
 */
function nodeContainsOffset(node, offset) {
    if (node.start == null || node.end == null)
        return false;
    return node.start <= offset && offset <= node.end;
}

/**
 * Whether the node's line span covers `line` (1-based).
 * @param {{ start?: number|null, end?: number|null }} node
 * @param {number} line
 * @param {(offset: number) => { line: number }} offsetToLine
 */
function nodeSpansLine(node, line, offsetToLine) {
    if (node.start == null || node.end == null)
        return false;
    const startLine = offsetToLine(node.start).line;
    const endLine = offsetToLine(Math.max(node.start, node.end - 1)).line;
    return startLine <= line && line <= endLine;
}

/**
 * Walk an oxc program tree depth-first, calling `visit` with (node, ancestors).
 * `ancestors` is the parent chain (root → … → parent), not including `node`.
 *
 * @param {object} root
 * @param {(node: object, ancestors: object[]) => void} visit
 */
function walkAst(root, visit) {
    const stack = [];

    function walk(node) {
        if (!node || typeof node !== 'object')
            return;
        visit(node, stack);
        stack.push(node);
        for (const key of Object.keys(node)) {
            if (key === 'start' || key === 'end' || key === 'range' || key === 'loc' || key === 'type')
                continue;
            const child = node[key];
            if (!child)
                continue;
            if (Array.isArray(child)) {
                for (const item of child) {
                    if (item && typeof item === 'object' && typeof item.type === 'string') {
                        walk(item);
                    }
                }
            }
            else if (typeof child === 'object' && typeof child.type === 'string') {
                walk(child);
            }
        }
        stack.pop();
    }

    walk(root);
}

/**
 * Find the nearest enclosing React component statement for a JSX hit.
 *
 * Purpose: promote `() => <div/>` to `const X = () => …` / `export default …`
 * so the prompt shows the full declaration, matching Babel `path.findParent`.
 *
 * Boundary: oxc models class methods as `MethodDefinition.value = FunctionExpression`,
 * while Babel uses `ClassMethod` (not a Function*). Skipping that method body is
 * required so we promote to `ClassDeclaration` / `ClassExpression` instead of
 * returning only `render()`. Omitting the skip regresses class-component slices.
 *
 * @param {object[]} ancestors Ancestor stack from root to parent of the hit (not including hit).
 * @returns {object|undefined} Component AST node to slice.
 */
function findComponentNode(ancestors) {
    // Scan from hit's parent toward root (stack is root→parent, so walk reverse).
    let fnIndex = -1;
    for (let i = ancestors.length - 1; i >= 0; i--) {
        const node = ancestors[i];
        if (!FN_TYPES.has(node.type)) {
            continue;
        }
        // See Boundary above: do not stop on a class method's FunctionExpression.
        const parent = i > 0 ? ancestors[i - 1] : null;
        if (
            (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression')
            && parent?.type === 'MethodDefinition'
        ) {
            continue;
        }
        fnIndex = i;
        break;
    }
    if (fnIndex < 0)
        return undefined;

    let candidate = ancestors[fnIndex];
    let candidateIndex = fnIndex;

    // Prefer VariableDeclaration wrapping VariableDeclarator(fn).
    const parent = fnIndex > 0 ? ancestors[fnIndex - 1] : null;
    const grand = fnIndex > 1 ? ancestors[fnIndex - 2] : null;
    if (parent?.type === 'VariableDeclarator' && grand?.type === 'VariableDeclaration') {
        candidate = grand;
        candidateIndex = fnIndex - 2;
    }

    const wrapper = candidateIndex > 0 ? ancestors[candidateIndex - 1] : null;
    if (wrapper && (wrapper.type === 'ExportNamedDeclaration' || wrapper.type === 'ExportDefaultDeclaration')) {
        candidate = wrapper;
    }
    else {
        // Direct export of the function: export default function / export function
        const fnParent = parent;
        if (fnParent && (fnParent.type === 'ExportDefaultDeclaration' || fnParent.type === 'ExportNamedDeclaration')) {
            candidate = fnParent;
        }
    }
    return candidate;
}

/**
 * Collect ImportDeclaration nodes in source order.
 * @param {object} program
 * @returns {object[]}
 */
function collectImports(program) {
    const imports = [];
    const body = program.body;
    if (!Array.isArray(body))
        return imports;
    for (const stmt of body) {
        if (stmt?.type === 'ImportDeclaration') {
            imports.push(stmt);
        }
    }
    return imports;
}

/**
 * Locate the tightest JSX element/fragment at (line, column) and its ancestors.
 *
 * @param {string} code Source text.
 * @param {number} line 1-based.
 * @param {number} column 0-based.
 * @returns {{ hit: { node: object, ancestors: object[] }|null, imports: object[], parseErrors: { message: string }[], offsetToLine: (n: number) => { line: number, column: number } }}
 */
export function locateJsxAtPosition(code, line, column) {
    const lineStartOffsets = buildLineStartOffsets(code);
    const offset = offsetFromLineColumn(lineStartOffsets, line, column);
    const offsetToLine = (off) => lineColumnFromOffset(lineStartOffsets, off);

    // Filename only affects diagnostics; lang forces TSX/JSX parsing.
    const result = parseSync('extract.tsx', code, {
        sourceType: 'module',
        lang: 'tsx',
    });
    const program = result.program;
    const parseErrors = Array.isArray(result.errors) ? result.errors : [];

    let chosen = null;
    let lineFallback = null;

    walkAst(program, (node, ancestors) => {
        if (node.type !== 'JSXElement' && node.type !== 'JSXFragment')
            return;
        if (nodeContainsOffset(node, offset)) {
            if (!chosen || spanLength(node) < spanLength(chosen.node)) {
                chosen = { node, ancestors: ancestors.slice() };
            }
        }
        else if (nodeSpansLine(node, line, offsetToLine)) {
            if (!lineFallback || spanLength(node) < spanLength(lineFallback.node)) {
                lineFallback = { node, ancestors: ancestors.slice() };
            }
        }
    });

    return {
        hit: chosen ?? lineFallback,
        imports: collectImports(program),
        parseErrors,
        offsetToLine,
    };
}

/**
 * Run the JSX AST extractor on a pure JS/TS/JSX source string (no file I/O).
 *
 * Used by the Vue script-block path (offset-adjusted) and the main JSX file path.
 *
 * @param {string} code Source text.
 * @param {number} line 1-based hit line.
 * @param {number} column 0-based hit column.
 * @param {number} maxContextLines Unused; reserved for API parity with Vue injection.
 * @param {number} maxComponentLines Cap for selected node / component slices.
 * @returns {Partial<{ selectedNodeCode: string, selectedNodeRange: object, containingComponentCode: string, containingComponentRange: object, importsCode: string, importsRange: object, astError: string }>}
 */
export function extractJsxFromCode(code, line, column, maxContextLines, maxComponentLines) {
    const lines = code.split('\n');
    const out = {};
    void maxContextLines;

    const { hit, imports, parseErrors, offsetToLine } = locateJsxAtPosition(code, line, column);

    if (imports.length > 0) {
        const first = imports[0];
        const last = imports[imports.length - 1];
        if (first.start != null && last.end != null) {
            out.importsCode = code.slice(first.start, last.end);
            out.importsRange = {
                startLine: offsetToLine(first.start).line,
                endLine: offsetToLine(Math.max(last.start, last.end - 1)).line,
            };
        }
    }

    if (hit) {
        out.selectedNodeCode = cappedComponentCode(code, lines, hit.node, line, maxComponentLines, offsetToLine);
        out.selectedNodeRange = nodeRange(hit.node, offsetToLine);
        const componentNode = findComponentNode(hit.ancestors);
        if (componentNode) {
            out.containingComponentCode = cappedComponentCode(code, lines, componentNode, line, maxComponentLines, offsetToLine);
            out.containingComponentRange = nodeRange(componentNode, offsetToLine);
        }
    }
    else if (parseErrors.length > 0) {
        // Prefer parser diagnostics over the generic miss message (§2.3).
        const msg = parseErrors[0].message ?? String(parseErrors[0]);
        out.astError = msg;
    }
    else {
        out.astError = 'No JSX element found at the selected position';
    }
    return out;
}
