/**
 * Vue SFC locate + extract for intent source context.
 *
 * Purpose: resolve a `data-insp-path` hit in a `.vue` file to the exact template element. The file is parsed with
 * `@vue/compiler-dom` exactly the way the built-in stamper parses it (whole SFC, comments on),
 * so element start positions match 1:1 — no line slicing, no tag counting. Handles multi-line attributes, `>` inside
 * bindings, same-name nesting on one line, comments, components, slots and `<template #x>` wrappers.
 *
 * Boundary: no fs; the compiler is required lazily so React-only projects never load it. Pug (or any non-HTML)
 * templates and a missing compiler return `astError` so the caller keeps its line-window fallback. JSX render
 * functions inside `<script lang="tsx|jsx">` are delegated to the injected JSX extractor with line offsets.
 */

import { fileURLToPath } from 'node:url';
import { requireFromProject } from './project-module.js';
import { innerContent, staticAttr, VUE_ELEMENT } from './vue-sfc.js';
import { buildLineStartOffsets, lineColumnFromOffset } from './line-offsets.js';
import { extractScriptImports, scriptLangFromAttr } from './script-imports.js';
import { importFields, pickTemplateHit, templateHitFields, templateOffset, type ElementSpan } from './template-hit.js';

/**
 * Load `@vue/compiler-dom` from the SFC's project, or from this package when `file` is omitted.
 *
 * Boundary: a passed `file` does not fall back to ide-byebye's own install — Vue 2.7 projects must
 * add the compiler themselves. Omitting `file` (unit tests that only have a source string) resolves
 * next to this module, which works while `@vue/compiler-dom` is a devDependency.
 *
 * @param {string} [file] Absolute SFC path. Omit only when the caller has no project file.
 * @returns {{ parse: Function } | null} Compiler, or null when it cannot be loaded.
 */
function loadVueCompiler(file?: string) {
    const from = file || fileURLToPath(import.meta.url);
    const mod = requireFromProject<any>(from, '@vue/compiler-dom', file ? 'vue' : undefined);
    const parse = mod?.parse ?? mod?.default?.parse;
    return typeof parse === 'function' ? { parse } : null;
}

/**
 * Flatten every element below `root` (components, slots and `<template>` wrappers included) into spans.
 *
 * @param {object} root Template element node.
 * @returns {ElementSpan[]} Absolute spans in document order.
 */
function collectElementSpans(root) {
    const spans: ElementSpan[] = [];
    const stack = [...(root.children ?? [])].reverse();
    while (stack.length > 0) {
        const node = stack.pop();
        if (node?.type !== VUE_ELEMENT)
            continue;
        spans.push({ start: node.loc.start.offset, end: node.loc.end.offset });
        for (let i = (node.children?.length ?? 0) - 1; i >= 0; i -= 1)
            stack.push(node.children[i]);
    }
    return spans;
}

/**
 * Pick the import block shown for the SFC: `<script setup>` first, then the plain `<script>`.
 *
 * @param {string} code Full file source.
 * @param {object[]} scripts Top-level `<script>` element nodes.
 * @returns {{ code: string, start: number, end: number } | null} Absolute import block, or `null`.
 */
function sfcImports(code, scripts) {
    const ordered = [...scripts].sort((a, b) => Number(staticAttr(b, 'setup') !== null) - Number(staticAttr(a, 'setup') !== null));
    for (const script of ordered) {
        const { content, offset } = innerContent(script);
        const block = extractScriptImports(content, offset, scriptLangFromAttr(staticAttr(script, 'lang')));
        if (block)
            return block;
    }
    return null;
}

/**
 * Delegate a hit inside a JSX `<script>` block to the JSX extractor, shifting its ranges back to file lines.
 *
 * @param {string} code Full file source.
 * @param {object} script `<script>` element node containing the hit.
 * @param {number} line 1-based file line.
 * @param {number} column Column forwarded unchanged to the JSX extractor.
 * @param {number} maxComponentLines Slice cap.
 * @param {Function} extractJsx `extractJsxFromCode`-compatible function.
 * @param {(offset: number) => { line: number }} offsetToLine File offset → line converter.
 * @returns {Record<string, unknown>} JSX fields in file coordinates, or `astError` when nothing was found.
 */
