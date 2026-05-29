import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPrompt } from './prompt.js';
import { buildPromptMarkdownReferenceLines } from './prompt-markdown.js';

test('buildPrompt ignores stale plan-only flags', () => {
    const prompt = buildPrompt({
        intent: 'Update the dock',
        planMode: true,
    });

    assert.equal(prompt, 'Update the dock\n');
});

test('buildPrompt keeps sdk source references in at-mention format', () => {
    const prompt = buildPrompt({
        projectRoot: '/tmp/project',
        selection: { line: 2 },
        source: {
            filePath: '/tmp/project/AGENTS.md',
            selectedNodeRange: { startLine: 2, endLine: 3 },
        },
        intent: 'Explain it',
    });

    assert.equal(prompt, '@AGENTS.md #2-3\n\nExplain it\n');
});

test('buildPromptMarkdownReferenceLines uses codex app file-link labels', () => {
    const refs = buildPromptMarkdownReferenceLines({
        projectRoot: '/tmp/project',
        selection: { line: 2 },
        source: {
            filePath: '/tmp/project/AGENTS.md',
            selectedNodeRange: { startLine: 2, endLine: 3 },
        },
    });

    assert.deepEqual(refs, ['[AGENTS.md #2-3](AGENTS.md#2-#3)']);
});

test('buildPromptMarkdownReferenceLines uses markdown links for webp screenshots', () => {
    const refs = buildPromptMarkdownReferenceLines({
        projectRoot: '/tmp/project',
        screenshots: [
            { filePath: '/tmp/project/.intent-inspector/screenshots/shwf3fq.webp' },
        ],
    });

    assert.deepEqual(refs, [
        '[.intent-inspector/screenshots/shwf3fq.webp](.intent-inspector/screenshots/shwf3fq.webp)',
    ]);
});
