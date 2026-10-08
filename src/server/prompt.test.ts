import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCodexAppFilePrompt, buildCodexAppPrompt } from './agents/codex-app-prompt.js';
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

test('buildPrompt prefers the clicked element range over the containing component', () => {
    const prompt = buildPrompt({
        projectRoot: '/tmp/project',
        selection: { line: 26 },
        source: {
            filePath: '/tmp/project/src/pages/Home.jsx',
            selectedNodeRange: { startLine: 26, endLine: 26 },
            containingComponentRange: { startLine: 4, endLine: 46 },
        },
        intent: 'Align the card copy',
    });

    assert.equal(prompt, '@src/pages/Home.jsx #26\n\nAlign the card copy\n');
});

test('buildPrompt falls back to the insp-path line when the AST node range is missing', () => {
    const prompt = buildPrompt({
        projectRoot: '/tmp/project',
        selection: { line: 26 },
        source: {
            filePath: '/tmp/project/src/pages/Home.jsx',
            containingComponentRange: { startLine: 4, endLine: 46 },
        },
        intent: 'Align the card copy',
    });

    assert.equal(prompt, '@src/pages/Home.jsx #26\n\nAlign the card copy\n');
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

/** A portal pick as the pipeline leaves it: validated chain entries plus `portal: true`. */
const PORTAL_SELECTION = {
    line: 5,
    portal: true,
    renderChain: [
        { file: '/tmp/project/src/widgets/HandDialog.tsx', line: 5, column: 5, tag: 'div' },
        { file: '/tmp/project/src/App.tsx', line: 24, column: 7, tag: 'ModalHost' },
        { file: '/tmp/project/src/main.tsx', line: 4, column: 53, tag: 'App' },
    ],
};
const PORTAL_BASE = {
    projectRoot: '/tmp/project',
    source: {
        filePath: '/tmp/project/src/widgets/HandDialog.tsx',
        selectedNodeRange: { startLine: 5, endLine: 10 },
    },
    intent: 'Make the mask lighter',
};
const CHAIN_LINE = 'Rendered via portal: src/widgets/HandDialog.tsx:5 <div> ← src/App.tsx:24 <ModalHost> ← src/main.tsx:4 <App>';

test('a portal pick adds exactly one render-chain line after the references, before the styles', () => {
    assert.equal(buildPrompt({ ...PORTAL_BASE, selection: { line: 5 } }), '@src/widgets/HandDialog.tsx #5-10\n\nMake the mask lighter\n');
    assert.equal(buildPrompt({ ...PORTAL_BASE, selection: PORTAL_SELECTION }), `@src/widgets/HandDialog.tsx #5-10\n${CHAIN_LINE}\n\nMake the mask lighter\n`);
    const styles = { scope: 'self' as const, nodes: [{ label: 'div.mask', styles: { opacity: '0.4' }, selected: true }] };
    assert.equal(
        buildPrompt({ ...PORTAL_BASE, selection: PORTAL_SELECTION, styles }),
        `@src/widgets/HandDialog.tsx #5-10\n${CHAIN_LINE}\n\nRendered styles (selected element):\n- div.mask [selected]\n    opacity: 0.4\n\nMake the mask lighter\n`,
    );
});

test('Codex App prompts carry the same render-chain line after their links', () => {
    const link = '[src/widgets/HandDialog.tsx #5-10](src/widgets/HandDialog.tsx#5-#10)';
    assert.equal(buildCodexAppPrompt({ ...PORTAL_BASE, selection: { line: 5 } }), `${link}\n\nMake the mask lighter\n`);
    assert.equal(buildCodexAppPrompt({ ...PORTAL_BASE, selection: PORTAL_SELECTION }), `${link}\n${CHAIN_LINE}\n\nMake the mask lighter\n`);
    assert.equal(
        buildCodexAppFilePrompt({ ...PORTAL_BASE, selection: PORTAL_SELECTION }, '/tmp/project/.intent-inspector/requests/a.md'),
        `${link}\n${CHAIN_LINE}\n/tmp/project/.intent-inspector/requests/a.md\n\nMake the mask lighter\n`,
    );
});
