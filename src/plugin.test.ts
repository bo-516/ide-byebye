/**
 * Bundler entry shapes after the built-in stamper replaced code-inspector-plugin.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    vite,
    webpack,
    rspack,
    rsbuild,
    esbuild,
    farm,
    turbopack,
    mako,
} from './plugin.js';
import { STAMP_NAME } from './server/stamp/stamp-unplugin.js';

test('vite() returns the stamp plugin then the inspector, enforce pre and apply serve', () => {
    // `VitePlugin` is only `{ name }` so it nests in Vite's `plugins`. The instance still has these hooks.
    const plugins = vite({ agents: { claudeApp: true } }) as Array<{
        name: string;
        enforce?: string;
        apply?: string;
        transform?: { filter?: { id?: unknown } };
    }>;
    assert.equal(plugins.length, 2);
    assert.equal(plugins[0].name, STAMP_NAME);
    assert.equal(plugins[0].enforce, 'pre');
    assert.equal(plugins[0].apply, 'serve');
    assert.ok(plugins[0].transform?.filter?.id, 'transform.filter is set');
    assert.equal(plugins[1].name, 'ide-byebye');
});

test('webpack() and rspack() return appliable compiler plugins', () => {
    // `PluginInstance` is `object`; webpack and rspack are applied through `apply`.
    const webpackPlugin = webpack({}) as { apply?: unknown };
    const rspackPlugin = rspack({}) as { apply?: unknown };
    assert.equal(typeof webpackPlugin.apply, 'function');
    assert.equal(typeof rspackPlugin.apply, 'function');
});

test('applying the webpack plugin does not change cache.version', () => {
    const compiler: any = {
        options: {
            mode: 'development',
            context: process.cwd(),
            cache: { type: 'filesystem', version: 'v1' },
            module: { rules: [] },
            plugins: [],
        },
        webpack: { version: '5.0.0' },
        hooks: { thisCompilation: { tap() {} } },
    };
    // Same `object` return as above; the cast only names `apply` for the call.
    (webpack({}) as { apply: (compiler: unknown) => void }).apply(compiler);
    assert.equal(compiler.options.cache.version, 'v1');
});

test('rsbuild() returns a plugin with setup()', () => {
    // `PluginInstance` is `object`; the rsbuild instance exposes `name` and `setup`.
    const plugin = rsbuild({}) as { name?: string; setup?: unknown };
    assert.equal(plugin.name, 'ide-byebye');
    assert.equal(typeof plugin.setup, 'function');
});

test('esbuild() returns the stamp plugin and the inspector, both with setup', () => {
    // `PluginInstance` is `object`; both esbuild plugins expose `setup`.
    const plugins = esbuild({ htmlFiles: ['./index.html'] }) as Array<{ setup?: unknown }>;
    assert.equal(plugins.length, 2);
    assert.equal(typeof plugins[0].setup, 'function');
    assert.equal(typeof plugins[1].setup, 'function');
});

test('farm() returns the stamp plugin and a callable configResolved', () => {
    const plugins = farm({}) as Array<{
        name?: string;
        configResolved?: unknown;
        configureDevServer?: unknown;
        transformHtml?: { executor?: unknown; order?: number };
    }>;
    assert.equal(plugins.length, 2);
    assert.equal(plugins[0].name, STAMP_NAME);
    assert.equal(plugins[1].name, 'ide-byebye');
    // Farm 1.7 calls this hook as a function. An `{ executor }` object makes the dev server exit.
    assert.equal(typeof plugins[1].configResolved, 'function');
    assert.equal(typeof plugins[1].configureDevServer, 'function');
    assert.equal(typeof plugins[1].transformHtml?.executor, 'function');
    assert.equal(plugins[1].transformHtml?.order, 2);
});

test('mako() keeps the { name, enforce, transform } shape and stamps in development', () => {
    const plugin: any = mako({});
    assert.equal(plugin.name, STAMP_NAME);
    assert.equal(plugin.enforce, 'pre');
    assert.equal(typeof plugin.transform, 'function');
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
        const file = '/work/App.jsx';
        const stamped = plugin.transform('export function App(){return <div/>}', file);
        assert.match(stamped, /\/work\/App\.jsx:1:\d+:div/);
    }
    finally {
        if (previous === undefined)
            delete process.env.NODE_ENV;
        else
            process.env.NODE_ENV = previous;
    }
});

test('turbopack() returns a rules object', () => {
    const tp = turbopack({});
    assert.equal(typeof tp, 'object');
    assert.ok(tp);
});

/**
 * Run `fn` with `NODE_ENV` set to `value` (or removed for `undefined`), then restore the previous value.
 *
 * @param {string | undefined} value `NODE_ENV` for the duration of `fn`.
 * @param {() => Promise<T> | T} fn Body.
 * @returns {Promise<T>} What `fn` returned.
 */
