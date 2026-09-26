/**
 * Project compiler resolution, including a pnpm layout where only `vue` is a direct dependency.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { clearProjectModuleCache, requireFromProject } from './project-module.js';

test('pnpm layout resolves @vue/compiler-dom through vue and caches the module', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pnpm-vue-'));
    const file = path.join(root, 'src', 'App.vue');
    const vueDir = path.join(root, 'node_modules', 'vue');
    const compilerDir = path.join(vueDir, 'node_modules', '@vue', 'compiler-dom');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.mkdirSync(compilerDir, { recursive: true });
    fs.writeFileSync(file, '<template><p/></template>');
    fs.writeFileSync(path.join(vueDir, 'package.json'), JSON.stringify({ name: 'vue', version: '3.5.0' }));
    fs.writeFileSync(path.join(compilerDir, 'package.json'), JSON.stringify({ name: '@vue/compiler-dom', main: 'index.js' }));
    fs.writeFileSync(path.join(compilerDir, 'index.js'), 'exports.parse = function parse(){ return { tag: "from-vue" }; };\n');
    try {
        clearProjectModuleCache();
        assert.equal(requireFromProject(file, '@vue/compiler-dom'), null);
        const loaded = requireFromProject<any>(file, '@vue/compiler-dom', 'vue');
        assert.equal(loaded.parse().tag, 'from-vue');
        assert.equal(requireFromProject(file, '@vue/compiler-dom', 'vue'), loaded);
        assert.equal(requireFromProject(file, 'does-not-exist-compiler'), null);
        assert.equal(requireFromProject(file, 'does-not-exist-compiler'), null);
    }
    finally {
        clearProjectModuleCache();
        fs.rmSync(root, { recursive: true, force: true });
    }
});
