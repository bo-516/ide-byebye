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

    // Line 3 is the <button> opening tag.
    const ctx = extractSourceContext({ file, line: 3, column: 4 });
    assert.equal(ctx.fileLanguage, 'vue');
    assert.ok(ctx.selectedNodeCode, 'expected a template node slice');
    assert.match(ctx.selectedNodeCode, /button/);
    assert.ok(ctx.containingComponentCode, 'expected template as containing component');
    assert.ok(!ctx.astError || !/JSX/.test(ctx.astError), `should not report JSX error, got: ${ctx.astError}`);
    assert.equal(ctx.selectedNodeRange.startLine, 3);

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
