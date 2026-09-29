/**
 * Small Vue SFC helpers shared by the locator and the stamper.
 *
 * Purpose: both need the same reading of a compiler-dom element — static attribute values and the
 * text inside a `<script>` / `<template>` tag — so a stamp position and a later locate hit use one
 * definition of "inner content".
 *
 * Boundary: no I/O and no compiler import. Nodes are `@vue/compiler-dom` element objects (`type === 1`).
 * A missing attribute returns `null`; a tag with no close returns an empty string and the offset
 * just after `>` when one exists.
 */

/** `NodeTypes.ELEMENT` from `@vue/compiler-core`. */
export const VUE_ELEMENT = 1;

/** `NodeTypes.ATTRIBUTE` (static attributes, not directives). */
export const VUE_ATTRIBUTE = 6;

/** Static attribute (`type === 6`) on a compiler-dom element. Directives are a different shape and are ignored. */
interface VueCompilerProp {
    type?: number;
    name?: string;
    value?: { content?: string } | null;
}

/**
 * Compiler-dom node fields the locator and stamper read.
 *
 * Boundary: elements need `loc` and `children` (text nodes are skipped before those are used). A missing `props`
 * list means no static attributes. `null` / `undefined` is an absent node, not an element.
 */
export interface VueCompilerNode {
    type?: number;
    tag?: string;
    props?: VueCompilerProp[];
    children: VueCompilerNode[];
    loc: {
        source?: string;
        start: { offset: number, line?: number, column?: number };
        end: { offset: number };
    };
}

/**
 * Read a static attribute. Directives (`:lang`, `v-bind`) are ignored.
 *
 * @param {VueCompilerNode | null | undefined} node Compiler-dom element. `null` / `undefined` means the attribute is absent.
 * @param {string} name Attribute name.
 * @returns {string | null} Value, `''` for a bare attribute, or `null` when absent.
 */
export function staticAttr(node: VueCompilerNode | null | undefined, name: string): string | null {
    const prop = (node?.props ?? []).find((item) => item.type === VUE_ATTRIBUTE && item.name === name);
    if (!prop)
        return null;
    return prop.value?.content ?? '';
}

/**
 * Text between a tag's opening `>` and its last closing tag.
 *
 * @param {VueCompilerNode | null | undefined} node Element whose `loc.source` is the raw tag, including children.
 *   `null` / `undefined` yields an empty string at offset 0.
 * @returns {{ content: string, offset: number }} Inner source and its absolute file offset.
 *   `offset` is `node.loc.start.offset` when the tag has no `>`.
 */
export function innerContent(node: VueCompilerNode | null | undefined): { content: string, offset: number } {
    const full = node?.loc?.source ?? '';
    const open = full.indexOf('>') + 1;
    const close = full.lastIndexOf('</');
    const start = node?.loc?.start?.offset ?? 0;
    if (open <= 0)
        return { content: '', offset: start };
    const content = close >= open ? full.slice(open, close) : '';
    return { content, offset: start + open };
}
