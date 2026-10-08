import assert from 'node:assert/strict';
import test from 'node:test';
import { INSP_PATH_ATTR } from '../../shared/constants.js';
import { isFrameworkBoundary, vueFallbackElement } from './component-tree.js';
import { isVueBoundary, isVueTeleported } from './vue-teleport.js';
import { nearestVueStamp, vueOwnerTop, vueRenderChain } from './vue-tree.js';

/**
 * Fake Vue dev build: DOM nodes with `parentElement` / `nextSibling` / `contains`, each element carrying the instance
 * that rendered it under `__vueParentComponent`, and instances with `parent`, `vnode.props` and `subTree`.
 */
interface Instance {
    parent: Instance | null;
    vnode: { props: Record<string, unknown> | null };
    subTree: Record<string, unknown> | null;
}

class FakeNode {
    parentElement: FakeNode | null = null;
    nextSibling: FakeNode | null = null;
    children: FakeNode[] = [];
    __vueParentComponent?: Instance;

    constructor(owner?: Instance) {
        if (owner)
            this.__vueParentComponent = owner;
    }

    append(...nodes: FakeNode[]): this {
        for (const node of nodes) {
            const previous = this.children[this.children.length - 1];
            if (previous)
                previous.nextSibling = node;
            node.parentElement = this;
            this.children.push(node);
        }
        return this;
    }

    contains(other: unknown): boolean {
        for (let node = other as FakeNode | null; node; node = node.parentElement) {
            if (node === this)
                return true;
        }
        return false;
    }
}

const asElement = (node: FakeNode) => node as unknown as Element;

function instance(parent: Instance | null, path?: string): Instance {
    return { parent, vnode: { props: path ? { [INSP_PATH_ATTR]: path } : null }, subTree: null };
}

const element = (el: FakeNode) => ({ shapeFlag: 1 | 16, el });
const fragment = (el: FakeNode, anchor: FakeNode) => ({ shapeFlag: 16, el, anchor });
const teleport = (el: FakeNode, anchor: FakeNode, props: Record<string, unknown> = { to: 'body' }) => ({ shapeFlag: 64 | 16, el, anchor, props });

/**
 * body > #root > .app (App) > section (TeleportDemo, used at App.vue:128) holding two Teleport placeholders.
 * The hand-written Teleport puts mask > panel into body; LibDialog (used at TeleportDemo.vue:31) is a Teleport root
 * whose lib-mask > lib-box > header land in body too.
 */
function teleportDemo() {
    const body = new FakeNode();
    const root = new FakeNode();
    const app = instance(null);
    const appEl = new FakeNode(app);
    app.subTree = element(appEl);
    body.append(root.append(appEl));
    const demo = instance(app, '/p/src/App.vue:128:7:TeleportDemo');
    const section = new FakeNode(demo);
    const handStart = new FakeNode();
    const handEnd = new FakeNode();
    const libStart = new FakeNode();
    const libEnd = new FakeNode();
    section.append(handStart, handEnd, libStart, libEnd);
    appEl.append(section);
    demo.subTree = element(section);
    const mask = new FakeNode(demo);
    const panel = new FakeNode(demo);
    body.append(mask.append(panel));
    const lib = instance(demo, '/p/src/components/TeleportDemo.vue:31:5:LibDialog');
    lib.subTree = teleport(libStart, libEnd);
    const libMask = new FakeNode(lib);
    const libBox = new FakeNode(lib);
    const header = new FakeNode(lib);
    body.append(libMask.append(libBox.append(header)));
    return { body, app, appEl, demo, section, mask, panel, lib, libStart, libEnd, libMask, libBox, header };
}

test('a library Teleport resolves to its usage site and highlights the outermost element it rendered', () => {
    const demo = teleportDemo();
    assert.equal(nearestVueStamp(demo.header), '/p/src/components/TeleportDemo.vue:31:5:LibDialog');
    assert.equal(vueOwnerTop(asElement(demo.header)), asElement(demo.libMask));
    assert.equal(vueFallbackElement(asElement(demo.header)), asElement(demo.libMask));
    assert.equal(vueFallbackElement(asElement(demo.appEl)), null);
});

