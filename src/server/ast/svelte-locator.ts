/**
 * Svelte component locate + extract for intent source context.
 *
 * Purpose: resolve a `data-insp-path` hit in a `.svelte` file to the exact markup element. code-inspector stamps each
 * element with the line/column of its `<`; the project's own `svelte/compiler` gives every element an absolute
 * `start` offset at that same `<`, so the match is exact for Svelte 3, 4 and 5 (legacy or modern AST).
 *
 * Boundary: no fs reads of the component itself (the caller passes `code`); the compiler is resolved from the
 * component's own location so monorepos pick the right Svelte version. A project without `svelte` returns `astError`
 * and the caller keeps its line-window fallback.
 */

import { createRequire } from 'node:module';
import { buildLineStartOffsets, lineColumnFromOffset } from './line-offsets.js';
import { extractScriptImports, scriptLangFromAttr } from './script-imports.js';
import { importFields, pickTemplateHit, templateHitFields, templateOffset, type ElementSpan } from './template-hit.js';

/**
 * AST node types that render (or wrap) markup elements, across the legacy (Svelte 3/4, Svelte 5 default) and modern
 * (Svelte 5 `modern: true`) shapes. Blocks (`{#if}`, `{#each}`) are walked through but never selected.
 */
const SVELTE_ELEMENT_TYPES = new Set([
    // legacy
    'Element', 'InlineComponent', 'Slot', 'SlotTemplate', 'Title',
    // modern
    'RegularElement', 'Component', 'SvelteElement', 'SvelteComponent', 'SvelteSelf', 'SvelteFragment',
    'SlotElement', 'TitleElement', 'SvelteBoundary',
]);

/** Compilers keyed by resolved `svelte/compiler` path (`null` = not resolvable from that location). */
const compilerCache = new Map<string, { parse: Function } | null>();

/**
 * Resolve and load the project's `svelte/compiler` for a component file.
 *
 * Boundary: Svelte 5 exposes a CommonJS build under the `require` condition, Svelte 3/4 are CommonJS already, so a
 * synchronous `createRequire` works for all of them. Failures are cached per file directory lookup key.
 *
 * @param {string} file Absolute path of the `.svelte` file being inspected.
 * @returns {{ parse: Function } | null} Compiler module, or `null` when Svelte is not installed for that file.
 */
function loadSvelteCompiler(file: string) {
    let resolved: string;
    try {
        resolved = createRequire(file).resolve('svelte/compiler');
    }
    catch {
        return null;
    }
    if (!compilerCache.has(resolved)) {
        try {
            const mod = createRequire(file)(resolved);
            compilerCache.set(resolved, typeof mod?.parse === 'function' ? mod : null);
        }
        catch {
            compilerCache.set(resolved, null);
        }
    }
    return compilerCache.get(resolved);
}

/**
 * Collect element spans from a Svelte AST fragment of either shape.
 *
 * Purpose: a generic walk (every object property) keeps up with block shapes (`else`, `pending`/`then`/`catch`,
 * `consequent`/`alternate`, `body`, snippets) without a per-version visitor table.
 *
 * @param {object} root Markup root (`ast.html` legacy, `ast.fragment` modern).
 * @returns {ElementSpan[]} Element spans (absolute offsets); order is not significant.
 */
function collectElementSpans(root) {
    const spans: ElementSpan[] = [];
    const seen = new Set();
    const stack = [root];
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node || typeof node !== 'object' || seen.has(node))
            continue;
        seen.add(node);
        if (Array.isArray(node)) {
            stack.push(...node);
            continue;
        }
        if (SVELTE_ELEMENT_TYPES.has(node.type) && Number.isInteger(node.start) && Number.isInteger(node.end))
            spans.push({ start: node.start, end: node.end });
        for (const key of Object.keys(node)) {
            // Expressions / attributes never contain markup elements; skipping them keeps the walk cheap.
            if (key === 'expression' || key === 'attributes' || key === 'metadata' || key === 'parent')
                continue;
            const child = node[key];
            if (child && typeof child === 'object')
                stack.push(child);
        }
    }
    return spans;
}

/**
 * Import block of the component's instance script (falling back to the module script).
 *
 * @param {string} code Full component source.
 * @param {object} ast Parsed AST (either shape); `instance` / `module` carry absolute `start`/`end` of the tag.
 * @returns {{ code: string, start: number, end: number } | null} Absolute import block, or `null`.
 */
function componentImports(code, ast) {
    for (const script of [ast.instance, ast.module]) {
        if (!script || !Number.isInteger(script.start) || !Number.isInteger(script.end))
            continue;
        const full = code.slice(script.start, script.end);
        const open = full.indexOf('>') + 1;
        const close = full.lastIndexOf('</');
        if (open <= 0 || close < open)
            continue;
        const lang = /\blang\s*=\s*["']?([\w-]+)/.exec(full.slice(0, open))?.[1];
        const block = extractScriptImports(full.slice(open, close), script.start + open, scriptLangFromAttr(lang));
        if (block)
            return block;
    }
    return null;
}

/**
 * Extract Svelte component source context for a code-inspector position.
 *
 * @param {string} code Full `.svelte` file source.
 * @param {number} line 1-based line from `data-insp-path`.
 * @param {number} column 1-based column from `data-insp-path` (the element's `<`).
 * @param {number} maxComponentLines Cap for the selected-node / component slices.
 * @param {string} file Absolute component path; only used to resolve the project's `svelte/compiler`.
 * @returns {Record<string, unknown>} `selectedNode*`, `containingComponent*` (the whole component file), `imports*`,
 *   or `astError` when Svelte is unavailable or the position maps to no element.
 */
export function extractSvelteFromCode(code, line, column, maxComponentLines, file) {
    const compiler = loadSvelteCompiler(file);
    if (!compiler)
        return { astError: 'svelte/compiler is not resolvable from this file; using a line window' };
    let ast;
    try {
        ast = compiler.parse(code, { modern: true });
    }
    catch (err) {
        return { astError: err instanceof Error ? err.message : String(err) };
    }
    const lineStartOffsets = buildLineStartOffsets(code);
    const offsetToLine = (offset) => lineColumnFromOffset(lineStartOffsets, offset);
    const imports = importFields(componentImports(code, ast), offsetToLine);
    const markup = ast.fragment ?? ast.html;
    const hit = pickTemplateHit(collectElementSpans(markup), templateOffset(lineStartOffsets, line, column), line, offsetToLine);
    if (!hit)
        return { ...imports, astError: 'No Svelte element found at the selected position' };
    const container = { start: 0, end: code.length };
    const fields = templateHitFields(code, code.split('\n'), hit, container, line, maxComponentLines, offsetToLine);
    return { ...fields, ...imports };
}
