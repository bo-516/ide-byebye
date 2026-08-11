import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_MAX_COMPONENT_LINES, DEFAULT_MAX_SOURCE_CONTEXT_LINES, } from '../shared/constants.js';
import { extractJsxFromCode } from './ast/jsx-locator.js';
import { extractVueSourceContext } from './source-context-vue.js';

/**
 * Map a file path extension to a coarse language tag for prompts / UI.
 *
 * Boundary: extension-only heuristic; unknown extensions become `'unknown'`
 * (callers must not assume AST extraction will succeed for those).
 *
 * @param {string} file Absolute or relative path (only the extension is used).
 * @returns {'tsx'|'jsx'|'ts'|'js'|'vue'|'svelte'|'unknown'}
 */
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
        case '.vue':
            return 'vue';
        case '.svelte':
            return 'svelte';
        default:
            return 'unknown';
    }
}

/**
 * 1-based inclusive slice of a line array, clamped to bounds.
 *
 * @param {string[]} lines Full file as lines.
 * @param {number} startLine Inclusive 1-based start.
 * @param {number} endLine Inclusive 1-based end.
 * @returns {string} Joined excerpt (empty string if the window is empty).
 */
function sliceLines(lines, startLine, endLine) {
    const s = Math.max(1, startLine);
    const e = Math.min(lines.length, endLine);
    return lines.slice(s - 1, e).join('\n');
}

/**
 * Build a centered line window around a hit for the plain-excerpt fallback.
 *
 * @param {string[]} lines Full file as lines.
 * @param {number} line 1-based hit line.
 * @param {number} maxContextLines Max lines in the window.
 * @returns {{ excerpt: string, startLine: number, endLine: number }}
 */
function lineContextWindow(lines, line, maxContextLines) {
    const half = Math.floor(maxContextLines / 2);
    const startLine = Math.max(1, line - half);
    const endLine = Math.min(lines.length, line + half);
    return { excerpt: sliceLines(lines, startLine, endLine), startLine, endLine };
}

/**
 * Read a file and build a `SourceContext`: a focused excerpt plus, when AST
 * parsing succeeds, the selected JSX/template node, its containing component,
 * and the import block. AST failures degrade to a plain line-context window.
 *
 * Boundary: orchestration only (fs + window + field merge). JSX AST work lives
 * in `ast/jsx-locator.js` (oxc). Vue SFCs take {@link extractVueSourceContext}.
 *
 * @param {{ file: string, line: number, column: number, maxContextLines?: number, maxComponentLines?: number }} opts
 * @returns {object} SourceContext fields for the prompt pipeline.
 */
export function extractSourceContext(opts) {
    const { file, line, column, maxContextLines = DEFAULT_MAX_SOURCE_CONTEXT_LINES, maxComponentLines = DEFAULT_MAX_COMPONENT_LINES, } = opts;
    const code = fs.readFileSync(file, 'utf8');
    const lines = code.split('\n');
    const language = detectLanguage(file);
    const window = lineContextWindow(lines, line, maxContextLines);
    const base: any = {
        filePath: file,
        fileLanguage: language,
        fileExcerpt: window.excerpt,
        startLine: window.startLine,
        endLine: window.endLine,
    };

    if (language === 'vue') {
        return extractVueSourceContext({
            code,
            lines,
            line,
            column,
            maxContextLines,
            maxComponentLines,
            base,
            extractJsx: extractJsxFromCode,
        });
    }

    try {
        const inner = extractJsxFromCode(code, line, column, maxContextLines, maxComponentLines);
        if (inner.importsCode) {
            base.importsCode = inner.importsCode;
        }
        if (inner.importsRange) {
            base.importsRange = inner.importsRange;
        }
        if (inner.selectedNodeCode) {
            base.selectedNodeCode = inner.selectedNodeCode;
            base.selectedNodeRange = inner.selectedNodeRange;
        }
        if (inner.containingComponentCode) {
            base.containingComponentCode = inner.containingComponentCode;
            base.containingComponentRange = inner.containingComponentRange;
            if (inner.containingComponentRange) {
                base.startLine = Math.min(base.startLine, inner.containingComponentRange.startLine);
                base.endLine = Math.max(base.endLine, inner.containingComponentRange.endLine);
            }
        }
        if (inner.astError) {
            base.astError = inner.astError;
        }
    }
    catch (err) {
        base.astError = err instanceof Error ? err.message : String(err);
    }
    return base;
}
