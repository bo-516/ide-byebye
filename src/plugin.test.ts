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
    const plugins = vite({ agents: { claudeApp: true } });
    assert.equal(plugins.length, 2);
    assert.equal(plugins[0].name, STAMP_NAME);
    assert.equal(plugins[0].enforce, 'pre');
    assert.equal(plugins[0].apply, 'serve');
    assert.ok(plugins[0].transform?.filter?.id, 'transform.filter is set');
    assert.equal(plugins[1].name, 'code-intent-inspector');
});

test('webpack() and rspack() return appliable compiler plugins', () => {
    assert.equal(typeof webpack({}).apply, 'function');
    assert.equal(typeof rspack({}).apply, 'function');
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
    webpack({}).apply(compiler);
    assert.equal(compiler.options.cache.version, 'v1');
});

test('rsbuild() returns a plugin with setup()', () => {
    const plugin = rsbuild({});
    assert.equal(plugin.name, 'code-intent-inspector');
    assert.equal(typeof plugin.setup, 'function');
});

test('esbuild() returns the stamp plugin and the inspector, both with setup', () => {
    const plugins = esbuild({ htmlFiles: ['./index.html'] });
    assert.equal(plugins.length, 2);
    assert.equal(typeof plugins[0].setup, 'function');
    assert.equal(typeof plugins[1].setup, 'function');
});

test('farm() returns the stamp plugin and the farm inspector', () => {
    const plugins = farm({});
    assert.equal(plugins.length, 2);
    assert.equal(plugins[0].name, STAMP_NAME);
    assert.equal(plugins[1].name, 'code-intent-inspector');
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
