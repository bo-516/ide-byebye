import assert from 'node:assert/strict';
import test from 'node:test';
import { codeInspectorDefaults, vite, webpack, rspack } from './plugin.js';

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