function extractScriptJsx(code, script, line, column, maxComponentLines, extractJsx, offsetToLine) {
    const { content, offset } = innerContent(script);
    const lineShift = offsetToLine(offset).line - 1;
    const inner = extractJsx(content, line - lineShift, column, 0, maxComponentLines);
    const shift = (range) => range && ({ startLine: range.startLine + lineShift, endLine: range.endLine + lineShift });
    const out: Record<string, unknown> = {};
    for (const key of ['selectedNode', 'containingComponent', 'imports']) {
        if (inner[`${key}Code`]) {
            out[`${key}Code`] = inner[`${key}Code`];
            out[`${key}Range`] = shift(inner[`${key}Range`]);
        }
    }
    if (!out.selectedNodeCode)
        out.astError = inner.astError ?? 'No JSX element found in the <script> block';
    return out;
}

/**
 * Extract Vue SFC source context for a built-in stamp position.
 *
 * @param {string} code Full `.vue` file source.
 * @param {number} line 1-based line from `data-insp-path`.
 * @param {number} column 1-based column from `data-insp-path` (the element's `<`).
 * @param {number} maxComponentLines Cap for the selected-node / template slices.
 * @param {Function} [extractJsx] JSX extractor used for hits inside `<script lang="tsx|jsx">`; omit to report an
 *   `astError` for script hits instead.
 * @param {string} [file] Absolute SFC path. Required to load the project's compiler; omit only in tests that
 *   resolve `@vue/compiler-dom` from this package.
 * @returns {Record<string, unknown>} `selectedNode*`, `containingComponent*` (the whole `<template>` element),
 *   `imports*`, or `astError` when the position cannot be mapped (the caller keeps its line window).
 */
export function extractVueFromCode(code, line, column, maxComponentLines, extractJsx?, file?: string) {
    const compiler = loadVueCompiler(file);
    if (!compiler)
        return { astError: '@vue/compiler-dom is not available; install it to get Vue template context' };
    const lineStartOffsets = buildLineStartOffsets(code);
    const offsetToLine = (offset) => lineColumnFromOffset(lineStartOffsets, offset);
    const offset = templateOffset(lineStartOffsets, line, column);
    // onError keeps the tolerant AST; code-inspector already skipped files that do not parse cleanly.
    const ast = compiler.parse(code, { comments: true, onError: () => { } });
    const roots = (ast.children ?? []).filter((node) => node.type === VUE_ELEMENT);
    const template = roots.find((node) => node.tag === 'template');
    const scripts = roots.filter((node) => node.tag === 'script');
    const imports = importFields(sfcImports(code, scripts), offsetToLine);
    const inBlock = (node) => node.loc.start.offset <= offset && offset < node.loc.end.offset;

    const script = scripts.find(inBlock);
    if (script) {
        const lang = scriptLangFromAttr(staticAttr(script, 'lang'));
        if ((lang === 'tsx' || lang === 'jsx') && typeof extractJsx === 'function')
            return extractScriptJsx(code, script, line, column, maxComponentLines, extractJsx, offsetToLine);
        return { ...imports, astError: 'Click landed in a <script> block without JSX' };
    }
    if (!template)
        return { ...imports, astError: 'No <template> block found in the Vue SFC' };
    const templateLang = staticAttr(template, 'lang');
    if (templateLang && templateLang !== 'html')
        return { ...imports, astError: `<template lang="${templateLang}"> is not parsed; using a line window` };

    const container = { start: template.loc.start.offset, end: template.loc.end.offset };
    const hit = pickTemplateHit(collectElementSpans(template), offset, line, offsetToLine);
    if (!hit)
        return { ...imports, astError: 'No template element found at the selected position' };
    const lines = code.split('\n');
    return { ...templateHitFields(code, lines, hit, container, line, maxComponentLines, offsetToLine), ...imports };
}
