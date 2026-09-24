/**
 * Generated Next.js bootstrap module: content, liveness probing, and "never clobber a working module".
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createInspectorRuntime } from '../plugin-runtime.js';
import { bootstrapModuleSource, isBootstrapServerAlive, readBootstrapClientSrc, writeBootstrapModule } from './bootstrap-module.js';
import { getNextInspector } from './next-inspector.js';

/**
 * Poll until `predicate` holds.
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

test('placeholder and live modules are valid client components; only live ones carry a client URL', () => {
    const placeholder = bootstrapModuleSource(null);
    assert.ok(placeholder.startsWith(`'use client';\n`));
    assert.equal(readBootstrapClientSrc(placeholder), null);
    const live = bootstrapModuleSource(';(function(){ script.src = "http://127.0.0.1:9/__intent-inspector/client.js?token=t"; })();');
    assert.equal(readBootstrapClientSrc(live), 'http://127.0.0.1:9/__intent-inspector/client.js?token=t');
});

test('isBootstrapServerAlive accepts only a live loopback server with the right token', async () => {
    const runtime = createInspectorRuntime({});
    const statement = await runtime.bootstrapStatement();
    const src = readBootstrapClientSrc(statement);
    assert.equal(await isBootstrapServerAlive(src), true);
    assert.equal(await isBootstrapServerAlive(src.replace(/token=[^&]+/, 'token=wrong')), false);
    assert.equal(await isBootstrapServerAlive('http://example.com/__intent-inspector/client.js?token=t'), false);
    assert.equal(await isBootstrapServerAlive('http://127.0.0.1:1/__intent-inspector/client.js?token=t'), false);
    assert.equal(await isBootstrapServerAlive('not a url'), false);
});

test('a module backed by another live inspector is kept; a stale one is replaced', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-next-keep-'));
    const file = path.join(root, '.intent-inspector/next/bootstrap.js');
    // "Another next dev" for this project already wrote a working module.
    const other = createInspectorRuntime({});
    const otherStatement = await other.bootstrapStatement();
    writeBootstrapModule(file, otherStatement);
    const infos = console.info;
    console.info = () => { };
    try {
        const inspector = getNextInspector(root, {});
        assert.equal(inspector.bootstrapFile, file);
        await inspector.runtime.bootstrapStatement();
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.equal(readBootstrapClientSrc(fs.readFileSync(file, 'utf8')), readBootstrapClientSrc(otherStatement));

        // A stale module (dead server) in a second project dir is replaced by the live statement.
        const staleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-next-stale-'));
        const staleFile = path.join(staleDir, '.intent-inspector/next/bootstrap.js');
        writeBootstrapModule(staleFile, ';(function(){ script.src = "http://127.0.0.1:1/__intent-inspector/client.js?token=dead"; })();');
        assert.equal(inspector.bootstrapFileFor(staleDir), staleFile);
        const ours = readBootstrapClientSrc(await inspector.runtime.bootstrapStatement());
        await waitFor(() => readBootstrapClientSrc(fs.readFileSync(staleFile, 'utf8')) === ours);
        fs.rmSync(staleDir, { recursive: true, force: true });
    }
    finally {
        console.info = infos;
        fs.rmSync(root, { recursive: true, force: true });
    }
});