async function withNodeEnv<T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> {
    const previous = process.env.NODE_ENV;
    if (value === undefined)
        delete process.env.NODE_ENV;
    else
        process.env.NODE_ENV = value;
    try {
        return await fn();
    }
    finally {
        if (previous === undefined)
            delete process.env.NODE_ENV;
        else
            process.env.NODE_ENV = previous;
    }
}

/**
 * Minimal esbuild `PluginBuild` double that records which hooks a plugin registers.
 *
 * @param {Record<string, unknown>} initialOptions esbuild `initialOptions`.
 * @returns {{ build: any, hooks: string[], onLoad: Array<(args: unknown) => Promise<unknown>> }} The double, the
 *   names of registered hooks, and the registered `onLoad` callbacks.
 */
function fakeEsbuild(initialOptions: Record<string, unknown>) {
    const hooks: string[] = [];
    const onLoad: Array<(args: unknown) => Promise<unknown>> = [];
    const build: any = {
        initialOptions,
        onStart() {
            hooks.push('onStart');
        },
        onEnd() {
            hooks.push('onEnd');
        },
        onLoad(_filter: unknown, callback: (args: unknown) => Promise<unknown>) {
            hooks.push('onLoad');
            onLoad.push(callback);
        },
    };
    return { build, hooks, onLoad };
}

test('esbuild() production builds register no inspector hooks and stamp nothing', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-byebye-esbuild-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'App.jsx');
    fs.writeFileSync(file, 'export function App(){return <div/>}\n');
    const cases: Array<{ env: string | undefined, define?: Record<string, string>, production: boolean }> = [
        { env: 'production', production: true },
        { env: undefined, define: { 'process.env.NODE_ENV': '"production"' }, production: true },
        { env: undefined, production: false },
    ];
    for (const item of cases) {
        await withNodeEnv(item.env, async () => {
            const [stamp, inspector] = esbuild({ htmlFiles: [path.join(dir, 'index.html')] }) as Array<{ setup: (build: unknown) => Promise<void> | void }>;
            const inspectorBuild = fakeEsbuild({ absWorkingDir: dir, define: item.define });
            await inspector.setup(inspectorBuild.build);
            assert.deepEqual(inspectorBuild.hooks, item.production ? [] : ['onStart', 'onEnd'], JSON.stringify(item));

            const stampBuild = fakeEsbuild({ absWorkingDir: dir, define: item.define });
            await stamp.setup(stampBuild.build);
            const loaded = await stampBuild.onLoad[0]({ path: file, suffix: '' }) as { contents?: string } | null;
            if (item.production)
                assert.equal(loaded, null, JSON.stringify(item));
            else
                assert.match(loaded?.contents ?? '', /data-insp-path/);
        });
    }
});

test('farm() production builds keep HTML and modules untouched', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-byebye-farm-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const [stamp, inspector] = farm({}) as any[];
    const html = '<!doctype html><html><head></head><body></body></html>';
    const module = { resolvedPath: path.join(dir, 'App.jsx'), query: [], content: 'export function App(){return <div/>}', moduleType: 'jsx' };

    stamp.configResolved({ compilation: { mode: 'production' } });
    await inspector.configResolved({ root: dir, compilation: { mode: 'production' } });
    const resource = { bytes: [...Buffer.from(html)] };
    const result = await inspector.transformHtml.executor({ htmlResource: resource });
    assert.equal(Buffer.from(result.bytes).toString('utf8'), html);
    assert.equal(await stamp.transform.executor(module, {}), undefined);
    assert.equal(fs.existsSync(path.join(dir, '.intent-inspector')), false);

    stamp.configResolved({ compilation: { mode: 'development' } });
    const stamped = await stamp.transform.executor(module, {});
    assert.match(stamped?.content ?? '', /data-insp-path/);
});
