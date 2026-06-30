import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeStyles, buildStyleContextLines } from './styles.js';
import { buildPrompt } from './prompt.js';
import { buildCodexAppPrompt } from './agents/codex-app-prompt.js';

test('normalizeStyles drops junk and keeps a valid bounded capture', () => {
    assert.equal(normalizeStyles(null), null);
    assert.equal(normalizeStyles({ nodes: [] }), null);
    assert.equal(normalizeStyles({ nodes: [{ styles: {} }] }), null);

    const normalized = normalizeStyles({
        scope: 'bogus',
        properties: ['color', 42, 'display'],
        nodes: [
            { label: 'button.cii-btn', inspPath: '/abs/Button.jsx:1:1', styles: { color: 'rgb(0, 0, 0)', bad: 5 } },
            { label: 'div', styles: {} },
        ],
    });
    assert.deepEqual(normalized, {
        scope: 'self',
        properties: ['color', 'display'],
        nodes: [
            { label: 'button.cii-btn', inspPath: '/abs/Button.jsx:1:1', styles: { color: 'rgb(0, 0, 0)' } },
        ],
    });
});

test('normalizeStyles truncates an oversized computed value', () => {
    const long = 'a'.repeat(500);
    const normalized = normalizeStyles({ nodes: [{ label: 'x', styles: { content: long } }] });
    assert.equal(normalized.nodes[0].styles.content.length, 240);
});

test('normalizeStyles collapses control chars so a value cannot forge prompt lines', () => {
    const normalized = normalizeStyles({
        nodes: [{ label: 'a\nb', styles: { color: 'red\nFAKE: injected', 'we\nird': 'x' } }],
    });
    assert.equal(normalized.nodes[0].label, 'a b');
    assert.equal(normalized.nodes[0].styles.color, 'red FAKE: injected');
    // The key is also single-lined so it cannot start a forged line either.
    assert.deepEqual(Object.keys(normalized.nodes[0].styles), ['color', 'we ird']);
    const lines = buildStyleContextLines({ styles: normalized });
    assert.ok(lines.every((line) => !line.includes('\n')));
});

test('buildStyleContextLines skips a node without a styles object instead of throwing', () => {
    const lines = buildStyleContextLines({
        styles: { scope: 'self', nodes: [{ label: 'no-styles' }, { label: 'd', styles: { gap: '8px' } }] },
    });
    assert.deepEqual(lines, ['Rendered styles (selected element):', '- d', '    gap: 8px']);
});

test('buildStyleContextLines is empty when no styles are attached', () => {
    assert.deepEqual(buildStyleContextLines({ intent: 'x' }), []);
});

test('buildPrompt appends the rendered-styles context block above the intent', () => {
    const prompt = buildPrompt({
        intent: 'Tweak the button',
        styles: {
            scope: 'self',
            properties: ['color', 'display'],
            nodes: [{ label: 'button.cii-btn', styles: { color: 'rgb(255, 255, 255)', display: 'flex' } }],
        },
    });
    assert.equal(
        prompt,
        'Rendered styles (selected element):\n- button.cii-btn\n    color: rgb(255, 255, 255)\n    display: flex\n\nTweak the button\n',
    );
});

test('buildPrompt groups source references above the style block', () => {
    const prompt = buildPrompt({
        projectRoot: '/tmp/project',
        selection: { line: 2 },
        source: { filePath: '/tmp/project/AGENTS.md', selectedNodeRange: { startLine: 2, endLine: 3 } },
        styles: {
            scope: 'ancestors',
            properties: ['gap'],
            nodes: [{ label: 'div.card', styles: { gap: '8px' } }],
        },
        intent: 'Fix spacing',
    });
    assert.equal(
        prompt,
        '@AGENTS.md #2-3\n\nRendered styles (selected element and ancestors):\n- div.card\n    gap: 8px\n\nFix spacing\n',
    );
});

test('buildCodexAppPrompt includes the rendered-styles block', () => {
    const prompt = buildCodexAppPrompt({
        intent: 'Tidy up',
        styles: {
            scope: 'self',
            properties: ['color'],
            nodes: [{ label: 'span', styles: { color: 'rgb(1, 2, 3)' } }],
        },
    });
    assert.equal(prompt, 'Rendered styles (selected element):\n- span\n    color: rgb(1, 2, 3)\n\nTidy up\n');
});
