import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { detectLanguage, extractSourceContext } from './source-context.js';

test('detectLanguage recognizes vue/svelte alongside jsx', () => {
    assert.equal(detectLanguage('App.vue'), 'vue');
    assert.equal(detectLanguage('Widget.svelte'), 'svelte');
    assert.equal(detectLanguage('App.jsx'), 'jsx');
});

test('extractSourceContext on a Vue SFC returns template node, not JSX error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-vue-'));
    const file = path.join(dir, 'Button.vue');
    const source = `<template>
  <div class="wrap">
    <button class="btn" type="button">
      Click me
    </button>
  </div>
</template>

<script setup>
const label = 'Click me';
</script>
`;
    fs.writeFileSync(file, source, 'utf8');

    // code-inspector stamps `<button` at line 3, column 5 (1-based, pointing at `<`).
    const ctx = extractSourceContext({ file, line: 3, column: 5 });
    assert.equal(ctx.fileLanguage, 'vue');
    assert.ok(ctx.selectedNodeCode, 'expected a template node slice');
    assert.match(ctx.selectedNodeCode, /button/);
    assert.ok(ctx.containingComponentCode, 'expected template as containing component');
    assert.ok(!ctx.astError || !/JSX/.test(ctx.astError), `should not report JSX error, got: ${ctx.astError}`);
    assert.deepEqual(ctx.selectedNodeRange, { startLine: 3, endLine: 5 });
    assert.match(ctx.importsCode ?? '', /^$/);

    fs.rmSync(dir, { recursive: true, force: true });
});

test('extractSourceContext still finds JSX in a .jsx file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-jsx-'));
    const file = path.join(dir, 'App.jsx');
    fs.writeFileSync(file, `export function App() {\n  return <button className="x">Hi</button>;\n}\n`, 'utf8');
    const ctx = extractSourceContext({ file, line: 2, column: 10 });
    assert.equal(ctx.fileLanguage, 'jsx');
    assert.match(ctx.selectedNodeCode || '', /button/);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('extractSourceContext on a Svelte component returns the exact element', () => {
    // Svelte resolves from the component location, so the fixture must live inside this package.
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../node_modules/.cache');
    fs.mkdirSync(root, { recursive: true });
    const dir = fs.mkdtempSync(path.join(root, 'cii-svelte-'));
    const file = path.join(dir, 'Card.svelte');
    fs.writeFileSync(file, `<script lang="ts">\n  import Icon from './Icon.svelte';\n  let open: boolean = false;\n</script>\n\n{#if open}\n  <section class="card">\n    <Icon name="x" />\n  </section>\n{/if}\n`, 'utf8');
    try {
        const section = extractSourceContext({ file, line: 7, column: 3 });
        assert.equal(section.fileLanguage, 'svelte');
        assert.deepEqual(section.selectedNodeRange, { startLine: 7, endLine: 9 });
        assert.equal(section.importsCode, "import Icon from './Icon.svelte';");
        const icon = extractSourceContext({ file, line: 8, column: 5 });
        assert.equal(icon.selectedNodeCode, '<Icon name="x" />');
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('extractSourceContext degrades to a line window when svelte is not installed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-svelte-missing-'));
    const file = path.join(dir, 'Card.svelte');
    fs.writeFileSync(file, `<p>hi</p>\n`, 'utf8');
    try {
        const ctx = extractSourceContext({ file, line: 1, column: 1 });
        assert.match(ctx.astError ?? '', /svelte/);
        assert.equal(ctx.fileExcerpt, '<p>hi</p>\n');
        assert.equal(ctx.selectedNodeRange, undefined);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
