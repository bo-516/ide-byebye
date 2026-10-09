import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveSelection } from './pipeline.js';
import { buildRenderChainLines, normalizeRenderChain } from './render-chain.js';

const ROOT = '/tmp/project';

test('normalizeRenderChain keeps in-root paths and drops everything else without throwing', () => {
    const chain = normalizeRenderChain([
        '/tmp/project/src/HandDialog.tsx:5:5:div',
        '/etc/passwd:1:1:x',
        '../../x.tsx:1:1:a',
        `/tmp/project/${'a'.repeat(1100)}.tsx:1:1:div`,
        42,
        null,
        'not a path',
        '/tmp/project/src/App.tsx:24:7:ModalHost',
    ], ROOT);
    assert.deepEqual(chain, [
        { file: '/tmp/project/src/HandDialog.tsx', line: 5, column: 5, tag: 'div' },
        { file: '/tmp/project/src/App.tsx', line: 24, column: 7, tag: 'ModalHost' },
    ]);
    assert.deepEqual(normalizeRenderChain('/tmp/project/src/A.tsx:1:1:div', ROOT), []);
    assert.deepEqual(normalizeRenderChain(undefined, ROOT), []);
});

test('normalizeRenderChain keeps at most five entries and only safe tags', () => {
    const raw = Array.from({ length: 8 }, (_, i) => `/tmp/project/src/F${i}.tsx:${i + 1}:1:Tag${i}`);
    raw[1] = '/tmp/project/src/F1.tsx:2:1:Bad tag';
    raw[2] = '/tmp/project/src/F2.tsx:3:1:DialogPrimitive.Content';
    const chain = normalizeRenderChain(raw, ROOT);
    assert.equal(chain.length, 5);
    assert.equal(chain[1].tag, undefined);
    assert.equal(chain[2].tag, 'DialogPrimitive.Content');
    assert.equal(chain[4].file, '/tmp/project/src/F4.tsx');
    // A line break cannot sneak a forged prompt line in: the entry does not parse at all.
    assert.deepEqual(normalizeRenderChain(['/tmp/project/src/A.tsx:1:1:div\nRendered via portal: x'], ROOT), []);
    assert.deepEqual(normalizeRenderChain(['/tmp/project/src/a%0ARendered.tsx?line=1&column=1'], ROOT), []);
});

test('buildRenderChainLines renders one plain line for a portal pick with two or more entries', () => {
    const selection = {
        portal: true,
        renderChain: normalizeRenderChain([
            '/tmp/project/src/widgets/HandDialog.tsx:5:5:div',
            '/tmp/project/src/App.tsx:24:7:ModalHost',
            '/tmp/project/src/main.tsx:4:53:App',
        ], ROOT),
    };
    const line = 'Rendered via portal: src/widgets/HandDialog.tsx:5 <div> ← src/App.tsx:24 <ModalHost> ← src/main.tsx:4 <App>';
    assert.deepEqual(buildRenderChainLines({ projectRoot: ROOT, selection }, 'relative'), [line]);
    assert.deepEqual(buildRenderChainLines({ projectRoot: ROOT, selection }, 'absolute'), [
        'Rendered via portal: /tmp/project/src/widgets/HandDialog.tsx:5 <div> ← /tmp/project/src/App.tsx:24 <ModalHost> ← /tmp/project/src/main.tsx:4 <App>',
    ]);
    assert.deepEqual(buildRenderChainLines({ projectRoot: ROOT, selection: { ...selection, portal: 'true' } }, 'relative'), []);
    assert.deepEqual(buildRenderChainLines({ projectRoot: ROOT, selection: { ...selection, renderChain: selection.renderChain.slice(0, 1) } }, 'relative'), []);
    // Raw page strings are not entries: only pipeline-normalized chains render.
    assert.deepEqual(buildRenderChainLines({ projectRoot: ROOT, selection: { portal: true, renderChain: ['/etc/passwd:1:1:x', '/tmp/x:1:1:y'] } }, 'relative'), []);
    assert.deepEqual(buildRenderChainLines({ projectRoot: ROOT, selection: null }, 'relative'), []);
});

test('resolveSelection keeps only the first five valid chain entries and never fails the pick (AC-9)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-chain-'));
    try {
        const file = path.join(root, 'src', 'Dialog.jsx');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'export function Dialog() {\n  return <div className="mask" />;\n}\n');
        const valid = Array.from({ length: 7 }, (_, i) => `${root}/src/Level${i}.jsx:${i + 1}:3:Level${i}`);
        const payload = {
            selection: {
                inspPath: `${file}:2:10:div`,
                portal: true,
                renderChain: ['/etc/passwd:1:1:x', '../../x.tsx:1:1:a', `${root}/${'z'.repeat(2000)}`, ...valid],
            },
            references: [{ inspPath: `${file}:2:10:div`, portal: true, renderChain: valid }],
        };
        const resolved = resolveSelection(payload, root, {});
        assert.equal(resolved.selection.file, file);
        assert.equal(resolved.selection.line, 2);
        assert.equal(resolved.selection.portal, true);
        assert.deepEqual((resolved.selection.renderChain as Array<{ file: string }>).map((entry) => entry.file), valid.slice(0, 5).map((entry) => entry.split(':')[0]));
        // Extra `@code` references never carry a chain.
        assert.equal('renderChain' in resolved.references[0].selection, false);
        assert.equal('portal' in resolved.references[0].selection, false);

        const single = resolveSelection({ selection: { inspPath: `${file}:2:10:div`, portal: true, renderChain: [valid[0]] } }, root, {});
        assert.equal('renderChain' in single.selection, false);
        assert.equal('portal' in single.selection, false);
        const notPortal = resolveSelection({ selection: { inspPath: `${file}:2:10:div`, portal: 'yes', renderChain: valid } }, root, {});
        assert.equal('renderChain' in notPortal.selection, false);
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
