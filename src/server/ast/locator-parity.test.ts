/**
 * Parity between code-inspector's stamped `data-insp-path` positions and our locators.
 *
 * Purpose: the locators are only correct if every position code-inspector emits resolves to the element it was
 * stamped on. This runs code-inspector's own `transformCode` over Vue / Svelte / JSX fixtures, then feeds each stamped
 * `file:line:column:tag` back through `extractSourceContext`.
 *
 * Boundary: test-only coupling to `@code-inspector/core` (resolved through `code-inspector-plugin`, the declared
 * dependency). Fixtures are written under this package's `node_modules/.cache` because `transformCode` skips files
 * that do not exist, and `svelte/compiler` must resolve from the fixture location like it would in a real project.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { parseInspPath } from '../insp-path.js';
import { extractSourceContext } from '../source-context.js';

const requireFromPlugin = createRequire(createRequire(import.meta.url).resolve('code-inspector-plugin'));
/** Git-ignored scratch root inside the package (so bare-specifier resolution still finds the dev dependencies). */
const FIXTURE_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../node_modules/.cache/ide-byebye-parity');
const { transformCode } = requireFromPlugin('@code-inspector/core');

const VUE = `<script setup>
import Item from './Item.vue';
</script>
<template>
  <section class="a" :title="n > 1 ? 'x' : 'y'">
    <div><div>deep</div></div>
    <Item
      v-for="i in 3"
      :key="i"
    />
    <ul><li v-for="i in 3" :key="i"><b>{{ i }}</b></li></ul>
  </section>
</template>
`;

const SVELTE = `<script>
  import Item from './Item.svelte';
  let n = 2;
</script>

<main class="a">
  {#if n > 1}<p title={n > 1 ? 'a' : 'b'}>hi <b>there</b></p>{/if}
  {#each [1, 2] as i}<span>{i}</span>{/each}
  <div><div>deep</div></div>
</main>
`;

const JSX = `export function App() {
  return (
    <section className="a">
      <div><div>deep</div></div>
      <ul>{[1, 2].map((i) => <li key={i}><b>{i}</b></li>)}</ul>
    </section>
  );
}
`;

/**
 * Stamp a fixture with code-inspector and resolve every stamped element through the locator.
 *
 * @param {string} name Fixture file name (extension selects the locator).
 * @param {string} source Fixture source.
 * @param {'vue' | 'svelte' | 'jsx'} fileType code-inspector file type.
 * @returns {Promise<Array<{ tag: string, selected: string | undefined }>>} One entry per stamped element.
 */
async function stampAndResolve(name, source, fileType) {
    fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
    const dir = fs.mkdtempSync(path.join(FIXTURE_ROOT, 'case-'));
    const file = path.join(dir, name);
    try {
        fs.writeFileSync(file, source, 'utf8');
        const stamped = await transformCode({ content: source, filePath: file, fileType, escapeTags: [], pathType: 'absolute' });
        const values = [...stamped.matchAll(/data-insp-path=(?:"|\{?")([^"]+)"/g)].map((m) => m[1]);
        assert.ok(values.length > 3, `expected stamped elements in ${name}, got ${values.length}`);
        return values.map((value) => {
            const parsed = parseInspPath(value);
            const ctx = extractSourceContext({ file: parsed.file, line: parsed.line, column: parsed.column });
            return { tag: value.split(':').pop(), selected: ctx.selectedNodeCode, error: ctx.astError };
        });
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * Assert every stamped element resolved to a slice that opens with its own tag.
 *
 * @param {Array<{ tag: string, selected: string | undefined, error?: string }>} results From {@link stampAndResolve}.
 */
function assertAllMatch(results) {
    for (const { tag, selected, error } of results) {
        assert.ok(selected, `no slice for <${tag}> (${error})`);
        assert.ok(selected.startsWith(`<${tag}`), `<${tag}> resolved to: ${selected.slice(0, 40)}`);
    }
}

test('every code-inspector Vue stamp resolves to its element', async () => {
    assertAllMatch(await stampAndResolve('Parity.vue', VUE, 'vue'));
});

test('every code-inspector Svelte stamp resolves to its element', async () => {
    assertAllMatch(await stampAndResolve('Parity.svelte', SVELTE, 'svelte'));
});

test('every code-inspector JSX stamp resolves to its element', async () => {
    assertAllMatch(await stampAndResolve('Parity.jsx', JSX, 'jsx'));
});

test('parity fixtures are cleaned up after each case', () => {
    const leftovers = fs.existsSync(FIXTURE_ROOT) ? fs.readdirSync(FIXTURE_ROOT) : [];
    assert.deepEqual(leftovers, []);
});
