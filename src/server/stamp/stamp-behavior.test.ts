/**
 * Dispatch, options, fail-open, and esbuild behavior of the built-in stamper.
 *
 * Boundary: calls `stampModule` / the Vite and esbuild plugins — the same entry points bundlers use.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as esbuild from 'esbuild';
import { esbuild as esbuildPlugins } from '../../plugin.js';
import { applyInsertions } from './stamp-edits.js';
import { elementTable } from './element-table.js';
import { stampJsx } from './stamp-jsx.js';
import { resetStampModuleWarnings, stampModule } from './stamp-module.js';
import { resetStampOptionWarnings, resolveStampOptions } from './stamp-options.js';
import { resetVitePluginOrderWarning, stampUnplugin, STAMP_NAME } from './stamp-unplugin.js';

const on = resolveStampOptions({}, () => {});
const jsx = 'export function App(){return <div/>}';

function stamp(code: string, id: string, options = on, family: 'rollup' | 'webpack' = 'rollup') {
    return stampModule({ code, id, family, options });
}

test('sourceStamp false stamps nothing and warns nothing', () => {
    const warnings = [];
    const options = resolveStampOptions({ sourceStamp: false }, (message) => warnings.push(message));
    assert.equal(warnings.length, 0);
    assert.equal(stamp(jsx, '/work/App.jsx', options), null);
});

test('codeInspector maps exclude, warns once, and names ignored keys', () => {
    resetStampOptionWarnings();
    const warnings = [];
    const options = resolveStampOptions({
        codeInspector: { exclude: [/legacy/], hotKeys: ['altKey'], behavior: { copy: true } },
    }, (message) => warnings.push(message));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /hotKeys/);
    assert.match(warnings[0], /behavior/);
    assert.match(warnings[0], /exclude/);
    assert.equal(stamp(jsx, '/work/src/legacy/App.jsx', options), null);
    assert.match(stamp(jsx, '/work/src/App.jsx', options) ?? '', /data-insp-path/);
    resolveStampOptions({ codeInspector: { hotKeys: true } }, (message) => warnings.push(message));
    assert.equal(warnings.length, 1);
});

test('include stamps one node_modules package and exclude skips another path', () => {
    const options = resolveStampOptions({
        sourceStamp: { include: [/node_modules\/@acme\/ui\//], escapeTags: ['Trans'] },
    }, () => {});
    assert.match(stamp('export const A = () => <b/>', '/work/node_modules/@acme/ui/B.jsx', options) ?? '', /data-insp-path/);
    assert.equal(stamp('export const A = () => <b/>', '/work/node_modules/other/B.jsx', options), null);
    assert.equal(stamp('export const A = () => <Trans/>', '/work/App.jsx', options), null);
});

test('ignore comments, virtual ids, queries, and rollup vue subrequests', () => {
    const here = path.resolve('behavior-vue');
    assert.equal(stamp('// ide-byebye-ignore\n' + jsx, '/work/App.jsx'), null);
    assert.equal(stamp('/* code-inspector-disable */\n' + jsx, '/work/App.jsx'), null);
    assert.equal(stamp(jsx, '\0virtual.jsx'), null);
    assert.equal(stamp(jsx, 'virtual:foo.jsx'), null);
    assert.equal(stamp(jsx, '/work/App.jsx?raw'), null);
    assert.equal(stamp(jsx, '/work/App.jsx?url'), null);
    assert.equal(stamp(jsx, '/work/App.jsx?worker'), null);
    assert.equal(stamp('<template><p/></template>', `${here}/A.vue?vue&type=style`, on, 'webpack'), null);
    assert.equal(stamp('<template><p>t</p></template>', `${here}/A.vue?vue&type=template`), null);
    const webpack = stamp('<template><p>t</p></template>', `${here}/A.vue?vue&type=template`, on, 'webpack');
    assert.match(webpack ?? '', /data-insp-path/);
    const html = stamp('<p>t</p>', `${here}/A.html?vue&type=template`);
    assert.match(html ?? '', /:p"/);
});

test('Windows paths use slashes and a syntax error is returned unchanged', () => {
    const code = 'export const A = () => <div/>';
    const edits = stampJsx({ code, file: 'C:\\proj\\src\\App.tsx', lang: 'tsx' });
    assert.ok(edits);
    assert.match(applyInsertions(code, edits), /C:\/proj\/src\/App\.tsx:1:\d+:div/);
    assert.equal(stampJsx({ code: 'const x = <', file: '/work/A.tsx', lang: 'tsx' }), null);
    assert.equal(stamp('const x = <', '/work/A.tsx'), null);
});

test('.ts createElement survives a type assertion that is illegal TSX', () => {
    const code = 'const y = <T>x;\nexport const el = React.createElement("div");\n';
    const edits = stampJsx({ code, file: '/work/a.ts', lang: 'ts' });
    assert.ok(edits);
    const stamped = applyInsertions(code, edits);
    assert.match(stamped, /const y = <T>x;/);
    assert.match(stamped, /\/work\/a\.ts:2:\d+:div/);
});

test('a missing Vue compiler returns the source and warns once', () => {
    resetStampModuleWarnings();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-vue-'));
    const file = path.join(dir, 'A.vue');
    const warnings = [];
    const input = {
        code: '<template><p/></template>\n',
        id: file,
        family: 'rollup' as const,
        options: on,
        warnOnce: (_key, message) => warnings.push(message),
    };
    try {
        assert.equal(stampModule(input), null);
        assert.equal(stampModule(input), null);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /@vue\/compiler-dom/);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a bad include pattern fails open and warns once', () => {
    resetStampModuleWarnings();
    const warnings = [];
    const options = { enabled: true, include: [], exclude: [1 as any], escapeTags: [] };
    const input = {
        code: jsx,
        id: '/work/App.jsx',
        family: 'rollup' as const,
        options,
        warnOnce: (_key, message) => warnings.push(message),
    };
    assert.equal(stampModule(input), null);
    assert.equal(stampModule(input), null);
    assert.equal(warnings.length, 1);
});

