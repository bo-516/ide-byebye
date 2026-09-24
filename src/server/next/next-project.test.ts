/**
 * Next project facts: config-file directory from stack frames, installed version, config key selection.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { detectNextProjectDir, detectNextVersion, isInspectorHostProcess, usesStableTurbopackKey } from './next-project.js';

test('detectNextProjectDir reads next.config.* frames in every format Next loads', () => {
    const frame = (text) => `Error\n    at resolveRoot (file:///pkg/dist/server/next/with-next.js:60:5)\n${text}\n    at loadConfig (/app/node_modules/next/dist/server/config.js:900:1)`;
    assert.equal(detectNextProjectDir(frame('    at file:///repo/apps/web/next.config.mjs:4:16')), '/repo/apps/web');
    assert.equal(detectNextProjectDir(frame('    at Object.<anonymous> (/repo/site/next.config.js:3:18)')), '/repo/site');
    assert.equal(detectNextProjectDir(frame('    at Object.<anonymous> (/repo/ts-app/next.config.ts:8:1)')), '/repo/ts-app');
    assert.equal(detectNextProjectDir('Error\n    at foo (/repo/src/next.configuration.js:1:1)'), null);
    assert.equal(detectNextProjectDir(''), null);
});

test('usesStableTurbopackKey switches at Next 15.3', () => {
    assert.equal(usesStableTurbopackKey('14.2.35'), false);
    assert.equal(usesStableTurbopackKey('15.2.9'), false);
    assert.equal(usesStableTurbopackKey('15.3.0'), true);
    assert.equal(usesStableTurbopackKey('16.3.6'), true);
    assert.equal(usesStableTurbopackKey('16.4.0-canary.40'), true);
    assert.equal(usesStableTurbopackKey(null), true, 'unknown version is treated as current');
});

test('detectNextVersion resolves next from the project, else from the running CLI script', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-next-version-'));
    try {
        assert.equal(detectNextVersion(root, undefined), null);
        const nextDir = path.join(root, 'node_modules/next');
        fs.mkdirSync(nextDir, { recursive: true });
        fs.writeFileSync(path.join(nextDir, 'package.json'), JSON.stringify({ name: 'next', version: '15.2.1' }));
        assert.equal(detectNextVersion(root, undefined), '15.2.1');
        const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-next-elsewhere-'));
        const script = path.join(nextDir, 'dist/server/lib/start-server.js');
        fs.mkdirSync(path.dirname(script), { recursive: true });
        fs.writeFileSync(script, '');
        assert.equal(detectNextVersion(elsewhere, script), '15.2.1');
        fs.rmSync(elsewhere, { recursive: true, force: true });
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('isInspectorHostProcess accepts the dev server and custom servers, not Next helper processes', () => {
    assert.equal(isInspectorHostProcess('/app/node_modules/next/dist/server/lib/start-server.js'), true);
    assert.equal(isInspectorHostProcess('/app/node_modules/.pnpm/next@16.3.6/node_modules/next/dist/server/lib/start-server.js'), true);
    assert.equal(isInspectorHostProcess('C:\\app\\node_modules\\next\\dist\\server\\lib\\start-server.js'), true);
    assert.equal(isInspectorHostProcess('/app/server.js'), true, 'custom next({ dev: true }) server');
    assert.equal(isInspectorHostProcess(undefined), true);
    assert.equal(isInspectorHostProcess('/app/node_modules/next/dist/bin/next'), false, 'CLI supervisor');
    assert.equal(isInspectorHostProcess('/app/node_modules/next/dist/telemetry/detached-flush.js'), false);
});

test('isInspectorHostProcess resolves the npm `.bin/next` symlink to the CLI supervisor', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-next-bin-'));
    try {
        const cli = path.join(root, 'node_modules/next/dist/bin/next');
        fs.mkdirSync(path.dirname(cli), { recursive: true });
        fs.writeFileSync(cli, '');
        const bin = path.join(root, 'node_modules/.bin/next');
        fs.mkdirSync(path.dirname(bin), { recursive: true });
        fs.symlinkSync('../next/dist/bin/next', bin);
        assert.equal(isInspectorHostProcess(bin), false);
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
