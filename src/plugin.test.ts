/**
 * Bundler entry shapes after the built-in stamper replaced code-inspector-plugin.
 */

import assert from 'node:assert/strict';
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
    assert.equal(plugins[1].name, 'code-intent-inspector');
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
    assert.equal(plugin.name, 'code-intent-inspector');
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
    assert.equal(plugins[1].name, 'code-intent-inspector');
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
