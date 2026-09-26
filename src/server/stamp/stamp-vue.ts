/**
 * Stamp a Vue SFC or an external HTML template.
 *
 * Purpose: HTML template elements get `data-insp-path` from `@vue/compiler-dom` positions (already
 * 1-based). `<template lang="pug">` is delegated to the pug stamper. `<script lang="tsx|jsx">`
 * is stamped with file-level line and column, which is the documented difference from code-inspector.
 *
 * Boundary: the compiler is loaded from the SFC's project (`vue` as the pnpm hop). A missing compiler
 * or a parse error returns null so the file is left unchanged. One warning per process when the
 * compiler cannot be loaded. Escaped tags and any element whose source already contains the attribute
 * are skipped, including a parent whose child was pre-stamped — same as code-inspector's `loc.source` check.
 */

import { requireFromProject } from '../ast/project-module.js';
import { innerContent, staticAttr, VUE_ELEMENT } from '../ast/vue-sfc.js';
import { buildLineStartOffsets } from '../ast/line-offsets.js';
import { PATH_ATTR, formatInspValue, isEscapedTag, type Insertion } from './stamp-edits.js';
import { stampJsx } from './stamp-jsx.js';
import { stampPugTemplate } from './stamp-vue-pug.js';

const VUE_WARN = '[code-intent-inspector] Vue SFC stamping needs @vue/compiler-dom, which Vue 2.7 does not install. Run: npm i -D @vue/compiler-dom';

export interface StampVueInput {
    code: string;
    file: string;
    escapeTags?: Array<string | RegExp>;
    /** `true` when `code` is an `*.html?vue&type=template` fragment rather than a full SFC. */
    fragment?: boolean;
    warnOnce?: (key: string, message: string) => void;
}

/**
 * Insertions for one Vue file, or null when the compiler is missing or the file does not parse.
 *
 * @param {StampVueInput} input Full source and the absolute path it was read from.
 * @returns {Insertion[] | null}
 */
export function stampVue(input: StampVueInput): Insertion[] | null {
    const parse = loadVueParse(input.file);
    if (!parse) {
        input.warnOnce?.('vue-compiler', VUE_WARN);
        return null;
    }
    let ast;
    try {
        ast = parse(input.code, { comments: true });
    }
    catch {
        return null;
    }
    const escapeTags = input.escapeTags ?? [];
    const insertions: Insertion[] = [];
    const template = (ast.children ?? []).find((node) => node.type === VUE_ELEMENT && node.tag === 'template');
    if (template && staticAttr(template, 'lang') === 'pug') {
        const pug = stampPugTemplate({ code: input.code, file: input.file, template, escapeTags, warnOnce: input.warnOnce });
        if (pug)
            insertions.push(...pug);
    }
    else {
        walkElements(ast, (node) => {
            if (!node.loc?.source || node.loc.source.includes(PATH_ATTR) || isEscapedTag(node.tag, escapeTags))
                return;
            const value = formatInspValue(input.file, node.loc.start.line, node.loc.start.column, node.tag);
            const gap = node.props?.length ? ' ' : '';
            insertions.push({
                at: node.loc.start.offset + node.tag.length + 1,
                text: ` ${PATH_ATTR}="${value}"${gap}`,
            });
        });
    }
    const starts = buildLineStartOffsets(input.code);
    for (const script of (ast.children ?? []).filter((node) => node.type === VUE_ELEMENT && node.tag === 'script')) {
        const lang = staticAttr(script, 'lang');
        if (lang !== 'tsx' && lang !== 'jsx')
            continue;
        const { content, offset } = innerContent(script);
        const jsx = stampJsx({
            code: content,
            file: input.file,
            lang,
            escapeTags,
            offsetBase: offset,
            fileLineStarts: starts,
        });
        if (jsx)
            insertions.push(...jsx);
    }
    return insertions;
}

/**
 * @param {string} file SFC path used as the resolution root.
 * @returns {Function | null} `parse` from the project's compiler, or null.
 */
function loadVueParse(file: string) {
    const mod = requireFromProject<any>(file, '@vue/compiler-dom', 'vue');
    const parse = mod?.parse ?? mod?.default?.parse;
    return typeof parse === 'function' ? parse : null;
}

function walkElements(node, visit: (node) => void) {
    if (!node || typeof node !== 'object')
        return;
    if (node.type === VUE_ELEMENT)
        visit(node);
    for (const child of node.children ?? [])
        walkElements(child, visit);
}
