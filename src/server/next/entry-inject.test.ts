/**
 * Next.js entry injection: where the bootstrap is mounted and that existing positions never move.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { BOOTSTRAP_IDENTIFIER, bootstrapSpecifier, classifyNextModule, injectNextBootstrap } from './entry-inject.js';

const PROJECT = path.resolve('/work/app');
const BOOTSTRAP = path.join(PROJECT, '.intent-inspector/next/bootstrap.js');

/**
 * Run the injector for a module path relative to the fake project.
 *
 * @param {string} rel Module path relative to {@link PROJECT}.
 * @param {string} source Module source.
 * @param {boolean} [customApp] Answer for `hasCustomApp`.
 * @returns {string | null} Injector output.
 */
function inject(rel, source, customApp = false) {
    return injectNextBootstrap({
        source,
        resourcePath: path.join(PROJECT, rel),
        projectDir: PROJECT,
        bootstrapFile: BOOTSTRAP,
        hasCustomApp: () => customApp,
    });
}

const LAYOUT = `import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body data-insp-path="/work/app/app/layout.tsx:6:7:body" className="app">
        <header data-insp-path="/work/app/app/layout.tsx:7:9:header">Top</header>
        {children}
      </body>
    </html>
  );
}
`;

test('root layouts render the bootstrap as the last <body> child and import it at the end', () => {
    const out = inject('app/layout.tsx', LAYOUT);
    assert.ok(out);
    assert.match(out, new RegExp(`\\{children\\}\\n      <${BOOTSTRAP_IDENTIFIER} /></body>`));
    assert.match(out, new RegExp(`\\n;import ${BOOTSTRAP_IDENTIFIER} from "\\.\\./\\.intent-inspector/next/bootstrap\\.js";\\n$`));
});

test('injection keeps every original line (and every data-insp-path position) in place', () => {
    const out = inject('app/layout.tsx', LAYOUT);
    const before = LAYOUT.split('\n');
    const after = out.split('\n');
    for (let i = 0; i < before.length; i += 1) {
        if (before[i].includes('</body>'))
            assert.equal(after[i], before[i].replace('</body>', `<${BOOTSTRAP_IDENTIFIER} /></body>`));
        else
            assert.equal(after[i], before[i], `line ${i + 1} moved`);
    }
});

test("directives stay first: 'use client' layouts are only touched at the end and before </body>", () => {
    const source = `'use client';\nexport default function L({ children }) {\n  return <html><body>{children}</body></html>;\n}\n`;
    const out = inject('src/app/layout.jsx', source);
    assert.ok(out.startsWith(`'use client';\n`));
    assert.match(out, /from "\.\.\/\.\.\/\.intent-inspector\/next\/bootstrap\.js";/);
});

test('every rendered <body> (conditional roots) gets the bootstrap', () => {
    const source = `export default function L({ a, children }) {\n  return a ? <html><body>{children}</body></html> : <html><body className="b">{children}</body></html>;\n}\n`;
    const out = inject('app/layout.js', source);
    assert.equal(out.split(`<${BOOTSTRAP_IDENTIFIER} />`).length - 1, 2);
});

test('modules without a <body> element, TS-only modules and broken modules are left alone', () => {
    assert.equal(inject('app/page.tsx', `export default function P() {\n  return <main>hi</main>;\n}\n`), null);
    assert.equal(inject('app/copy.tsx', `export const text = '<body> tag';\n`), null);
    assert.equal(inject('app/util.ts', `export const body = '<body>';\n`), null);
    assert.equal(inject('app/layout.tsx', `export default function L() {\n  return <html><body></html>;\n}\n`), null);
});

test('injection is idempotent', () => {
    const once = inject('app/layout.tsx', LAYOUT);
    assert.equal(inject('app/layout.tsx', once), null);
});

test('Pages Router: _app gets a side-effect import; pages only when there is no custom _app', () => {
    const app = inject('pages/_app.tsx', `export default function App({ Component, pageProps }) {\n  return <Component {...pageProps} />;\n}\n`, true);
    assert.match(app, /\n;import "\.\.\/\.intent-inspector\/next\/bootstrap\.js";/);
    assert.equal(inject('pages/index.tsx', `export default function Home() {\n  return <p>hi</p>;\n}\n`, true), null);
    const page = inject('src/pages/blog/[slug].js', `export default function Post() {\n  return <p>post</p>;\n}\n`, false);
    assert.match(page, /import "\.\.\/\.\.\/\.\.\/\.intent-inspector\/next\/bootstrap\.js";/);
});

test('server-only and third-party modules are never modified', () => {
    assert.equal(inject('pages/_document.tsx', `export default function D() {\n  return <html><body /></html>;\n}\n`), null);
    assert.equal(inject('pages/api/hello.ts', `export default function handler() {}\n`), null);
    assert.equal(inject('node_modules/ui/Shell.jsx', `export const S = () => <html><body /></html>;\n`), null);
});

test('classifyNextModule distinguishes Pages Router folders from everything else', () => {
    assert.deepEqual(classifyNextModule(path.join(PROJECT, 'pages/_app.page.tsx'), PROJECT), { kind: 'pages', pagesDir: path.join(PROJECT, 'pages'), name: '_app' });
    assert.deepEqual(classifyNextModule(path.join(PROJECT, 'src/components/pages/Home.tsx'), PROJECT), { kind: 'app' });
    assert.equal(classifyNextModule(path.join(PROJECT, 'src/pages/api/x.ts'), PROJECT), null);
});

test('bootstrapSpecifier always yields a relative POSIX specifier', () => {
    assert.equal(bootstrapSpecifier(path.join(PROJECT, 'app/layout.tsx'), BOOTSTRAP), '../.intent-inspector/next/bootstrap.js');
    assert.equal(bootstrapSpecifier(path.join(PROJECT, 'layout.tsx'), BOOTSTRAP), './.intent-inspector/next/bootstrap.js');
});
