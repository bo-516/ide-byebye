/**
 * Vue SFC locator: exact element resolution with `@vue/compiler-dom`.
 *
 * Boundary: positions are produced the way code-inspector stamps them (1-based line/column of the element's `<`),
 * via {@link positionOf}. Cases target shapes the old line-slice heuristic got wrong.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { extractJsxFromCode } from './jsx-locator.js';
import { extractVueFromCode } from './vue-locator.js';

const MAX = 300;

/**
 * 1-based line/column of the `nth` occurrence of `marker` in `code` (code-inspector's template convention).
 *
 * @param {string} code Source text.
 * @param {string} marker Substring whose first character is the element's `<`.
 * @param {number} [nth] Occurrence index (0-based).
 * @returns {{ line: number, column: number }} Position of the marker.
 */
function positionOf(code, marker, nth = 0) {
    let index = -1;
    for (let i = 0; i <= nth; i += 1)
        index = code.indexOf(marker, index + 1);
    assert.ok(index >= 0, `marker not found: ${marker}`);
    const before = code.slice(0, index);
    const line = before.split('\n').length;
    return { line, column: index - (before.lastIndexOf('\n') + 1) + 1 };
}

const SFC = `<script setup lang="ts">
import { ref } from 'vue';
import TaskItem from './TaskItem.vue';
const a = ref(1);
</script>

<template>
  <div class="wrap" :title="a > 1 ? 'x' : 'y'">
    <!-- <span class="ghost">commented</span> -->
    <div class="outer"><div class="inner">nested</div></div>
    <TaskItem
      v-for="t in list"
      :key="t.id"
    />
    <template #footer><p class="slot-p">slot</p></template>
    <span class="real">real</span>
  </div>
</template>

<style scoped>
.wrap > div { color: red }
</style>
`;

/** Run the locator at the position of `marker`. */
function at(code, marker, nth = 0) {
    const { line, column } = positionOf(code, marker, nth);
    return extractVueFromCode(code, line, column, MAX, extractJsxFromCode);
}

test('multi-line component tag resolves to its full span', () => {
    const out = at(SFC, '<TaskItem');
    assert.deepEqual(out.selectedNodeRange, { startLine: 11, endLine: 14 });
    assert.match(String(out.selectedNodeCode), /^<TaskItem[\s\S]*\/>$/);
    assert.equal(out.astError, undefined);
});

test('same-name nesting on one line picks the clicked element only', () => {
    const inner = at(SFC, '<div class="inner">');
    assert.equal(inner.selectedNodeCode, '<div class="inner">nested</div>');
    const outer = at(SFC, '<div class="outer">');
    assert.equal(outer.selectedNodeCode, '<div class="outer"><div class="inner">nested</div></div>');
});

test('">" inside a binding does not truncate the element', () => {
    const out = at(SFC, '<div class="wrap"');
    assert.deepEqual(out.selectedNodeRange, { startLine: 8, endLine: 17 });
    assert.match(String(out.selectedNodeCode), /<\/div>$/);
});

test('commented-out tags are ignored and slot templates are walked', () => {
    const real = at(SFC, '<span class="real">');
    assert.equal(real.selectedNodeCode, '<span class="real">real</span>');
    const slot = at(SFC, '<p class="slot-p">');
    assert.equal(slot.selectedNodeCode, '<p class="slot-p">slot</p>');
});

test('containing block is the <template> element and imports come from <script setup>', () => {
    const out = at(SFC, '<span class="real">');
    assert.deepEqual(out.containingComponentRange, { startLine: 7, endLine: 18 });
    assert.match(String(out.containingComponentCode), /^<template>[\s\S]*<\/template>$/);
    assert.equal(out.importsCode, "import { ref } from 'vue';\nimport TaskItem from './TaskItem.vue';");
    assert.deepEqual(out.importsRange, { startLine: 2, endLine: 3 });
});

test('CRLF sources keep exact positions', () => {
    const crlf = SFC.replace(/\n/g, '\r\n');
    const { line, column } = positionOf(SFC, '<div class="inner">');
    const out = extractVueFromCode(crlf, line, column, MAX);
    assert.equal(out.selectedNodeCode, '<div class="inner">nested</div>');
});

test('a stale column still anchors to the element that contains it', () => {
    const { line } = positionOf(SFC, '<span class="real">');
    const out = extractVueFromCode(SFC, line, 12, MAX);
    assert.equal(out.selectedNodeCode, '<span class="real">real</span>');
});

test('pug templates report astError so the caller keeps the line window', () => {
    const pug = `<template lang="pug">\ndiv.wrap\n  span hi\n</template>\n`;
    const out = extractVueFromCode(pug, 2, 1, MAX);
    assert.match(String(out.astError), /pug/);
    assert.equal(out.selectedNodeCode, undefined);
});

test('JSX render functions in <script lang="tsx"> use the JSX locator in file coordinates', () => {
    const code = `<script lang="tsx">\nimport { defineComponent } from 'vue';\nexport default defineComponent({\n  render() {\n    return <button class="tsx-btn">Go</button>;\n  },\n});\n</script>\n`;
    const { line, column } = positionOf(code, '<button');
    const out = extractVueFromCode(code, line, column, MAX, extractJsxFromCode);
    assert.match(String(out.selectedNodeCode), /tsx-btn/);
    assert.deepEqual(out.selectedNodeRange, { startLine: 5, endLine: 5 });
    assert.deepEqual(out.importsRange, { startLine: 2, endLine: 2 });
});

test('an SFC without a template reports astError instead of throwing', () => {
    const out = extractVueFromCode(`<script>\nexport default {};\n</script>\n`, 1, 1, MAX);
    assert.ok(out.astError);
});