test('Vite SSR stamping matches the client transform', async () => {
    const plugin: any = stampUnplugin.vite({});
    const id = '/work/App.jsx';
    const client = await plugin.transform.handler(jsx, id);
    const server = await plugin.transform.handler(jsx, id, { ssr: true });
    assert.equal(client, server);
    assert.match(client, /data-insp-path/);
});

test('esbuild dev output contains data-insp-path and production output does not', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esbuild-stamp-'));
    const file = path.join(dir, 'App.jsx');
    fs.writeFileSync(file, 'function Item(props){return <li/>}\nexport function App(){return <Item/>}\n');
    const previous = process.env.NODE_ENV;
    try {
        delete process.env.NODE_ENV;
        const dev = await esbuild.build({
            absWorkingDir: dir,
            entryPoints: [file],
            bundle: true,
            write: false,
            format: 'esm',
            jsx: 'transform',
            jsxFactory: 'h',
            jsxFragment: 'Fragment',
            plugins: esbuildPlugins({}),
        });
        const devText = dev.outputFiles[0].text;
        assert.match(devText, /data-insp-path/);
        assert.match(devText, new RegExp(file.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        process.env.NODE_ENV = 'production';
        const prod = await esbuild.build({
            absWorkingDir: dir,
            entryPoints: [file],
            bundle: true,
            write: false,
            format: 'esm',
            jsx: 'transform',
            jsxFactory: 'h',
            jsxFragment: 'Fragment',
            plugins: esbuildPlugins({}),
        });
        assert.equal(prod.outputFiles[0].text.includes('data-insp-path'), false);
    }
    finally {
        if (previous === undefined)
            delete process.env.NODE_ENV;
        else
            process.env.NODE_ENV = previous;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('esbuild include stamps a node_modules file and leaves other packages alone', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esbuild-include-'));
    const included = path.join(dir, 'node_modules', '@acme', 'ui', 'B.jsx');
    const other = path.join(dir, 'node_modules', 'other', 'B.jsx');
    const source = 'export const A = () => <b>x</b>\n';
    fs.mkdirSync(path.dirname(included), { recursive: true });
    fs.mkdirSync(path.dirname(other), { recursive: true });
    fs.writeFileSync(included, source);
    fs.writeFileSync(other, source);
    const previous = process.env.NODE_ENV;
    const plugins = esbuildPlugins({ sourceStamp: { include: [/node_modules\/@acme\/ui\//] } });
    async function build(entry: string) {
        const result = await esbuild.build({
            absWorkingDir: dir,
            entryPoints: [entry],
            bundle: true,
            write: false,
            format: 'esm',
            jsx: 'transform',
            jsxFactory: 'h',
            jsxFragment: 'Fragment',
            plugins,
        });
        return result.outputFiles[0].text;
    }
    try {
        delete process.env.NODE_ENV;
        const stamped = await build(included);
        assert.match(stamped, /data-insp-path/);
        assert.match(stamped, /node_modules\/@acme\/ui\/B\.jsx:\d+:\d+:b/);
        const plain = await build(other);
        assert.equal(plain.includes('data-insp-path'), false);
    }
    finally {
        if (previous === undefined)
            delete process.env.NODE_ENV;
        else
            process.env.NODE_ENV = previous;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('Vite warns once when inspector() is registered after a framework plugin', () => {
    resetVitePluginOrderWarning();
    const plugin = stampUnplugin.vite({});
    const warnings = [];
    const original = console.warn;
    console.warn = (message) => warnings.push(String(message));
    try {
        plugin.configResolved({ plugins: [{ name: STAMP_NAME }, { name: 'vite:react-babel' }] });
        assert.equal(warnings.length, 0);
        plugin.configResolved({ plugins: [{ name: 'vite:react-babel' }, { name: STAMP_NAME }] });
        plugin.configResolved({ plugins: [{ name: 'vite-plugin-svelte' }, { name: STAMP_NAME }] });
    }
    finally {
        console.warn = original;
    }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /put inspector\(\) before @vitejs\/plugin-react/);
});

test('a pug template with no pug install is unchanged and warns once', () => {
    resetStampModuleWarnings();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'no-pug-'));
    const compiler = path.dirname(createRequire(import.meta.url).resolve('@vue/compiler-dom/package.json'));
    fs.mkdirSync(path.join(root, 'node_modules', '@vue'), { recursive: true });
    fs.symlinkSync(compiler, path.join(root, 'node_modules', '@vue', 'compiler-dom'));
    const file = path.join(root, 'Card.vue');
    const code = '<template lang="pug">\nsection\n  p hi\n</template>\n';
    fs.writeFileSync(file, code);
    const warnings = [];
    const input = {
        code,
        id: file,
        family: 'rollup',
        options: on,
        warnOnce: (_key, message) => warnings.push(message),
    };
    try {
        assert.equal(stampModule(input), null);
        assert.equal(stampModule(input), null);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /pug/);
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('element table reads static and propagated stamps', () => {
    const code = 'export function App(){return <div/>}';
    const stamped = stamp(code, '/work/App.jsx');
    const table = elementTable(stamped);
    assert.equal(table.size, 1);
    const entry = [...table.values()][0];
    assert.equal(entry.kind, 'propagated');
    assert.match(entry.value, /\/work\/App\.jsx:1:\d+:div$/);
});
