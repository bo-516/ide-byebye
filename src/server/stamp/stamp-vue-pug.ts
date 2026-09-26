/**
 * Stamp a Vue `<template lang="pug">` block with the project's pug parser.
 *
 * Purpose: `pug-lexer` / `pug-parser` (the pair `pug@3` depends on) see the template with the
 * bytes before it replaced by spaces, so their line numbers are template-relative and column
 * numbers stay aligned with the file. Named tags get `(data-insp-path="…")` after the name, or
 * inside an existing `(`. A `.class` / `#id` shorthand is an implicit `div` and the attribute
 * goes after the last shorthand.
 *
 * Boundary: a missing `pug` warns once and returns null (the HTML stamper is not used for this
 * template). A lexer or parser throw returns null and the template is left unchanged. Escape tags
 * match the JSX list. Offsets are into the full SFC, not the padded buffer.
 */

import { requireFromProject, resolveFromProject } from '../ast/project-module.js';
import { buildLineStartOffsets } from '../ast/line-offsets.js';
import { PATH_ATTR, formatInspValue, isEscapedTag, type Insertion } from './stamp-edits.js';

const PUG_WARN = '[code-intent-inspector] Pug template stamping needs pug (pug-lexer / pug-parser). Run: npm i -D pug';

const WALK_BLOCKS = new Set(['Case', 'Code', 'When', 'Each', 'While']);

/**
 * Insertions for one pug template element.
 *
 * @param {object} input `template` is the compiler-dom `<template>` node. `code` is the full SFC.
 * @returns {Insertion[] | null} Null when pug is missing or the template does not parse.
 */
export function stampPugTemplate(input): Insertion[] | null {
    const loaded = loadPug(input.file);
    if (!loaded) {
        input.warnOnce?.('pug-compiler', PUG_WARN);
        return null;
    }
    const start = input.template.loc.start.offset;
    const end = input.template.loc.end.offset;
    const padded = ' '.repeat(start) + input.code.slice(start, end) + ' '.repeat(input.code.length - end);
    let ast;
    try {
        ast = loaded.parse(loaded.lex(padded));
    }
    catch {
        return null;
    }
    const lineStarts = buildLineStartOffsets(input.code);
    const lineOffset = input.template.loc.start.line - 1;
    const insertions: Insertion[] = [];
    walk(ast, (node) => {
        if (node.type !== 'Tag')
            return;
        const line = node.line + lineOffset;
        const column = node.column;
        if (!inside(line, column, input.template.loc) || isEscapedTag(node.name, input.escapeTags ?? []))
            return;
        if ((node.attrs ?? []).some((attr) => attr?.name === PATH_ATTR))
            return;
        const offset = (lineStarts[line - 1] ?? 0) + column - 1;
        let at = offset;
        if (node.name === input.code.slice(offset, offset + node.name.length))
            at += node.name.length;
        else {
            for (const attr of node.attrs ?? []) {
                if ((attr.name === 'class' || attr.name === 'id') && !attr.mustEscape)
                    at = (lineStarts[attr.line + lineOffset - 1] ?? 0) + attr.column + (String(attr.val ?? '').length - 2);
            }
        }
        const value = formatInspValue(input.file, line, column, node.name);
        if (input.code[at] === '(')
            insertions.push({ at: at + 1, text: `${PATH_ATTR}="${value}", ` });
        else
            insertions.push({ at, text: `(${PATH_ATTR}="${value}")` });
    });
    return insertions;
}

function walk(node, visit: (node) => void) {
    if (!node)
        return;
    visit(node);
    if (node.type === 'Block') {
        for (const child of node.nodes ?? [])
            walk(child, visit);
    }
    else if (node.type === 'Tag')
        walk(node.block, visit);
    else if (WALK_BLOCKS.has(node.type)) {
        for (const child of node.block?.nodes ?? [])
            walk(child, visit);
    }
    else if (node.type === 'Conditional') {
        for (const child of node.consequent?.nodes ?? [])
            walk(child, visit);
        for (const child of node.alternate?.nodes ?? [])
            walk(child, visit);
    }
}

function inside(line: number, column: number, loc): boolean {
    const start = loc.start;
    const end = loc.end;
    return (line > start.line && line < end.line)
        || (line === start.line && (column >= start.column || column == null))
        || (line === end.line && (column <= end.column || column == null));
}

/**
 * Load `pug-lexer` and `pug-parser` from the `pug` package the file's project installed.
 *
 * @param {string} file SFC path.
 * @returns {{ lex: Function, parse: Function } | null}
 */
function loadPug(file: string) {
    const pugJson = resolveFromProject(file, 'pug/package.json');
    if (!pugJson)
        return null;
    const lexer = asFn(requireFromProject(pugJson, 'pug-lexer'));
    const parser = asFn(requireFromProject(pugJson, 'pug-parser'));
    if (!lexer || !parser)
        return null;
    return { lex: lexer, parse: parser };
}

function asFn(mod) {
    const fn = typeof mod === 'function' ? mod : mod?.default;
    return typeof fn === 'function' ? fn : null;
}
