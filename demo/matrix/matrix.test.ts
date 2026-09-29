/**
 * Serial HTTP checks for the 16 framework/bundler demos.
 *
 * Purpose: one file so `node:test` does not bind two of these ports at once. `concurrency: false`
 * keeps the rows ordered even if the runner's default changes. Unit tests in other files may run
 * beside this process; they do not use ports 35300–35315.
 *
 * Boundary: each test calls {@link runMatrixCase}, which kills the server in `finally`. The exit
 * hook covers a runner crash that skips `finally`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { demos, launchArgs } from '../catalog.mjs';
import { installExitCleanup, runMatrixCase } from './harness.js';

installExitCleanup();

test('human launch reads the catalog port instead of a second command table', () => {
    const react = demos.find((row) => row.id === 'C-01');
    const farm = demos.find((row) => row.id === 'C-11');
    const nuxt = demos.find((row) => row.id === 'C-14');
    assert.ok(react && farm && nuxt);
    assert.deepEqual(launchArgs(react, react.humanPort), ['--config', 'vite.config.js']);
    assert.deepEqual(launchArgs(farm, farm.humanPort), ['--host', '127.0.0.1', '--port', '5850', '--strictPort']);
    assert.equal(nuxt.injection.path, '/_nuxt/@vite/client');
    assert.equal(nuxt.source.path, '/app/app.vue');
});

describe('framework bundler demos', { concurrency: false }, () => {
    for (const item of demos) {
        test(`${item.id} ${item.title}`, { timeout: item.readyMs + 60_000 }, async (t) => {
            await runMatrixCase(item, t.signal);
        });
    }
});