test('Teleport roots are boundaries; their content and in-place elements are not', () => {
    const demo = teleportDemo();
    assert.equal(isVueBoundary(asElement(demo.libMask)), true);
    assert.equal(isVueBoundary(asElement(demo.mask)), true);
    assert.equal(isFrameworkBoundary(asElement(demo.mask)), true);
    assert.equal(isVueBoundary(asElement(demo.libBox)), false);
    assert.equal(isVueBoundary(asElement(demo.panel)), false);
    assert.equal(isVueBoundary(asElement(demo.section)), false);
    assert.equal(isVueBoundary(asElement(demo.appEl)), false);
});

test('a child component root inside Teleport content is not a boundary, but one teleported directly is', () => {
    const demo = teleportDemo();
    const inside = instance(demo.demo, '/p/src/components/TeleportDemo.vue:25:9:Child');
    const insideRoot = new FakeNode(inside);
    inside.subTree = element(insideRoot);
    demo.panel.append(insideRoot);
    const direct = instance(demo.demo, '/p/src/components/TeleportDemo.vue:40:7:Child');
    const directRoot = new FakeNode(direct);
    direct.subTree = element(directRoot);
    demo.body.append(directRoot);
    assert.equal(isVueBoundary(asElement(insideRoot)), false);
    assert.equal(isVueTeleported(asElement(insideRoot)), true);
    assert.equal(isVueBoundary(asElement(directRoot)), true);
});

test('fragment roots and disabled Teleports render in place', () => {
    const demo = teleportDemo();
    const multi = instance(demo.app, '/p/src/App.vue:130:7:Multi');
    const start = new FakeNode();
    const first = new FakeNode(multi);
    const second = new FakeNode(multi);
    const end = new FakeNode();
    demo.appEl.append(start, first, second, end);
    multi.subTree = fragment(start, end);
    assert.equal(isVueBoundary(asElement(second)), false);

    const lib = instance(demo.demo, '/p/src/components/TeleportDemo.vue:33:5:LibDialog');
    const libStart = new FakeNode();
    const inline = new FakeNode(lib);
    const libEnd = new FakeNode();
    demo.section.append(libStart, inline, libEnd);
    lib.subTree = teleport(libStart, libEnd, { to: 'body', disabled: '' });
    assert.equal(isVueBoundary(asElement(inline)), false);
    assert.equal(isVueTeleported(asElement(inline)), false);
});

test('a Teleport into a container elsewhere in the app is still a boundary', () => {
    const demo = teleportDemo();
    const container = new FakeNode(demo.app);
    demo.appEl.append(container);
    const card = new FakeNode(demo.demo);
    container.append(card);
    assert.equal(isVueBoundary(asElement(card)), true);
});

test('the render chain lists usage sites outward, one per file, and flags Teleport content', () => {
    const demo = teleportDemo();
    assert.deepEqual(vueRenderChain(asElement(demo.mask), '/p/src/components/TeleportDemo.vue:23:7:div'), {
        renderChain: ['/p/src/components/TeleportDemo.vue:23:7:div', '/p/src/App.vue:128:7:TeleportDemo'],
        portal: true,
    });
    // A library fallback starts from its own usage site; the owner's identical file is not repeated.
    assert.deepEqual(vueRenderChain(asElement(demo.libMask), '/p/src/components/TeleportDemo.vue:31:5:LibDialog'), {
        renderChain: ['/p/src/components/TeleportDemo.vue:31:5:LibDialog', '/p/src/App.vue:128:7:TeleportDemo'],
        portal: true,
    });
    assert.equal(vueRenderChain(asElement(demo.section), '/p/src/App.vue:128:7:TeleportDemo')?.portal, false);
    assert.equal(vueRenderChain(asElement(new FakeNode()), '/p/src/A.vue:1:1:div'), null);
});

test('unmounted or cyclic instances count as no tree information', () => {
    const demo = teleportDemo();
    demo.lib.subTree = null;
    assert.equal(isVueBoundary(asElement(demo.libMask)), false);
    const loop = instance(null);
    loop.parent = loop;
    const node = new FakeNode(loop);
    demo.body.append(node);
    assert.equal(nearestVueStamp(node), null);
    assert.equal(isVueBoundary(asElement(node)), false);
});
