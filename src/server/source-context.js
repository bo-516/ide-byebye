import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import traverseImport from '@babel/traverse';
import { DEFAULT_MAX_COMPONENT_LINES, DEFAULT_MAX_SOURCE_CONTEXT_LINES, } from '../shared/constants.js';
// `@babel/traverse` is a CJS module whose callable lives on `.default` under
// ESM interop.
const traverse = (traverseImport.default ??
    traverseImport);
const PARSER_PLUGINS = [
    'jsx',
    'typescript',
    'decorators-legacy',
    'classProperties',
    'objectRestSpread',
    'optionalChaining',
    'nullishCoalescingOperator',
];
export function detectLanguage(file) {
    const ext = path.extname(file).toLowerCase();
    switch (ext) {
        case '.tsx':
            return 'tsx';
        case '.jsx':
            return 'jsx';
        case '.ts':
        case '.mts':
        case '.cts':
            return 'ts';
        case '.js':
        case '.mjs':
        case '.cjs':
            return 'js';
        default:
            return 'unknown';
    }
}
/** 1-based inclusive slice of a line array, clamped to bounds. */
function sliceLines(lines, startLine, endLine) {
    const s = Math.max(1, startLine);
    const e = Math.min(lines.length, endLine);
    return lines.slice(s - 1, e).join('\n');
}
function lineContextWindow(lines, line, maxContextLines) {
    const half = Math.floor(maxContextLines / 2);
    const startLine = Math.max(1, line - half);
    const endLine = Math.min(lines.length, line + half);
    return { excerpt: sliceLines(lines, startLine, endLine), startLine, endLine };
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
/** Cap a component slice around the hit line, keeping it valid-ish source. */
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
/** Find the nearest enclosing React component statement for a JSX node. */
function findComponentNode(jsxPath) {
    const fnPath = jsxPath.findParent((p) => p.isFunctionDeclaration() ||
        p.isFunctionExpression() ||
        p.isArrowFunctionExpression() ||
        p.isClassDeclaration() ||
        p.isClassExpression());
    if (!fnPath)
        return undefined;
    // Prefer the enclosing statement so we capture `const App = () => …` and any
    // `export`/`export default` wrapper rather than the bare expression.
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
 * Read a file and build a `SourceContext`: a focused excerpt plus, when AST
 * parsing succeeds, the selected JSX node, its containing component, and the
 * import block. AST failures degrade to a plain line-context window.
 */
export function extractSourceContext(opts) {
    const { file, line, column, maxContextLines = DEFAULT_MAX_SOURCE_CONTEXT_LINES, maxComponentLines = DEFAULT_MAX_COMPONENT_LINES, } = opts;
    const code = fs.readFileSync(file, 'utf8');
    const lines = code.split('\n');
    const language = detectLanguage(file);
    const window = lineContextWindow(lines, line, maxContextLines);
    const base = {
        filePath: file,
        fileLanguage: language,
        fileExcerpt: window.excerpt,
        startLine: window.startLine,
        endLine: window.endLine,
    };
    try {
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
                base.importsCode = code.slice(first.start, last.end);
                if (first.loc && last.loc) {
                    base.importsRange = {
                        startLine: first.loc.start.line,
                        endLine: last.loc.end.line,
                    };
                }
            }
        }
        if (hit) {
            base.selectedNodeCode = cappedComponentCode(code, lines, hit.node, line, maxComponentLines);
            base.selectedNodeRange = nodeRange(hit.node);
            const componentNode = findComponentNode(hit.path);
            if (componentNode) {
                base.containingComponentCode = cappedComponentCode(code, lines, componentNode, line, maxComponentLines);
                base.containingComponentRange = nodeRange(componentNode);
                if (componentNode.loc) {
                    // Widen the reported excerpt range to span the component.
                    base.startLine = Math.min(base.startLine, componentNode.loc.start.line);
                    base.endLine = Math.max(base.endLine, componentNode.loc.end.line);
                }
            }
        }
        if (!hit) {
            base.astError = 'No JSX element found at the selected position';
        }
    }
    catch (err) {
        base.astError = err instanceof Error ? err.message : String(err);
    }
    return base;
}
