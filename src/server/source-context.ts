import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_MAX_COMPONENT_LINES, DEFAULT_MAX_SOURCE_CONTEXT_LINES, } from '../shared/constants.js';
import { extractAngularSourceContext } from './ast/angular-locator.js';
import { lineContextWindow } from './ast/component-slice.js';
import { extractJsxFromCode } from './ast/jsx-locator.js';
import { extractSvelteFromCode } from './ast/svelte-locator.js';
import { extractVueFromCode } from './ast/vue-locator.js';

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

/** SourceContext fields a locator may return; copied verbatim onto the base context. */
const LOCATOR_FIELDS = [
    'importsCode',
    'importsRange',
    'selectedNodeCode',
    'selectedNodeRange',
    'containingComponentCode',
    'containingComponentRange',
    'astError',
];

/**
 * Run the AST locator that matches the file language.
 *
 * Boundary: `.vue` → `@vue/compiler-dom`, `.svelte` → the project's `svelte/compiler`, everything else → the oxc JSX
 * locator (JS/TS files without JSX simply report `astError`). Locators may throw on catastrophic input; the caller
 * converts that into `astError`.
 *
 * @param {string} language Result of {@link detectLanguage}.
 * @param {{ file: string, code: string, line: number, column: number, maxContextLines: number, maxComponentLines: number }} input
 *        Hit position and source; `column` is forwarded as parsed from `data-insp-path`.
 * @returns {Record<string, unknown>} Locator fields (see {@link LOCATOR_FIELDS}).
 */
function runLocator(language, input) {
    const { file, code, line, column, maxContextLines, maxComponentLines } = input;
    if (language === 'vue')
        return extractVueFromCode(code, line, column, maxComponentLines, extractJsxFromCode, file);
    if (language === 'svelte')
        return extractSvelteFromCode(code, line, column, maxComponentLines, file);
    return extractJsxFromCode(code, line, column, maxContextLines, maxComponentLines);
}

/**
 * Copy locator fields onto the base context and widen its line window to cover the located code.
 *
 * @param {Record<string, unknown>} base Context holding the plain line window (mutated and returned).
 * @param {Record<string, unknown>} inner Locator output.
 * @returns {Record<string, unknown>} `base` with AST fields merged.
 */
function mergeLocatorFields(base, inner) {
    for (const key of LOCATOR_FIELDS) {
        if (inner[key] != null && inner[key] !== '')
            base[key] = inner[key];
    }
    const span = base.containingComponentRange ?? base.selectedNodeRange;
    if (span) {
        base.startLine = Math.min(base.startLine, span.startLine);
        base.endLine = Math.max(base.endLine, span.endLine);
    }
    return base;
}

/**
 * Read a file and build a `SourceContext`: a focused excerpt plus, when AST
 * parsing succeeds, the selected element, its containing component / template,
 * and the import block. AST failures degrade to a plain line-context window.
 *
 * Boundary: orchestration only (fs + window + field merge). AST work lives in
 * `ast/*-locator.js`, one per template language (JSX via oxc, Vue via
 * `@vue/compiler-dom`, Svelte via the project's compiler). With an Angular hint
 * the file is the component class and the Angular locator may re-point
 * `filePath` at the component's template file; it needs `projectRoot` to read
 * an external template (path-guarded).
 *
 * @param {{ file: string, line: number, column: number, maxContextLines?: number, maxComponentLines?: number, angular?: import('../shared/angular-hint.js').AngularHint | null, projectRoot?: string }} opts
 * @returns {object} SourceContext fields for the prompt pipeline.
 */
export function extractSourceContext(opts) {
    const { file, line, column, maxContextLines = DEFAULT_MAX_SOURCE_CONTEXT_LINES, maxComponentLines = DEFAULT_MAX_COMPONENT_LINES, angular, projectRoot, } = opts;
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
    if (angular) {
        try {
            return extractAngularSourceContext({ file, code, line, hint: angular, projectRoot, maxContextLines, maxComponentLines });
        }
        catch (err) {
            base.astError = err instanceof Error ? err.message : String(err);
            return base;
        }
    }
    try {
        return mergeLocatorFields(base, runLocator(language, { file, code, line, column, maxContextLines, maxComponentLines }));
    }
    catch (err) {
        base.astError = err instanceof Error ? err.message : String(err);
        return base;
    }
}
