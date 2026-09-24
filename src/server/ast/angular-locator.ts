/**
 * Angular source context: component class → template → matched element.
 *
 * Purpose: turn Angular's dev-mode component location (`src/app/app.ts:9`) plus the browser's element hint into a
 * `SourceContext` whose `filePath` / ranges point at the element inside the component template — the external
 * `templateUrl` file, or the inline `template:` literal inside the `.ts` file. The template is parsed with the project's
 * own `@angular/compiler`, so syntax support always matches the Angular version in use.
 *
 * Boundary: reads the external template only after `assertPathInsideRoot` (it is derived from source, never from the
 * page, but the guard still applies). Anything that cannot be resolved degrades to a component-level context in the
 * `.ts` file with `astError`, never to a failed selection. Element matching is heuristic (see `angular-template.ts`).
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { AngularHint } from '../../shared/angular-hint.js';
import { assertPathInsideRoot } from '../security.js';
import { findComponentTemplate } from './angular-component.js';
import { flattenTemplate, matchTemplateElement } from './angular-template.js';
import { lineContextWindow } from './component-slice.js';
import { buildLineStartOffsets, lineColumnFromOffset } from './line-offsets.js';
import { templateHitFields } from './template-hit.js';

/** Compilers keyed by resolved `@angular/compiler` path (`null` = not loadable from that location). */
const compilerCache = new Map<string, { parseTemplate: Function } | null>();

/**
 * Load the project's `@angular/compiler` (ESM-only; loaded through `require(esm)`, available in the Node versions
 * Angular itself requires).
 *
 * @param {string} file Absolute component path to resolve from.
 * @returns {{ parseTemplate: Function } | null} Compiler, or `null` when unavailable.
 */
function loadAngularCompiler(file: string) {
    let resolved: string;
    try {
        resolved = createRequire(file).resolve('@angular/compiler');
    }
    catch {
        return null;
    }
    if (!compilerCache.has(resolved)) {
        try {
            const mod = createRequire(file)(resolved);
            compilerCache.set(resolved, typeof mod?.parseTemplate === 'function' ? mod : null);
        }
        catch {
            compilerCache.set(resolved, null);
        }
    }
    return compilerCache.get(resolved);
}

/**
 * Plain line-window context for one file (the degraded shape every branch starts from).
 *
 * @param {string} filePath Absolute file path.
 * @param {string} fileLanguage Language tag.
 * @param {string} code File source.
 * @param {number} line 1-based focus line.
 * @param {number} maxContextLines Window size.
 * @returns {Record<string, unknown>} Base `SourceContext` fields.
 */
function windowContext(filePath: string, fileLanguage: string, code: string, line: number, maxContextLines: number) {
    const window = lineContextWindow(code.split('\n'), line, maxContextLines);
    return { filePath, fileLanguage, fileExcerpt: window.excerpt, startLine: window.startLine, endLine: window.endLine };
}

/**
 * Extract Angular source context for a picked element.
 *
 * @param {object} input
 * @param {string} input.file Absolute component `.ts` path (from `debugInfo.filePath`, already inside the root).
 * @param {string} input.code Component source.
 * @param {number} input.line 1-based class line from `debugInfo.lineNumber`.
 * @param {AngularHint} input.hint Normalized browser hint.
 * @param {string | undefined} input.projectRoot Project root; without it external templates are not read.
 * @param {number} input.maxContextLines Excerpt window size.
 * @param {number} input.maxComponentLines Slice cap.
 * @returns {Record<string, unknown>} Full `SourceContext` (its `filePath` may be the template file).
 */
export function extractAngularSourceContext({ file, code, line, hint, projectRoot, maxContextLines, maxComponentLines }: {
    file: string, code: string, line: number, hint: AngularHint, projectRoot?: string, maxContextLines: number, maxComponentLines: number,
}) {
    const componentContext = windowContext(file, 'ts', code, line, maxContextLines);
    const template = findComponentTemplate(code, file, { className: hint.className, line });
    if (!template)
        return { ...componentContext, astError: 'No literal @Component template found for this class' };
    if (template.kind === 'external' && !projectRoot)
        return { ...componentContext, astError: 'External template not read without a project root' };
    const templateFile = template.kind === 'external' ? assertPathInsideRoot(template.file, projectRoot) : file;
    const templateCode = template.kind === 'external' ? fs.readFileSync(templateFile, 'utf8') : code;
    const text = template.kind === 'external' ? templateCode : template.text;
    const offset = template.kind === 'external' ? 0 : template.offset;
    const compiler = loadAngularCompiler(file);
    const lineStarts = buildLineStartOffsets(templateCode);
    const offsetToLine = (value: number) => lineColumnFromOffset(lineStarts, value);
    const templateSpan = { start: offset, end: offset + text.length };
    let index = -1;
    if (compiler) {
        const parsed = compiler.parseTemplate(text, templateFile, { preserveWhitespaces: true, preserveLineEndings: true });
        const elements = flattenTemplate(parsed?.nodes, text);
        index = matchTemplateElement(elements, hint);
        if (index >= 0) {
            const hit = { start: offset + elements[index].start, end: offset + elements[index].end };
            const hitLine = offsetToLine(hit.start).line;
            return {
                ...windowContext(templateFile, template.kind === 'external' ? 'html' : 'ts', templateCode, hitLine, maxContextLines),
                ...templateHitFields(templateCode, templateCode.split('\n'), hit, templateSpan, hitLine, maxComponentLines, offsetToLine),
            };
        }
    }
    // Component-level fallback: the whole template, so the reference still lands in the right file.
    const startLine = offsetToLine(templateSpan.start).line;
    return {
        ...windowContext(templateFile, template.kind === 'external' ? 'html' : 'ts', templateCode, startLine, maxContextLines),
        ...templateHitFields(templateCode, templateCode.split('\n'), templateSpan, null, startLine, maxComponentLines, offsetToLine),
        astError: compiler
            ? 'Element not matched in the template; pointing at the whole template'
            : '@angular/compiler is not resolvable from this component; pointing at the whole template',
    };
}
