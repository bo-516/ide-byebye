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

test('buildPrompt keeps the primary reference on top and drops inlined extra references', () => {
    const prompt = buildPrompt({
        projectRoot: '/tmp/project',
        selection: { line: 2 },
        source: {
            filePath: '/tmp/project/AGENTS.md',
            selectedNodeRange: { startLine: 2, endLine: 3 },
        },
        references: [
            {
                selection: { line: 9 },
                source: {
                    filePath: '/tmp/project/src/App.jsx',
                    selectedNodeRange: { startLine: 9, endLine: 12 },
                },
            },
        ],
        intent: 'Tidy up @src/App.jsx #9-12 spacing',
    });

    // The primary selection is never inlined by the editor, so it stays on top; the
    // extra reference is inline in the sentence, so it must not be duplicated above.
    assert.equal(prompt, '@AGENTS.md #2-3\n\nTidy up @src/App.jsx #9-12 spacing\n');
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

test('buildPrompt defaults screenshot artifacts to absolute paths (source stays relative)', () => {
    const prompt = buildPrompt({
        projectRoot: '/tmp/project',
        selection: { line: 2 },
        source: {
            filePath: '/tmp/project/src/App.jsx',
            selectedNodeRange: { startLine: 2, endLine: 4 },
        },
        screenshots: [
            { filePath: '/tmp/project/.intent-inspector/screenshots/n708w16.webp' },
        ],
        intent: 'fix the height',
    });

    assert.equal(
        prompt,
        '@src/App.jsx #2-4\n@/tmp/project/.intent-inspector/screenshots/n708w16.webp\n\nfix the height\n',
    );
});

test('buildPrompt pathStyle absolute makes source absolute; artifacts stay absolute by default', () => {
    const prompt = buildPrompt({
        projectRoot: '/tmp/project',
        selection: { line: 2 },
        source: {
            filePath: '/tmp/project/src/App.jsx',
            selectedNodeRange: { startLine: 2, endLine: 4 },
        },
        screenshots: [
            { filePath: '/tmp/project/.intent-inspector/screenshots/n708w16.webp' },
        ],
        intent: 'look',
    }, { pathStyle: 'absolute' });

    assert.equal(
        prompt,
        '@/tmp/project/src/App.jsx #2-4\n@/tmp/project/.intent-inspector/screenshots/n708w16.webp\n\nlook\n',
    );
});

test('buildPrompt artifactPathStyle relative keeps short screenshot chips', () => {
    const prompt = buildPrompt({
        projectRoot: '/tmp/project',
        selection: { line: 2 },
        source: {
            filePath: '/tmp/project/src/App.jsx',
            selectedNodeRange: { startLine: 2, endLine: 4 },
        },
        screenshots: [
            { filePath: '/tmp/project/.intent-inspector/screenshots/n708w16.webp' },
        ],
        intent: 'look',
    }, { pathStyle: 'relative', artifactPathStyle: 'relative' });

    assert.equal(
        prompt,
        '@src/App.jsx #2-4\n@.intent-inspector/screenshots/n708w16.webp\n\nlook\n',
    );
});
