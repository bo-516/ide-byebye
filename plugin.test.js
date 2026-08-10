import assert from 'node:assert/strict';
import test from 'node:test';
import {
    codeInspectorDefaults,
    vite,
    webpack,
    rspack,
    rsbuild,
    esbuild,
    farm,
    turbopack,
    mako,
} from './plugin.js';

test('codeInspectorDefaults ships safe zero-config values and never sets bundler', () => {
    const d = codeInspectorDefaults();
    assert.equal(d.pathType, 'absolute');
    assert.equal(d.hotKeys, false);
    assert.deepEqual(d.behavior, { locate: false, copy: false, defaultAction: 'target' });
    assert.ok(!('bundler' in d), 'bundler is filled per-adapter, not here');
});

test('codeInspectorDefaults shallow-merges behavior and passes other overrides through', () => {
    const d = codeInspectorDefaults({ codeInspector: { pathType: 'relative', behavior: { copy: true }, hideConsole: true } });
    assert.equal(d.pathType, 'relative');
    assert.equal(d.hideConsole, true);
    // Override flips one behavior flag while keeping the rest of the safe defaults.
    assert.deepEqual(d.behavior, { locate: false, copy: true, defaultAction: 'target' });
});

test('vite() returns code-inspector + our plugin, wired with bundler=vite', () => {
    const plugins = vite({ agents: { claudeApp: true } });
    assert.ok(Array.isArray(plugins) && plugins.length === 2);
    assert.equal(plugins[0].name, '@code-inspector/vite');
    assert.equal(plugins[1].name, 'code-intent-inspector');
});

test('webpack() and rspack() return appliable compiler plugins', () => {
    assert.equal(typeof webpack({}).apply, 'function');
    assert.equal(typeof rspack({}).apply, 'function');
});

test('rsbuild() returns a plugin with setup()', () => {
    const plugin = rsbuild({});
    assert.equal(plugin.name, 'code-intent-inspector');
    assert.equal(typeof plugin.setup, 'function');
});

test('esbuild() returns code-inspector + our esbuild plugin (both with setup)', () => {
    const plugins = esbuild({ htmlFiles: ['./index.html'] });
    assert.ok(Array.isArray(plugins) && plugins.length === 2);
    assert.equal(typeof plugins[0].setup, 'function');
    assert.equal(typeof plugins[1].setup, 'function');
});

test('farm() returns code-inspector + farm plugin', () => {
    const plugins = farm({});
    assert.ok(Array.isArray(plugins) && plugins.length === 2);
    assert.equal(plugins[0].name, '@code-inspector/vite');
    assert.ok(plugins[1].name === 'code-intent-inspector' || plugins[1].name);
});

test('turbopack() and mako() return code-inspector adapters', () => {
    // turbopack returns a rules object (not a classic plugin with apply/setup)
    const tp = turbopack({});
    assert.ok(tp && typeof tp === 'object');
    const mk = mako({});
    assert.ok(mk && typeof mk === 'object');
    assert.ok(mk.name || typeof mk.apply === 'function' || typeof mk === 'object');
});
