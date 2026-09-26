/**
 * Parity between the built-in stamper's `data-insp-path` positions and our locators.
 *
 * Purpose: every stamped element must resolve through `extractSourceContext` to a slice that starts with that
 * element's own tag. Fixtures are written under the package root (not `node_modules`, which the stamper skips)
 * so Vue and Svelte compilers resolve the way they do in a real project.
 *
 * Boundary: drives `stampModule`, the same function the bundler plugins call.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parseInspPath } from '../insp-path.js';
import { extractSourceContext } from '../source-context.js';
import { elementTable } from '../stamp/element-table.js';
import { stampModule } from '../stamp/stamp-module.js';
import { resolveStampOptions } from '../stamp/stamp-options.js';

/** Inside the package, outside `node_modules`, so project compilers resolve and the stamper does not skip the file. */
const FIXTURE_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../.stamp-parity');
const STAMP_OPTIONS = resolveStampOptions({}, () => {});

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
 * Stamp a fixture with the built-in stamper and resolve every stamped element through the locator.
 *
 * @param {string} name Fixture file name (extension selects the locator).
 * @param {string} source Fixture source.
 * @returns {Array<{ tag: string, selected: string | undefined }>} One entry per stamped element.
 */
function stampAndResolve(name, source) {
    fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
    const dir = fs.mkdtempSync(path.join(FIXTURE_ROOT, 'case-'));
    const file = path.join(dir, name);
    try {
        fs.writeFileSync(file, source, 'utf8');
        const stamped = stampModule({ code: source, id: file, family: 'rollup', options: STAMP_OPTIONS }) ?? source;
        const values = [...elementTable(stamped).values()].map((entry) => entry.value);
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

test('every Vue stamp resolves to its element', () => {
    assertAllMatch(stampAndResolve('Parity.vue', VUE));
});

test('every Svelte stamp resolves to its element', () => {
    assertAllMatch(stampAndResolve('Parity.svelte', SVELTE));
});

test('every JSX stamp resolves to its element', () => {
    assertAllMatch(stampAndResolve('Parity.jsx', JSX));
});

test('parity fixtures are cleaned up after each case', () => {
    const leftovers = fs.existsSync(FIXTURE_ROOT) ? fs.readdirSync(FIXTURE_ROOT) : [];
    assert.deepEqual(leftovers, []);
});
