import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveCodexAppProjectRoot } from './codex-app.js';
import { buildCodexAppPrompt } from './codex-app-prompt.js';

test('buildCodexAppPrompt uses markdown file links for code references', () => {
    const prompt = buildCodexAppPrompt({
        projectRoot: '/tmp/project',
        selection: { line: 2 },
        source: {
            filePath: '/tmp/project/AGENTS.md',
            selectedNodeRange: { startLine: 2, endLine: 3 },
        },
        intent: '这里写的什么内容',
    });

    assert.equal(prompt, '[AGENTS.md #2-3](AGENTS.md#2-#3)\n\n这里写的什么内容\n');
});

test('buildCodexAppPrompt rewrites inline at-mention labels without duplicating them', () => {
    const prompt = buildCodexAppPrompt({
        projectRoot: '/tmp/project',
        selection: { line: 2 },
        source: {
            filePath: '/tmp/project/AGENTS.md',
            selectedNodeRange: { startLine: 2, endLine: 3 },
        },
        intent: '请解释 @AGENTS.md #2-3',
    });

    assert.equal(prompt, '请解释 [AGENTS.md #2-3](AGENTS.md#2-#3)\n');
});

test('buildCodexAppPrompt keeps only refs not already present in the intent header', () => {
    const prompt = buildCodexAppPrompt({
        projectRoot: '/tmp/project',
        selection: { line: 10 },
        source: {
            filePath: '/tmp/project/src/Hero.jsx',
            selectedNodeRange: { startLine: 10, endLine: 12 },
        },
        references: [
            {
                selection: { line: 110 },
                source: {
                    filePath: '/tmp/project/src/Projects.jsx',
                    selectedNodeRange: { startLine: 110, endLine: 131 },
                },
            },
        ],
        intent: 'hello @src/Projects.jsx #110-131',
    });

    assert.equal(prompt, '[src/Hero.jsx #10-12](src/Hero.jsx#10-#12)\n\nhello [src/Projects.jsx #110-131](src/Projects.jsx#110-#131)\n');
});

test('buildCodexAppPrompt rewrites inline webp screenshot refs without duplicating them', () => {
    const prompt = buildCodexAppPrompt({
        projectRoot: '/tmp/project',
        screenshots: [
            { filePath: '/tmp/project/.intent-inspector/screenshots/shwf3fq.webp' },
        ],
        intent: '看一下 @.intent-inspector/screenshots/shwf3fq.webp',
    });

    assert.equal(prompt, '看一下 [.intent-inspector/screenshots/shwf3fq.webp](.intent-inspector/screenshots/shwf3fq.webp)\n');
});

test('resolveCodexAppProjectRoot prefers configured projectRoot', () => {
    const resolved = resolveCodexAppProjectRoot(
        { projectRoot: 'fixtures/app' },
        { projectRoot: '/tmp/vite-root' },
    );

    assert.equal(resolved, path.resolve('fixtures/app'));
});

test('resolveCodexAppProjectRoot falls back to context projectRoot for blank config', () => {
    const resolved = resolveCodexAppProjectRoot(
        { projectRoot: '   ' },
        { projectRoot: '/tmp/vite-root' },
    );

    assert.equal(resolved, '/tmp/vite-root');
});
