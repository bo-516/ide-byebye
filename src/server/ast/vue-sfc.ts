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

/**
 * Read a static attribute. Directives (`:lang`, `v-bind`) are ignored.
 *
 * @param {object} node Compiler-dom element.
 * @param {string} name Attribute name.
 * @returns {string | null} Value, `''` for a bare attribute, or `null` when absent.
 */
export function staticAttr(node, name: string): string | null {
    const prop = (node?.props ?? []).find((item) => item.type === VUE_ATTRIBUTE && item.name === name);
    if (!prop)
        return null;
    return prop.value?.content ?? '';
}

/**
 * Text between a tag's opening `>` and its last closing tag.
 *
 * @param {object} node Element whose `loc.source` is the raw tag, including children.
 * @returns {{ content: string, offset: number }} Inner source and its absolute file offset.
 *   `offset` is `node.loc.start.offset` when the tag has no `>`.
 */
export function innerContent(node): { content: string, offset: number } {
    const full = node?.loc?.source ?? '';
    const open = full.indexOf('>') + 1;
    const close = full.lastIndexOf('</');
    const start = node?.loc?.start?.offset ?? 0;
    if (open <= 0)
        return { content: '', offset: start };
    const content = close >= open ? full.slice(open, close) : '';
    return { content, offset: start + open };
}
