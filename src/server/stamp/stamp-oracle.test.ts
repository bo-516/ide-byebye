/**
 * Element-table parity with code-inspector 1.6.2, plus the documented differences.
 *
 * Boundary: `transformCode` is the oracle. `stampModule` is the shipped transform. Fixtures live under
 * the package root so Vue, pug, and Svelte resolve, and outside `node_modules` so they are not skipped.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { elementTable, type StampEntry } from './element-table.js';
import { stampModule } from './stamp-module.js';
import { resolveStampOptions } from './stamp-options.js';

const requireFromPlugin = createRequire(createRequire(import.meta.url).resolve('code-inspector-plugin'));
const { transformCode } = requireFromPlugin('@code-inspector/core');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../.stamp-oracle');
const options = resolveStampOptions({}, () => {});

const JSX = {
    'destructure.tsx': 'function Item({ label }: { label: string }) {\n  return <li>{label}</li>;\n}\n',
    'identifier.tsx': 'function Item(props) {\n  return <li/>;\n}\n',
    'no-params.tsx': 'function Item() {\n  return <li/>;\n}\n',
    'default.tsx': 'export default function () {\n  return <main/>;\n}\n',
    'class.tsx': 'class Item extends React.Component {\n  render() { return <li/>; }\n}\n',
    'memo.tsx': 'const Item = memo(() => <li/>);\n',
    'create-element.tsx': 'export function App() {\n  return React.createElement("p", null, "x");\n}\nfunction Item(props) {\n  return React.createElement("div", { id: "a" });\n}\nconst other = React.createElement("span", props);\n',
    'portal.tsx': 'function Item(props) {\n  return createPortal(<div/>, document.body);\n}\n',
    'fragment.tsx': 'function Item(props) {\n  return <><div/></>;\n}\n',
    'ternary.tsx': 'function Item(props) {\n  return cond ? <a/> : <b/>;\n}\n',
    'and.tsx': 'function Item(props) {\n  return cond && <a/>;\n}\n',
    'binding.tsx': 'function Item(props) {\n  const x = <div/>;\n  return x;\n}\n',
    'assign.tsx': 'function Item(props) {\n  let x;\n  x = <div/>;\n  return x;\n}\n',
    'multi.tsx': 'function Item(props) {\n  return [<a/>, <b/>];\n}\n',
    'escape.tsx': 'function Item(props) {\n  return <div><template/><Fragment/><span/></div>;\n}\n',
    'generic.tsx': 'export function Box<T,>(props: { value: T }) {\n  return <div>{props.value as any}</div>;\n}\n',
};

const VUE = {
    'basic.vue': '<template>\n  <section class="a">\n    <p>t</p>\n    <Item />\n  </section>\n</template>\n',
    'nested.vue': '<template>\n  <div>\n    <template v-if="ok"><span>x</span></template>\n    <slot />\n  </div>\n</template>\n',
    'list.vue': '<template>\n  <ul>\n    <li v-for="i in 3" :key="i"><b>{{ i }}</b></li>\n  </ul>\n</template>\n',
};

const PUG = {
    'shorthand.vue': '<template lang="pug">\nsection.card\n  h2(class="title") Hello\n</template>\n',
    'paren.vue': '<template lang="pug">\nItem(v-for="i in 3" :key="i")\n</template>\n',
    'each-if.vue': '<template lang="pug">\ntemplate(v-if="ok")\n  each i in items\n    if i\n      p= i\n    else\n      span no\n</template>\n',
};

const SVELTE = {
    'basic.svelte': '<main class="a"><p>hi</p></main>\n',
    'blocks.svelte': '<script>\n  let n = 1;\n</script>\n{#if n > 1}<p>hi <b>there</b></p>{/if}\n{#each [1] as i}<span>{i}</span>{/each}\n',
    'nested.svelte': '<div><div>deep</div></div>\n',
};

async function compare(name: string, source: string, fileType: string) {
    const file = path.join(ROOT, name);
    fs.mkdirSync(ROOT, { recursive: true });
    fs.writeFileSync(file, source);
    const oracle = await transformCode({ content: source, filePath: file, fileType, escapeTags: [], pathType: 'absolute' });
    const ours = stampModule({ code: source, id: file, family: 'rollup', options }) ?? source;
    const left = elementTable(oracle);
    const right = elementTable(ours);
    const keys = new Set([...left.keys(), ...right.keys()]);
    const bad = [];
    for (const key of keys) {
        const a = left.get(key);
        const b = right.get(key);
        if (!same(a, b))
            bad.push(`${key} oracle=${fmt(a)} ours=${fmt(b)}`);
    }
    assert.deepEqual(bad, [], name);
    assert.ok(left.size >= 1, `${name} oracle stamped nothing`);
}

function same(a?: StampEntry, b?: StampEntry) {
    return !!a && !!b && a.kind === b.kind && a.value === b.value;
}

function fmt(entry?: StampEntry) {
    return entry ? `${entry.kind} ${entry.value}` : '-';
}

test('JSX fixtures match code-inspector element tables', async () => {
    for (const [name, source] of Object.entries(JSX))
        await compare(name, source, 'jsx');
});

test('Vue HTML fixtures match code-inspector element tables', async () => {
    for (const [name, source] of Object.entries(VUE))
        await compare(name, source, 'vue');
});

test('pug fixtures match code-inspector element tables', async () => {
    for (const [name, source] of Object.entries(PUG))
        await compare(name, source, 'vue');
});

test('Svelte 3/4 fixtures match code-inspector element tables', async () => {
    for (const [name, source] of Object.entries(SVELTE))
        await compare(name, source, 'svelte');
});

test('Svelte 5 snippets are stamped and Vue script JSX uses file-level positions', () => {
    const dir = path.join(ROOT, 'diff');
    fs.mkdirSync(dir, { recursive: true });
    const svelteFile = path.join(dir, 'List.svelte');
    const svelte = '{#snippet row(i)}<li>{i}</li>{/snippet}\n<ul>{#each [1] as i}{@render row(i)}{/each}</ul>\n';
    fs.writeFileSync(svelteFile, svelte);
    const svelteOut = stampModule({ code: svelte, id: svelteFile, family: 'rollup', options }) ?? svelte;
    const table = elementTable(svelteOut);
    assert.ok(table.has('1:18:li'));
    assert.ok(table.has('2:1:ul'));

    const vueFile = path.join(dir, 'Box.vue');
    const vue = '<script lang="tsx">\nexport function Box() {\n  return <div />;\n}\n</script>\n<template><p>t</p></template>\n';
    fs.writeFileSync(vueFile, vue);
    const vueOut = stampModule({ code: vue, id: vueFile, family: 'rollup', options }) ?? vue;
    const vueTable = elementTable(vueOut);
    assert.ok(vueTable.has('3:10:div'), [...vueTable.keys()].join(','));
    assert.equal(vueTable.get('3:10:div')?.kind, 'propagated');
    assert.ok(vueTable.has('6:11:p'));
});

test.after(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
});
