/**
 * Locate an Angular component's template from its TypeScript source.
 *
 * Purpose: Angular's dev-mode `debugInfo` points at the component class (`src/app/app.ts:9`); the element lives in the
 * component's template — inline `template:` or an external `templateUrl`. This module finds the `@Component`
 * decorator of that class with oxc and returns where the template text is.
 *
 * Boundary: pure (no fs): an external template is returned as a path for the caller to validate and read. Only
 * literal values are understood (string / no-substitution template literal); computed templates yield `null`.
 */

import path from 'node:path';
import { parseSync } from 'oxc-parser';
import { walkAst } from './jsx-locator.js';
import { buildLineStartOffsets, lineColumnFromOffset } from './line-offsets.js';

/** Where a component's template text lives. */
export type ComponentTemplate =
    | { kind: 'inline', text: string, offset: number, classStart: number, classEnd: number }
    | { kind: 'external', file: string, classStart: number, classEnd: number };

/**
 * Literal text of a string literal or an expression-free template literal.
 *
 * @param {any} node oxc expression node.
 * @param {string} code Source the node belongs to.
 * @returns {{ text: string, offset: number } | null} Raw content (source slice, so offsets map 1:1) and its offset.
 */
function literalText(node, code: string) {
    const isString = node?.type === 'Literal' && typeof node.value === 'string';
    const isTemplate = node?.type === 'TemplateLiteral' && (node.expressions?.length ?? 0) === 0;
    if (!isString && !isTemplate)
        return null;
    return { text: code.slice(node.start + 1, node.end - 1), offset: node.start + 1 };
}

/**
 * Object-literal argument of an `@Component({...})` decorator, if any.
 *
 * @param {any} decorator oxc decorator node.
 * @returns {any | null} ObjectExpression, or `null` for other decorators.
 */
function componentMetadata(decorator) {
    const call = decorator?.expression;
    const callee = call?.type === 'CallExpression' ? call.callee : null;
    const name = callee?.type === 'Identifier' ? callee.name : callee?.property?.name;
    const arg = call?.arguments?.[0];
    return name === 'Component' && arg?.type === 'ObjectExpression' ? arg : null;
}

/**
 * Find the template of the component class Angular reported.
 *
 * Purpose: prefers the class named `className` (Angular's `debugInfo.className`), then the decorated component whose
 * name sits on `line`, then the only / first component in the file.
 *
 * @param {string} code Component TypeScript source.
 * @param {string} file Absolute component path (external `templateUrl` resolves against its directory).
 * @param {{ className?: string, line?: number }} target Class name and 1-based class line from `debugInfo`.
 * @returns {ComponentTemplate | null} Template location, or `null` when no literal template is found.
 */
export function findComponentTemplate(code: string, file: string, target: { className?: string, line?: number }) {
    let program;
    try {
        program = parseSync(`${path.basename(file)}.ts`, code, { sourceType: 'module', lang: 'ts' }).program;
    }
    catch {
        return null;
    }
    const lineStarts = buildLineStartOffsets(code);
    const components = [];
    walkAst(program, (node: any) => {
        if ((node.type === 'ClassDeclaration' || node.type === 'ClassExpression') && Array.isArray(node.decorators)) {
            const metadata = node.decorators.map(componentMetadata).find(Boolean);
            if (metadata)
                components.push({ node, metadata });
        }
    });
    const byName = components.find((c) => target.className && c.node.id?.name === target.className);
    const byLine = components.find((c) => c.node.id && lineColumnFromOffset(lineStarts, c.node.id.start).line === target.line);
    const chosen = byName ?? byLine ?? components[0];
    if (!chosen)
        return null;
    const classStart = Math.min(chosen.node.start, ...chosen.node.decorators.map((d) => d.start));
    const classEnd = chosen.node.end;
    for (const prop of chosen.metadata.properties ?? []) {
        const key = prop?.key?.name ?? prop?.key?.value;
        const literal = literalText(prop?.value, code);
        if (!literal)
            continue;
        if (key === 'template')
            return { kind: 'inline', text: literal.text, offset: literal.offset, classStart, classEnd };
        if (key === 'templateUrl')
            return { kind: 'external', file: path.resolve(path.dirname(file), literal.text), classStart, classEnd };
    }
    return null;
}
