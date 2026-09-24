/**
 * Angular template matching with the real `@angular/compiler`, end to end through `extractSourceContext`.
 *
 * Boundary: fixtures live under this package's `node_modules/.cache` so `@angular/compiler` (a dev dependency here, a
 * regular dependency in every Angular app) resolves from the component location as it would in a real project.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { normalizeAngularHint } from '../../shared/angular-hint.js';
import { resolveAngularComponentFile } from '../angular/component-file.js';
import { extractSourceContext } from '../source-context.js';

const CACHE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../node_modules/.cache');

const APP_TS = `import { Component, signal } from '@angular/core';
import { Card } from './card/card';

@Component({
  imports: [Card],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  protected readonly items = signal(['alpha', 'beta']);
}
`;

const APP_HTML = `<main class="shell">
  <h1 class="title">Angular probe</h1>
  @for (item of items(); track item) {
    <app-card [label]="item">
      <em class="projected">projected {{ item }}</em>
    </app-card>
  }
  <ng-container>
    <p class="note">first</p>
    <p class="note">second</p>
  </ng-container>
  @if (items().length > 1) {
    <button
      type="button"
      class="cta"
    >Add</button>
  }
  <div *ngIf="show" id="legacy"><span>legacy</span></div>
</main>
`;

const CARD_TS = `import { Component, input } from '@angular/core';

@Component({
  selector: 'app-card',
  template: \`
    <article class="card">
      <strong class="label">{{ label() }}</strong>
      <ng-content />
    </article>
  \`,
})
export class Card {
  readonly label = input('');
}
`;

/**
 * Write the fixture project and run `fn` with its root.
 *
 * @param {(root: string) => void} fn Test body.
 */
function withProject(fn: (root: string) => void) {
    fs.mkdirSync(CACHE, { recursive: true });
    const root = fs.mkdtempSync(path.join(CACHE, 'cii-angular-'));
    try {
        fs.mkdirSync(path.join(root, 'src/app/card'), { recursive: true });
        fs.writeFileSync(path.join(root, 'src/app/app.ts'), APP_TS);
        fs.writeFileSync(path.join(root, 'src/app/app.html'), APP_HTML);
        fs.writeFileSync(path.join(root, 'src/app/card/card.ts'), CARD_TS);
        fn(root);
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

/**
 * Resolve a hint the way the pipeline does.
 *
 * @param {string} root Project root.
 * @param {string} file Component path relative to the root.
 * @param {number} line `debugInfo.lineNumber`.
 * @param {object} rawHint Browser hint.
 * @returns {Record<string, any>} Source context.
 */
function resolve(root, file, line, rawHint) {
    const angular = normalizeAngularHint(rawHint);
    return extractSourceContext({ file: resolveAngularComponentFile(file, root), line, column: 1, angular, projectRoot: root });
}

const step = (tag, extra = {}) => ({ tag, index: 0, ...extra });

test('external templates: the element range points into templateUrl', () => {
    withProject((root) => {
        const out = resolve(root, 'src/app/app.ts', 10, {
            className: 'App',
            path: [step('main', { classes: ['shell'] }), step('button', { classes: ['cta'], attrs: { type: 'button' } })],
            text: 'Add',
        });
        assert.equal(out.filePath, path.join(root, 'src/app/app.html'));
        assert.equal(out.fileLanguage, 'html');
        assert.deepEqual(out.selectedNodeRange, { startLine: 13, endLine: 16 });
        assert.match(out.selectedNodeCode, /^<button[\s\S]*>Add<\/button>$/);
        assert.equal(out.astError, undefined);
    });
});

test('projected content matches in the declaring template; blocks and ng-container are transparent', () => {
    withProject((root) => {
        const em = resolve(root, 'src/app/app.ts', 10, {
            className: 'App',
            path: [step('main'), step('app-card', { index: 1 }), step('em', { classes: ['projected'] })],
            text: 'projected beta',
        });
        assert.deepEqual(em.selectedNodeRange, { startLine: 5, endLine: 5 });
        const second = resolve(root, 'src/app/app.ts', 10, {
            path: [step('main'), step('p', { classes: ['note'], index: 1 })],
            text: 'second',
        });
        assert.equal(second.selectedNodeCode, '<p class="note">second</p>', 'text disambiguates same-tag siblings');
        const legacy = resolve(root, 'src/app/app.ts', 10, {
            path: [step('main'), step('div', { id: 'legacy' }), step('span')],
            text: 'legacy',
        });
        assert.equal(legacy.selectedNodeCode, '<span>legacy</span>', '*ngIf template wrapper is transparent');
    });
});

test('inline templates: ranges stay in the component .ts file', () => {
    withProject((root) => {
        const out = resolve(root, 'src/app/card/card.ts', 13, {
            className: 'Card',
            path: [step('article', { classes: ['card'] }), step('strong', { classes: ['label'] })],
            text: 'beta',
        });
        assert.equal(out.filePath, path.join(root, 'src/app/card/card.ts'));
        assert.deepEqual(out.selectedNodeRange, { startLine: 7, endLine: 7 });
        assert.equal(out.selectedNodeCode, '<strong class="label">{{ label() }}</strong>');
    });
});

test('unmatched elements fall back to the whole template instead of failing', () => {
    withProject((root) => {
        const out = resolve(root, 'src/app/app.ts', 10, { path: [step('video')] });
        assert.equal(out.filePath, path.join(root, 'src/app/app.html'));
        assert.match(out.astError, /not matched/);
        assert.equal(out.selectedNodeRange.startLine, 1);
    });
});

test('a templateUrl escaping the project root is refused and degrades to the component file', () => {
    withProject((root) => {
        fs.writeFileSync(path.join(root, 'src/app/app.ts'), APP_TS.replace('./app.html', '../../../../outside.html'));
        const out = resolve(root, 'src/app/app.ts', 10, { path: [step('main')] });
        assert.equal(out.filePath, path.join(root, 'src/app/app.ts'));
        assert.match(out.astError, /outside/);
    });
});

test('multi-project workspaces resolve debugInfo paths against angular.json project roots', () => {
    withProject((root) => {
        const libDir = path.join(root, 'projects/shop/src/app');
        fs.mkdirSync(libDir, { recursive: true });
        fs.writeFileSync(path.join(libDir, 'shop.ts'), CARD_TS);
        fs.writeFileSync(path.join(root, 'angular.json'), JSON.stringify({ projects: { shop: { root: 'projects/shop' } } }));
        assert.equal(resolveAngularComponentFile('src/app/shop.ts', root), path.join(libDir, 'shop.ts'));
        assert.throws(() => resolveAngularComponentFile('../../etc/passwd', root), /outside/);
    });
});

test('normalizeAngularHint drops malformed steps and caps sizes', () => {
    assert.equal(normalizeAngularHint(null), null);
    assert.equal(normalizeAngularHint({ path: [{ tag: '<script>' }] }), null);
    const hint = normalizeAngularHint({ path: [{ tag: 'DIV', classes: ['a', 7, 'b'], attrs: { type: 'x', onclick: 'y' }, index: -1 }], text: 'x'.repeat(500) });
    assert.deepEqual(hint.path, [{ tag: 'div', classes: ['a', 'b'], attrs: { type: 'x' } }]);
    assert.equal(hint.text.length, 160);
});
