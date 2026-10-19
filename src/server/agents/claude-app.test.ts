import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildPrompt } from '../prompt.js';
import { buildClaudeAppDeepLink, collectClaudeAppFiles, createClaudeAppAdapter } from './claude-app.js';

/** Request with a primary pick, one `@code` chip, and one screenshot under `root`. */
function makeRequest(root: string) {
    return {
        id: 'req-1',
        createdAt: '2026-10-19T08:00:00.000Z',
        projectRoot: root,
        pageUrl: 'http://localhost:5173/',
        intent: 'Make this the primary button',
        agent: 'claude-app',
        applyMode: 'prompt-only',
        selection: { file: path.join(root, 'src/App.tsx'), line: 12, column: 3 },
        source: { filePath: path.join(root, 'src/App.tsx'), selectedNodeRange: { startLine: 12, endLine: 14 } },
        references: [{ selection: { line: 4 }, source: { filePath: path.join(root, 'src/Button.tsx') } }],
        screenshots: [{ filePath: path.join(root, '.intent-inspector/screenshots/a.webp') }],
    };
}

/**
 * Run the adapter with `node` standing in for the OS opener, so the deeplink it would open is captured on disk.
 *
 * @returns The adapter result, the emitted events, and the parsed deeplink URL.
 */
async function sendWithFakeOpener(config: Record<string, unknown>) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-inspector-claude-app-')));
    try {
        const out = path.join(root, 'opened-url.txt');
        const request = makeRequest(root);
        const events: Array<{ type: string, text?: string }> = [];
        const result = await createClaudeAppAdapter({
            ...config,
            openCommand: process.execPath,
            openArgs: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(out)}, process.argv[1])`],
        }).send(request, {
            emit: (event) => events.push(event),
            prompt: buildPrompt(request),
            outputDir: path.join(root, '.intent-inspector'),
            projectRoot: root,
        });
        return { root, result, events, url: new URL(fs.readFileSync(out, 'utf8')) };
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

test('buildClaudeAppDeepLink sends q, repeatable folder and file params, and honors a custom scheme / route', () => {
    const url = new URL(buildClaudeAppDeepLink({
        scheme: 'claude-dev:',
        route: 'chat',
        prompt: 'fix it & ship',
        folders: ['/repo', undefined, '/api'],
        files: ['/repo/src/App.tsx', '', '/repo/a.webp'],
    }));
    assert.equal(url.protocol, 'claude-dev:');
    assert.equal(url.hostname, 'chat');
    assert.equal(url.pathname, '/new');
    assert.equal(url.searchParams.get('q'), 'fix it & ship');
    assert.deepEqual(url.searchParams.getAll('folder'), ['/repo', '/api']);
    assert.deepEqual(url.searchParams.getAll('file'), ['/repo/src/App.tsx', '/repo/a.webp']);
    assert.throws(() => buildClaudeAppDeepLink({ scheme: '1bad', prompt: 'x' }), /Invalid Claude App URL scheme/);
});

test('collectClaudeAppFiles lists code first, screenshots last, without duplicates', () => {
    const request = makeRequest('/repo');
    request.references.push({ selection: { line: 1 }, source: { filePath: '/repo/src/App.tsx' } });
    assert.deepEqual(collectClaudeAppFiles(request), [
        '/repo/src/App.tsx',
        '/repo/src/Button.tsx',
        '/repo/.intent-inspector/screenshots/a.webp',
    ]);
    assert.deepEqual(collectClaudeAppFiles(request, { includeScreenshots: false }), ['/repo/src/App.tsx', '/repo/src/Button.tsx']);
    // The legacy single `screenshot` field is the fallback when `screenshots` is empty.
    assert.deepEqual(collectClaudeAppFiles({ screenshots: [], screenshot: { filePath: '/repo/b.webp' } }), ['/repo/b.webp']);
});

test('claude-app send delivers screenshots through absolute @ refs in q and does not claim file attachments', async () => {
    const { root, result, events, url } = await sendWithFakeOpener({});
    assert.equal(result.ok, true);
    const screenshot = path.join(root, '.intent-inspector/screenshots/a.webp');
    // Desktop drops `file`; the prompt is what reaches the agent, and it names the screenshot by absolute path.
    const q = url.searchParams.get('q') ?? '';
    assert.ok(q.split('\n').includes(`@${screenshot}`), q);
    assert.deepEqual(url.searchParams.getAll('folder'), [root]);
    assert.deepEqual(url.searchParams.getAll('file'), [path.join(root, 'src/App.tsx'), path.join(root, 'src/Button.tsx'), screenshot]);
    assert.equal(events.some((event) => /attach/i.test(event.text ?? '')), false);
    const notice = events.find((event) => event.type === 'notice');
    assert.match(notice?.text ?? '', /Claude Desktop ignores them/);
});

test('claude-app file handoff keeps the absolute screenshot ref, and attachFiles: false sends no file params', async () => {
    const { root, result, events, url } = await sendWithFakeOpener({ promptMode: 'file', attachFiles: false });
    assert.equal(result.ok, true);
    const q = url.searchParams.get('q') ?? '';
    assert.ok(q.split('\n').includes(`@${path.join(root, '.intent-inspector/screenshots/a.webp')}`), q);
    assert.ok(result.writtenPromptPath && q.includes(result.writtenPromptPath), q);
    assert.deepEqual(url.searchParams.getAll('file'), []);
    assert.equal(events.some((event) => event.type === 'notice'), false);
});
