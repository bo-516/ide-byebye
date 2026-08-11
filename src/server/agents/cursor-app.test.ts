import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildCursorAppDeepLink, buildCursorAppFilePrompt, resolveCursorAppWorkspace } from './cursor-app.js';

test('buildCursorAppDeepLink builds Cursor prompt route with optional routing params', () => {
    const url = new URL(buildCursorAppDeepLink({
        prompt: 'make this the primary button & add loading',
        workspace: 'ai-inspector',
        mode: 'agent',
    }));

    assert.equal(url.protocol, 'cursor:');
    assert.equal(url.hostname, 'anysphere.cursor-deeplink');
    assert.equal(url.pathname, '/prompt');
    assert.equal(url.searchParams.get('text'), 'make this the primary button & add loading');
    assert.equal(url.searchParams.get('workspace'), 'ai-inspector');
    assert.equal(url.searchParams.get('mode'), 'agent');
});

test('resolveCursorAppWorkspace uses explicit workspace, false opt-out, then git-aware default', () => {
    assert.equal(resolveCursorAppWorkspace(
        { workspace: 'frontend' },
        { projectRoot: '/tmp/project' },
    ), 'frontend');
    assert.equal(resolveCursorAppWorkspace(
        { workspace: false },
        { projectRoot: '/tmp/project' },
    ), undefined);

    // Explicit cursorApp.projectRoot pins the name to that folder (no git walk).
    assert.equal(resolveCursorAppWorkspace(
        { projectRoot: 'fixtures/app' },
        { projectRoot: '/tmp/vite-root' },
    ), path.basename(path.resolve('fixtures/app')));

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-inspector-cursor-ws-'));
    try {
        const repo = path.join(tmp, 'ai-inspector');
        const runDir = path.join(repo, 'demo', 'vue');
        fs.mkdirSync(runDir, { recursive: true });
        fs.mkdirSync(path.join(repo, '.git'));
        assert.equal(resolveCursorAppWorkspace({}, { projectRoot: runDir }), 'ai-inspector');

        // No git: fall back to the run directory basename (incl. .code-workspace stem).
        const bare = path.join(tmp, 'workspaces', 'example.code-workspace');
        fs.mkdirSync(bare, { recursive: true });
        assert.equal(resolveCursorAppWorkspace({}, { projectRoot: bare }), 'example');
    }
    finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('buildCursorAppFilePrompt includes refs, handoff file, and intent', () => {
    const prompt = buildCursorAppFilePrompt({
        projectRoot: '/tmp/project',
        selection: { line: 4 },
        source: {
            filePath: '/tmp/project/src/Button.jsx',
            selectedNodeRange: { startLine: 4, endLine: 8 },
        },
        intent: 'please keep working on this button',
    }, '/tmp/project/.intent-inspector/requests/request.md');

    assert.equal(
        prompt,
        '@src/Button.jsx #4-8\n/tmp/project/.intent-inspector/requests/request.md\n\nplease keep working on this button\n',
    );
});
