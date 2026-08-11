/**
 * Parity harness: shipped oxc extract vs frozen Babel reference.
 *
 * Not part of the default `npm test` discovery intent for daily speed when heavy;
 * run explicitly: `node --test src/server/ast/jsx-locator.diff.test.js`
 * (node --test still picks it up if you pass the path; default `npm test` runs all
 * `*.test.js` — this file is intentionally named `.diff.test.js` and is included
 * when the runner globs `**/*test.js`. If suite time grows, rename or exclude.)
 *
 * Asserts deepStrictEqual on all SourceContext-like fields except `astError`
 * text; for `astError`, only presence/absence must match.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MAX_COMPONENT_LINES, DEFAULT_MAX_SOURCE_CONTEXT_LINES } from '../../shared/constants.js';
import { extractJsxFromCodeBabel } from './__ref__/jsx-locator-babel.js';
import { extractJsxFromCode } from './jsx-locator.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const MAX_CTX = DEFAULT_MAX_SOURCE_CONTEXT_LINES;
const MAX_COMP = DEFAULT_MAX_COMPONENT_LINES;

/**
 * Normalize extract results for comparison (drop astError text).
 * @param {object} result
 */
function stripAstErrorText(result) {
    const { astError: _a, ...rest } = result;
    return rest;
}

/**
 * Run extractor with throw → astError mapping (matches extractSourceContext).
 * @param {(code: string, line: number, column: number, maxContextLines: number, maxComponentLines: number) => object} fn
 * @param {string} code
 * @param {number} line
 * @param {number} column
 * @param {number} [maxComponentLines]
 */
function safeExtract(fn, code, line, column, maxComponentLines = MAX_COMP) {
    try {
        return fn(code, line, column, MAX_CTX, maxComponentLines);
    }
    catch (err) {
        return { astError: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * Compare shipped vs babel on one (code, line, column).
 * @param {string} label
 * @param {string} code
 * @param {number} line
 * @param {number} column
 * @param {number} [maxComponentLines]
 */
function assertParity(label, code, line, column, maxComponentLines = MAX_COMP) {
    const oxc = safeExtract(extractJsxFromCode, code, line, column, maxComponentLines);
    const babel = safeExtract(extractJsxFromCodeBabel, code, line, column, maxComponentLines);
    try {
        assert.deepStrictEqual(stripAstErrorText(oxc), stripAstErrorText(babel));
        assert.equal(Boolean(oxc.astError), Boolean(babel.astError));
    }
    catch (err) {
        const detail = [
            `PARITY FAIL: ${label}`,
            `  line=${line} column=${column}`,
            `  oxc.selectedNodeRange=${JSON.stringify(oxc.selectedNodeRange)}`,
            `  babel.selectedNodeRange=${JSON.stringify(babel.selectedNodeRange)}`,
            `  oxc.astError=${oxc.astError ? 'yes' : 'no'} babel.astError=${babel.astError ? 'yes' : 'no'}`,
        ].join('\n');
        err.message = `${detail}\n${err.message}`;
        throw err;
    }
}

/**
 * Mulberry32 PRNG for fixed-seed random column samples.
 * @param {number} seed
 */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Collect dense scan positions for a source file.
 * @param {string} code
 * @returns {Array<{ line: number, column: number }>}
 */
function collectScanPositions(code) {
    const lines = code.split('\n');
    const positions = [];
    const seen = new Set();
    const add = (line, column) => {
        const key = `${line}:${column}`;
        if (seen.has(key))
            return;
        seen.add(key);
        positions.push({ line, column });
    };

    for (let i = 0; i < lines.length; i++) {
        const line = i + 1;
        const text = lines[i];
        add(line, 0);
        if (text.length > 0) {
            add(line, text.length);
            add(line, Math.floor(text.length / 2));
        }
        for (let c = 0; c < text.length; c++) {
            if (text[c] === '<') {
                add(line, c);
            }
        }
    }

    const rand = mulberry32(0x0c0c0c0c);
    for (let n = 0; n < 20; n++) {
        const line = 1 + Math.floor(rand() * Math.max(1, lines.length));
        const text = lines[line - 1] ?? '';
        const column = Math.floor(rand() * (text.length + 1));
        add(line, column);
    }
    return positions;
}

/**
 * @param {string} dir
 * @param {RegExp} re
 * @returns {string[]}
 */
function listFilesRecursive(dir, re) {
    if (!fs.existsSync(dir))
        return [];
    const out = [];
    const walk = (d) => {
        for (const name of fs.readdirSync(d)) {
            const p = path.join(d, name);
            const st = fs.statSync(p);
            if (st.isDirectory())
                walk(p);
            else if (re.test(name))
                out.push(p);
        }
    };
    walk(dir);
    return out.sort();
}

// ── Hand-crafted edge cases (§4.2) ──────────────────────────────────────────

const HAND_CASES = [
    {
        name: 'unclosed-jsx',
        code: `export function App() {\n  return <div><span>hi</div>;\n}\n`,
        positions: [{ line: 2, column: 10 }],
    },
    {
        name: 'half-edited-attribute',
        code: `export function App() {\n  return <div className=\n}\n`,
        positions: [{ line: 2, column: 10 }],
    },
    {
        name: 'empty-file',
        code: ``,
        positions: [{ line: 1, column: 0 }],
    },
    {
        name: 'imports-only',
        code: `import React from 'react';\nimport { useState } from 'react';\n`,
        positions: [{ line: 1, column: 0 }, { line: 2, column: 5 }],
    },
    {
        name: 'single-line-file',
        code: `export const X = () => <button>ok</button>;`,
        positions: [{ line: 1, column: 22 }, { line: 1, column: 0 }, { line: 1, column: 42 }],
    },
    {
        name: 'no-trailing-newline',
        code: `export function App() {\n  return <span>x</span>;\n}`,
        positions: [{ line: 2, column: 10 }, { line: 3, column: 0 }],
    },
    {
        name: 'jsx-line1-col0',
        code: `<div className="root">hi</div>\n`,
        positions: [{ line: 1, column: 0 }],
    },
    {
        name: 'jsx-last-cell',
        code: `export function App() {\n  return <i>z</i>;\n}\n`,
        positions: [{ line: 2, column: 15 }],
    },
    {
        name: 'deep-nest-5',
        code: `export function App() {\n  return (\n    <a><b><c><d><e>deep</e></d></c></b></a>\n  );\n}\n`,
        positions: [{ line: 3, column: 16 }, { line: 3, column: 4 }, { line: 3, column: 20 }],
    },
    {
        name: 'fragment-root',
        code: `export function App() {\n  return (\n    <>\n      <span>a</span>\n      <span>b</span>\n    </>\n  );\n}\n`,
        positions: [{ line: 3, column: 4 }, { line: 4, column: 6 }],
    },
    {
        name: 'multi-component',
        code: `function Header() {\n  return <h1>Title</h1>;\n}\nexport function App() {\n  return <div><Header /><button>Go</button></div>;\n}\n`,
        positions: [{ line: 2, column: 10 }, { line: 5, column: 22 }, { line: 5, column: 10 }],
    },
    {
        name: 'class-component',
        code: `import { Component } from 'react';\nexport class Box extends Component {\n  render() {\n    return <div className="box">x</div>;\n  }\n}\n`,
        positions: [{ line: 4, column: 12 }],
    },
    {
        name: 'default-export-arrow',
        code: `export default () => <div className="anon">hi</div>;\n`,
        positions: [{ line: 1, column: 20 }],
    },
    {
        name: 'cjk-emoji',
        code: `// 中文注释 😀\nexport function App() {\n  return <button title="你好">点我 🎉</button>;\n}\n`,
        positions: [{ line: 3, column: 10 }, { line: 3, column: 0 }],
    },
];

