import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { buildCursorAppDeepLink, buildCursorAppFilePrompt, resolveCursorAppWorkspace } from './cursor-app.js';

test('buildCursorAppDeepLink builds Cursor prompt route with optional routing params', () => {
    const url = new URL(buildCursorAppDeepLink({
        prompt: '把按钮改成主按钮 & 加 loading',
        workspace: 'ai-inspector',
        mode: 'agent',
    }));

    assert.equal(url.protocol, 'cursor:');
    assert.equal(url.hostname, 'anysphere.cursor-deeplink');
    assert.equal(url.pathname, '/prompt');
    assert.equal(url.searchParams.get('text'), '把按钮改成主按钮 & 加 loading');
    assert.equal(url.searchParams.get('workspace'), 'ai-inspector');
    assert.equal(url.searchParams.get('mode'), 'agent');
});

test('resolveCursorAppWorkspace uses explicit workspace, false opt-out, then project basename', () => {
    assert.equal(resolveCursorAppWorkspace(
        { workspace: 'frontend' },
        { projectRoot: '/tmp/project' },
    ), 'frontend');
    assert.equal(resolveCursorAppWorkspace(
        { workspace: false },
        { projectRoot: '/tmp/project' },
    ), undefined);
    assert.equal(resolveCursorAppWorkspace(
        {},
        { projectRoot: '/tmp/workspaces/example.code-workspace' },
    ), 'example');
    assert.equal(resolveCursorAppWorkspace(
        { projectRoot: 'fixtures/app' },
        { projectRoot: '/tmp/vite-root' },
    ), path.basename(path.resolve('fixtures/app')));
});

test('buildCursorAppFilePrompt includes refs, handoff file, and intent', () => {
    const prompt = buildCursorAppFilePrompt({
        projectRoot: '/tmp/project',
        selection: { line: 4 },
        source: {
            filePath: '/tmp/project/src/Button.jsx',
            selectedNodeRange: { startLine: 4, endLine: 8 },
        },
        intent: '请继续处理这个按钮',
    }, '/tmp/project/.intent-inspector/requests/request.md');

    assert.equal(
        prompt,
        '@src/Button.jsx #4-8\n/tmp/project/.intent-inspector/requests/request.md\n\n请继续处理这个按钮\n',
    );
});
