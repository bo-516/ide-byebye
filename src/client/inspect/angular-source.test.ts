/**
 * Angular dev-mode source resolution against a mocked `window.ng` and element tree.
 *
 * Boundary: plain objects stand in for DOM elements (only the fields the module reads), so no DOM environment is
 * needed. Ownership mirrors Angular: projected content belongs to the component whose template declared it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { angularComponentOf, angularDebugApi, angularLocationLabel, angularSelection } from './angular-source.js';

/** Component classes carrying Angular's dev-mode `debugInfo`. */
class App { }
(App as any).ɵcmp = { debugInfo: { className: 'App', filePath: 'src/app/app.ts', lineNumber: 9 } };
class Card { }
(Card as any).ɵcmp = { debugInfo: { className: 'Card', filePath: 'src/app/card/card.ts', lineNumber: 12 } };

const app = new App();
const card = new Card();

/**
 * Minimal element stand-in.
 *
 * @param {string} tag Tag name.
 * @param {object} [props] `parent`, `owner`, `classes`, `attrs`, `text`.
 * @returns {object} Element-like object.
 */
function el(tag, { parent = null, owner = null, classes = [], attrs = {}, text = '' }: any = {}) {
    const node: any = {
        localName: tag,
        id: attrs.id ?? '',
        classList: classes,
        textContent: text,
        parentElement: parent,
        previousElementSibling: parent?.lastChild ?? null,
        getAttribute: (name) => attrs[name] ?? null,
        __owner: owner,
    };
    if (parent)
        parent.lastChild = node;
    return node;
}

/** `window.ng` double resolving owners from the mock tree. */
const ng = {
    getOwningComponent: (node) => node.__owner,
    getHostElement: (component) => (component === app ? appRoot : cardHost),
};

// <app-root> (host of App) > main.shell > app-card (host of Card, declared by App) > article.card (Card) > em (App)
const appRoot = el('app-root');
const main = el('main', { parent: appRoot, owner: app, classes: ['shell'] });
el('h1', { parent: main, owner: app, classes: ['title'] });
el('app-card', { parent: main, owner: app });
const cardHost = el('app-card', { parent: main, owner: app });
const article = el('article', { parent: cardHost, owner: card, classes: ['card', 'ng-star-inserted'] });
const em = el('em', { parent: article, owner: app, classes: ['projected'], text: '  projected\n beta ' });
const strong = el('strong', { parent: article, owner: card, classes: ['label'], attrs: { role: 'note' }, text: 'beta' });

test('angularDebugApi only accepts a window exposing ng.getOwningComponent', () => {
    assert.equal(angularDebugApi({}), null);
    assert.equal(angularDebugApi({ ng: {} }), null);
    assert.equal(angularDebugApi({ ng }), ng);
});

test('projected content resolves to the declaring component and skips the child component view', () => {
    const selection = angularSelection(em, ng);
    assert.deepEqual(selection.hint.path.map((step) => step.tag), ['main', 'app-card', 'em']);
    assert.equal(selection.hint.path[1].index, 1, 'second app-card declared by App');
    assert.equal(selection.hint.className, 'App');
    assert.equal(selection.hint.text, 'projected beta');
    assert.equal(selection.inspPath, 'src/app/app.ts:9:1:em@main0>app-card1>em0');
});

test('child component elements map to the child template and keep static-looking attributes only', () => {
    const selection = angularSelection(strong, ng);
    assert.equal(selection.inspPath, 'src/app/card/card.ts:12:1:strong@article0>strong0');
    assert.deepEqual(selection.hint.path[0].classes, ['card'], 'ng-* state classes are dropped');
    assert.deepEqual(selection.hint.path[1].attrs, { role: 'note' });
});

test('hover labels are cheap component locations; unknown elements are not Angular', () => {
    assert.equal(angularLocationLabel(article, ng), 'src/app/card/card.ts:12:1:article');
    assert.equal(angularComponentOf(appRoot, ng), null, 'host of the root component has no owner');
    assert.equal(angularSelection(em, null), null);
    const broken = { getOwningComponent: () => { throw new Error('not managed'); } };
    assert.equal(angularComponentOf(em, broken), null);
});
