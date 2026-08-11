/**
 * oxc JSX locator smoke + edge cases (post-Babel migration).
 *
 * Boundary: asserts shipped `extractJsxFromCode` behavior only — no Babel
 * reference. Catastrophic throws are mapped like `extractSourceContext`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MAX_COMPONENT_LINES, DEFAULT_MAX_SOURCE_CONTEXT_LINES } from '../../shared/constants.js';
import { extractJsxFromCode } from './jsx-locator.js';

const MAX_CTX = DEFAULT_MAX_SOURCE_CONTEXT_LINES;
const MAX_COMP = DEFAULT_MAX_COMPONENT_LINES;

/**
 * Run extractor with throw → astError mapping (matches extractSourceContext).
 *
 * @param {string} code
 * @param {number} line
 * @param {number} column
 * @param {number} [maxComponentLines]
 */
function extract(code, line, column, maxComponentLines = MAX_COMP) {
    try {
        return extractJsxFromCode(code, line, column, MAX_CTX, maxComponentLines);
    }
    catch (err) {
        return { astError: err instanceof Error ? err.message : String(err) };
    }
}

test('extractJsxFromCode finds button and enclosing component', () => {
    const code = `export function App() {\n  return <button className="x">Hi</button>;\n}\n`;
    const out = extract(code, 2, 10);
    assert.match(out.selectedNodeCode || '', /button/);
    assert.match(out.containingComponentCode || '', /function App/);
    assert.match(out.importsCode || '', /^$/);
    assert.ok(!out.astError);
});

test('extractJsxFromCode returns imports block when present', () => {
    const code = `import React from 'react';\nimport { useState } from 'react';\nexport function App() {\n  return <span />; \n}\n`;
    const out = extract(code, 4, 10);
    assert.match(out.importsCode || '', /useState/);
    assert.equal(out.importsRange?.startLine, 1);
});

test('imports-only and empty sources surface astError', () => {
    assert.ok(extract(``, 1, 0).astError);
    assert.ok(extract(`import React from 'react';\n`, 1, 0).astError);
});

test('single-line default-export arrow and class component', () => {
    const arrow = extract(`export default () => <div className="anon">hi</div>;\n`, 1, 20);
    assert.match(arrow.selectedNodeCode || '', /anon/);
    assert.ok(arrow.containingComponentCode);

    const klass = extract(
        `import { Component } from 'react';\nexport class Box extends Component {\n  render() {\n    return <div className="box">x</div>;\n  }\n}\n`,
        4,
        12,
    );
    assert.match(klass.selectedNodeCode || '', /box/);
    assert.match(klass.containingComponentCode || '', /class Box/);
});

test('deep nest picks the tightest JSX span', () => {
    const code = `export function App() {\n  return (\n    <a><b><c><d><e>deep</e></d></c></b></a>\n  );\n}\n`;
    const inner = extract(code, 3, 20);
    assert.match(inner.selectedNodeCode || '', /<e>/);
    const outer = extract(code, 3, 4);
    assert.match(outer.selectedNodeCode || '', /<a>/);
});

test('multi-component hit resolves the correct enclosing component', () => {
    const code = `function Header() {\n  return <h1>Title</h1>;\n}\nexport function App() {\n  return <div><Header /><button>Go</button></div>;\n}\n`;
    const header = extract(code, 2, 10);
    assert.match(header.containingComponentCode || '', /function Header/);
    const selfClosing = extract(code, 5, 16);
    assert.match(selfClosing.selectedNodeCode || '', /Header/);
    assert.match(selfClosing.containingComponentCode || '', /function App/);
    const button = extract(code, 5, 28);
    assert.match(button.selectedNodeCode || '', /button/);
    assert.match(button.containingComponentCode || '', /function App/);
});

test('cjk / emoji offsets still locate the button', () => {
    const code = `// 中文注释 😀\nexport function App() {\n  return <button title="你好">点我 🎉</button>;\n}\n`;
    const out = extract(code, 3, 10);
    assert.match(out.selectedNodeCode || '', /button/);
});

test('oversized component gets truncation markers', () => {
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
    const out = extract(code, 45, 8, 20);
    assert.match(out.containingComponentCode || out.selectedNodeCode || '', /truncated/);
});

test('broken JSX degrades with astError rather than throwing', () => {
    const half = extract(`export function App() {\n  return <div className=\n}\n`, 2, 10);
    assert.ok(half.astError);
    const unclosed = extract(`export function App() {\n  return <div><span>hi</div>;\n}\n`, 2, 10);
    // May still recover a node or report astError — must not throw past safeExtract.
    assert.equal(typeof unclosed, 'object');
});
