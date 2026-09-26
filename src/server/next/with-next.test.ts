/**
 * `withIdeByebye` config wrapping: dev-only activation, rule placement per Next version, webpack hook composition,
 * and the bootstrap module lifecycle.
 *
 * Boundary: dev-mode cases start a real (unref'd) loopback inspector and write into a temp project root, so the
 * process still exits when the tests finish.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BOOTSTRAP_IDENTIFIER } from './entry-inject.js';
import { buildTurbopackRules, mergeTurbopackRules, wrapWebpack } from './bundler-config.js';
import { withIdeByebye } from './with-next.js';

/**
 * Run `fn` with `NODE_ENV` temporarily set.
 *
 * @param {string | undefined} value Value to set (`undefined` deletes it).
 * @param {() => T} fn Callback.
 * @returns {T} Callback result.
 */
function withNodeEnv<T>(value: string | undefined, fn: () => T): T {
    const previous = process.env.NODE_ENV;
    if (value === undefined)
        delete process.env.NODE_ENV;
    else
        process.env.NODE_ENV = value;
    try {
        return fn();
    }
    finally {
        if (previous === undefined)
            delete process.env.NODE_ENV;
        else
            process.env.NODE_ENV = previous;
    }
}

/** Fresh temp project root (the Next inspector registry is keyed by root). */
function tempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'cii-next-'));
}

/**
 * Poll until `predicate` holds (the live bootstrap is written after the server listens).
 *
 * @param {() => boolean} predicate Condition.
 * @returns {Promise<void>} Resolves once true; rejects after ~2s.
 */
