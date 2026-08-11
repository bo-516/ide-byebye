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
            { label: 'button.cii-btn', inspPath: '/abs/Button.jsx:1:1', styles: { color: 'rgb(0, 0, 0)' }, parent: -1 },
        ],
    });
});

test('normalizeStyles preserves selected and re-maps parent across a dropped node', () => {
    const normalized = normalizeStyles({
        scope: 'children',
        properties: ['display'],
        nodes: [
            { label: 'root', parent: -1, styles: { display: 'grid' } },
            { label: 'dropped', parent: 0, styles: {} }, // no valid styles -> dropped, index shifts
            { label: 'leaf', parent: 0, selected: true, styles: { display: 'flex' } },
        ],
    });
    assert.deepEqual(normalized.nodes, [
        { label: 'root', inspPath: undefined, styles: { display: 'grid' }, parent: -1 },
        { label: 'leaf', inspPath: undefined, styles: { display: 'flex' }, selected: true, parent: 0 },
    ]);
});

test('normalizeStyles keeps the children scope', () => {
    const normalized = normalizeStyles({
        scope: 'children',
        properties: ['display'],
        nodes: [{ label: 'ul.menu', styles: { display: 'flex' } }],
    });
    assert.equal(normalized.scope, 'children');
});

test('normalizeStyles keeps the both scope', () => {
    const normalized = normalizeStyles({
        scope: 'both',
        properties: ['display'],
        nodes: [{ label: 'div.card', styles: { display: 'grid' } }],
    });
    assert.equal(normalized.scope, 'both');
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

test('buildStyleContextLines labels the descendants scope', () => {
    const lines = buildStyleContextLines({
        styles: { scope: 'children', nodes: [{ label: 'ul.menu', styles: { gap: '4px' } }] },
    });
    assert.deepEqual(lines, ['Rendered styles (selected element and descendants):', '- ul.menu', '    gap: 4px']);
});

test('buildStyleContextLines labels the both scope', () => {
    const lines = buildStyleContextLines({
        styles: { scope: 'both', nodes: [{ label: 'div.card', styles: { gap: '4px' } }] },
    });
    assert.deepEqual(lines, ['Rendered styles (selected element, ancestors and descendants):', '- div.card', '    gap: 4px']);
});

test('buildStyleContextLines appends a project-relative source ref with the line from the node insp-path', () => {
    const lines = buildStyleContextLines({
        projectRoot: '/tmp/project',
        styles: {
            scope: 'ancestors',
            nodes: [{ label: 'button.btn.primary', inspPath: '/tmp/project/src/Toolbar.tsx:12:4', styles: { display: 'flex' } }],
        },
    });
    assert.deepEqual(lines, [
        'Rendered styles (selected element and ancestors):',
        '- button.btn.primary (@src/Toolbar.tsx:12)',
        '    display: flex',
    ]);
});

test('buildStyleContextLines keeps a space before the ref so a bracketed Tailwind label cannot form a markdown link', () => {
    const lines = buildStyleContextLines({
        projectRoot: '/tmp/project',
        styles: {
            scope: 'self',
            nodes: [{ label: 'div.relative.mb-[1.05rem]', inspPath: '/tmp/project/src/Box.tsx:7:2', styles: { display: 'block' } }],
        },
    });
    // The `]` must NOT be immediately followed by `(` — otherwise `[1.05rem](@...)` renders as a link labelled "1.05rem".
    assert.equal(lines[1], '- div.relative.mb-[1.05rem] (@src/Box.tsx:7)');
    assert.ok(!/\]\(/.test(lines[1]));
});

test('buildStyleContextLines drops an out-of-root insp-path instead of leaking the absolute path', () => {
    const lines = buildStyleContextLines({
        projectRoot: '/tmp/project',
        styles: { scope: 'self', nodes: [{ label: 'span', inspPath: '/etc/passwd:1:1', styles: { color: 'red' } }] },
    });
    assert.deepEqual(lines, ['Rendered styles (selected element):', '- span', '    color: red']);
});

test('buildStyleContextLines omits the ref when projectRoot is absent', () => {
    const lines = buildStyleContextLines({
        styles: { scope: 'self', nodes: [{ label: 'span', inspPath: '/tmp/project/src/x.tsx:1:1', styles: { color: 'red' } }] },
    });
    assert.deepEqual(lines, ['Rendered styles (selected element):', '- span', '    color: red']);
});

test('buildStyleContextLines renders a parent/child tree with indentation and a selected marker', () => {
    const lines = buildStyleContextLines({
        styles: {
            scope: 'both',
            nodes: [
                { label: 'div.toolbar', parent: 1, selected: true, styles: { display: 'flex' } },
                { label: 'main#app', parent: -1, styles: { display: 'grid' } },
                { label: 'button.btn', parent: 0, styles: { display: 'inline-flex' } },
                { label: 'span.icon', parent: 0, styles: { display: 'block' } },
                { label: 'i.chevron', parent: 3, styles: { display: 'inline-block' } },
            ],
        },
    });
    assert.deepEqual(lines, [
        'Rendered styles (selected element, ancestors and descendants):',
        '- main#app',
        '    display: grid',
        '  - div.toolbar [selected]',
        '      display: flex',
        '    - button.btn',
        '        display: inline-flex',
        '    - span.icon',
        '        display: block',
        '      - i.chevron',
        '          display: inline-block',
    ]);
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