test('hand-crafted edge cases: oxc vs babel parity', () => {
    for (const tc of HAND_CASES) {
        for (const pos of tc.positions) {
            assertParity(`hand/${tc.name}`, tc.code, pos.line, pos.column);
        }
        // Also dense-scan multi-line hand cases
        if (tc.code.includes('\n') && tc.code.length > 0) {
            for (const pos of collectScanPositions(tc.code)) {
                assertParity(`hand-scan/${tc.name}`, tc.code, pos.line, pos.column);
            }
        }
    }
});

test('truncation markers match for oversized component', () => {
    const lines = ['export function Huge() {'];
    lines.push('  return (');
    lines.push('    <div>');
    for (let i = 0; i < 80; i++) {
        lines.push(`      <span className="row-${i}">row {${i}}</span>`);
    }
    lines.push('    </div>');
    lines.push('  );');
    lines.push('}');
    lines.push('');
    const code = lines.join('\n');
    const maxComponentLines = 20;
    // Hit near the middle of the component body
    assertParity('truncation', code, 45, 8, maxComponentLines);
    assertParity('truncation-top', code, 3, 6, maxComponentLines);
    assertParity('truncation-bottom', code, 82, 8, maxComponentLines);
});

test('demo/react JSX corpus: dense scan parity', () => {
    const reactDir = path.join(ROOT, 'demo/react/src');
    const files = listFilesRecursive(reactDir, /\.jsx$/);
    assert.ok(files.length >= 5, `expected demo react jsx files, got ${files.length}`);
    let comparisons = 0;
    for (const file of files) {
        const code = fs.readFileSync(file, 'utf8');
        const rel = path.relative(ROOT, file);
        for (const pos of collectScanPositions(code)) {
            assertParity(rel, code, pos.line, pos.column);
            comparisons++;
        }
    }
    assert.ok(comparisons > 100, `expected dense comparisons, got ${comparisons}`);
});

test('largest available monorepo TSX samples (if present)', () => {
    const novelSrc = path.resolve(ROOT, '../../../src');
    const candidates = listFilesRecursive(novelSrc, /\.tsx$/);
    // Prefer largest files by size
    const ranked = candidates
        .map((f) => ({ f, n: fs.statSync(f).size }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 10)
        .map((x) => x.f);

    if (ranked.length === 0) {
        // Synthetic TSX of equivalent shapes when monorepo TSX is unavailable
        const synthetic = `
import type { FC } from 'react';
type Props = { label: string };
export const Badge: FC<Props> = ({ label }) => {
  return <span className="badge">{label satisfies string}</span>;
};
export default function Page() {
  return (
    <main>
      <Badge label="ok" />
      <button onClick={() => console.log('x')}>Go</button>
    </main>
  );
}
`;
        for (const pos of collectScanPositions(synthetic)) {
            assertParity('synthetic-tsx', synthetic, pos.line, pos.column);
        }
        return;
    }

    let comparisons = 0;
    for (const file of ranked) {
        const code = fs.readFileSync(file, 'utf8');
        const rel = path.relative(path.resolve(ROOT, '../../..'), file);
        for (const pos of collectScanPositions(code)) {
            assertParity(rel, code, pos.line, pos.column);
            comparisons++;
        }
    }
    assert.ok(comparisons > 50, `expected TSX comparisons, got ${comparisons}`);
});

test('ref-vs-ref harness sanity (babel equals babel)', () => {
    const code = `export function App() {\n  return <button className="x">Hi</button>;\n}\n`;
    const a = safeExtract(extractJsxFromCodeBabel, code, 2, 10);
    const b = safeExtract(extractJsxFromCodeBabel, code, 2, 10);
    assert.deepStrictEqual(a, b);
});