async function waitFor(predicate: () => boolean) {
    for (let i = 0; i < 100; i += 1) {
        if (predicate())
            return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('condition not met in time');
}

/** Minimal inspector double for pure rule / hook helpers. */
const FAKE_INSPECTOR: any = {
    root: '/work/app',
    bootstrapFile: '/work/app/.intent-inspector/next/bootstrap.js',
    bootstrapFileFor: (dir) => path.join(dir, '.intent-inspector/next/bootstrap.js'),
};

test('outside next dev the config is returned untouched', () => {
    const config = { reactStrictMode: true };
    assert.equal(withNodeEnv('production', () => withIdeByebye(config, { root: tempRoot() })), config);
    assert.equal(withNodeEnv('development', () => withIdeByebye(config, { enabled: false })), config);
});

test('next dev: rules land under turbopack.rules, user config and rules are preserved', async () => {
    const root = tempRoot();
    const userWebpack = (config) => ({ ...config, marker: 'user' });
    const out: any = withNodeEnv('development', () => withIdeByebye({
        reactStrictMode: true,
        turbopack: { resolveAlias: { a: 'b' }, rules: { '*.svg': { loaders: ['@svgr/webpack'], as: '*.js' } } },
        webpack: userWebpack,
    }, { root }));
    assert.equal(out.reactStrictMode, true);
    assert.deepEqual(out.turbopack.resolveAlias, { a: 'b' });
    assert.deepEqual(out.turbopack.rules['*.svg'], { loaders: ['@svgr/webpack'], as: '*.js' });
    const ours = Object.entries(out.turbopack.rules).filter(([glob]) => glob !== '*.svg');
    assert.ok(ours.length >= 1);
    for (const [, rule] of ours as any) {
        assert.match(rule.loaders[0].loader, /entry-loader\.js$/);
        assert.equal(rule.loaders[0].options.bootstrapFile, path.join(root, '.intent-inspector/next/bootstrap.js'));
    }
    const hooked = out.webpack({ plugins: [], module: { rules: [] } }, { dev: false });
    assert.equal(hooked.marker, 'user', 'user webpack() still runs');

    const bootstrap = path.join(root, '.intent-inspector/next/bootstrap.js');
    assert.ok(fs.existsSync(bootstrap), 'placeholder written synchronously');
    await waitFor(() => fs.readFileSync(bootstrap, 'utf8').includes('__CODE_INTENT_INSPECTOR__'));
    const live = fs.readFileSync(bootstrap, 'utf8');
    assert.ok(live.startsWith(`'use client';`));
    assert.match(live, new RegExp(`export default function ${BOOTSTRAP_IDENTIFIER}\\(\\)`));
    assert.match(live, /http:\/\/127\.0\.0\.1:\d+\/__intent-inspector\/client\.js\?token=/);
    assert.equal(fs.readFileSync(path.join(root, '.intent-inspector/next/.gitignore'), 'utf8'), '*\n');
});

test('function configs are phase-gated and keep their shape', async () => {
    const root = tempRoot();
    const wrapped: any = withNodeEnv('production', () => withIdeByebye(async () => ({ basePath: '/x' }), { root }));
    assert.equal(typeof wrapped, 'function');
    assert.deepEqual(await wrapped('phase-production-build', {}), { basePath: '/x' });
    const dev = await wrapped('phase-development-server', {});
    assert.equal(dev.basePath, '/x');
    assert.ok(dev.turbopack?.rules && typeof dev.webpack === 'function');
});

test('mergeTurbopackRules targets experimental.turbo on older Next and warns on glob collisions', () => {
    const ours = { '**/*.tsx': { loaders: ['ours'] } };
    const legacy: any = mergeTurbopackRules({ experimental: { ppr: true, turbo: { rules: { '*.md': ['md'] } } } }, ours, false);
    assert.equal(legacy.experimental.ppr, true);
    assert.deepEqual(Object.keys(legacy.experimental.turbo.rules), ['**/*.tsx', '*.md']);
    assert.equal(legacy.turbopack, undefined);

    const warnings = [];
    const original = console.warn;
    console.warn = (msg) => warnings.push(String(msg));
    try {
        const merged: any = mergeTurbopackRules({ turbopack: { rules: { '**/*.tsx': ['theirs'] } } }, ours, true);
        assert.deepEqual(merged.turbopack.rules['**/*.tsx'], ['theirs']);
    }
    finally {
        console.warn = original;
    }
    assert.equal(warnings.length, 1);
});

test('buildTurbopackRules orders loaders [entry, stamp] and the stamp options are JSON', () => {
    const rules: any = withNodeEnv('development', () => buildTurbopackRules({}, FAKE_INSPECTOR));
    assert.ok(Object.keys(rules).length >= 1);
    for (const rule of Object.values(rules) as any[]) {
        const loaders = Array.isArray(rule) ? rule : rule.loaders;
        assert.match(loaders[0].loader, /entry-loader\.js$/);
        assert.match(loaders[1].loader, /stamp-loader\.js$/);
        assert.deepEqual(loaders[0].options, { bootstrapFile: FAKE_INSPECTOR.bootstrapFile, projectDir: '/work/app' });
        assert.deepEqual(JSON.parse(JSON.stringify(loaders[1].options)), loaders[1].options);
    }
});

test('typed rules (Next 14) emit one rule per JSX extension with a matching `as`', () => {
    const rules: any = withNodeEnv('development', () => buildTurbopackRules({}, FAKE_INSPECTOR, { typedRules: true }));
    assert.deepEqual(Object.keys(rules).sort(), ['**/*.jsx', '**/*.tsx', '**/{app,pages}/**/*.{js,mjs}']);
    assert.equal(rules['**/*.tsx'].as, '*.tsx');
    assert.equal(rules['**/*.jsx'].as, '*.jsx');
    assert.equal(rules['**/{app,pages}/**/*.{js,mjs}'].as, undefined);
    for (const rule of Object.values(rules) as any[]) {
        assert.match(rule.loaders[0].loader, /entry-loader\.js$/);
        assert.match(rule.loaders[1].loader, /stamp-loader\.js$/);
        assert.equal(rule.loaders.length, 2);
    }
});

test('wrapWebpack adds a pre stamp rule and the entry rule only for dev compilations, using context.dir', () => {
    const hook = wrapWebpack(undefined, {}, FAKE_INSPECTOR);
    const prod = hook({ plugins: [], module: { rules: [] } }, { dev: false });
    assert.equal(prod.plugins.length, 0);
    assert.equal(prod.module.rules.length, 0);
    const dev = hook({ plugins: ['next'], module: { rules: ['next-rule'] }, cache: { type: 'filesystem', version: 'v1' } }, { dev: true, isServer: false, dir: '/work/other' });
    assert.deepEqual(dev.plugins, ['next']);
    assert.equal(dev.cache.version, 'v1');
    assert.equal(dev.module.rules[0], 'next-rule');
    const stampRule = dev.module.rules[1];
    assert.equal(stampRule.enforce, 'pre');
    assert.match(stampRule.use[0].loader, /stamp-loader\.js$/);
    assert.deepEqual(JSON.parse(JSON.stringify(stampRule.use[0].options)), stampRule.use[0].options);
    const entryRule = dev.module.rules[2];
    assert.ok(entryRule.test.test('layout.tsx') && !entryRule.test.test('styles.css'));
    assert.ok(entryRule.exclude.test('/x/node_modules/y.js'));
    assert.deepEqual(entryRule.use[0].options, {
        bootstrapFile: path.join('/work/other', '.intent-inspector/next/bootstrap.js'),
        projectDir: path.resolve('/work/other'),
    });
});
