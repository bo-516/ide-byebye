import assert from 'node:assert/strict';
import test from 'node:test';
import { INSP_PATH_ATTR } from '../../shared/constants.js';
import { componentLocationOf, isFrameworkBoundary, pickRenderChain } from './component-tree.js';
import { isReactBoundary, logicalHostParent, MAX_TREE_STEPS, nearestReactStamp, reactRenderChain } from './react-tree.js';

/**
 * Fake fiber graphs: plain objects with the four fields the walker reads. Host nodes carry the fiber under a
 * `__reactFiber$<random>` key (or React 16's `__reactInternalInstance$<random>`), exactly like React DOM does.
 */
interface Fiber {
    tag: number;
    return: Fiber | null;
    stateNode: unknown;
    memoizedProps: unknown;
}

interface HostNode {
    parentNode: unknown;
    getAttribute(name: string): string | null;
    [key: string]: unknown;
}

const FIBER_KEY = '__reactFiber$k3x9';

function fiber(tag: number, parent: Fiber | null, extra: Partial<Fiber> = {}): Fiber {
    return { tag, return: parent, stateNode: null, memoizedProps: {}, ...extra };
}

/** A component fiber that received `data-insp-path` (or nothing) from its usage site. */
function component(parent: Fiber | null, path?: string): Fiber {
    return fiber(0, parent, { memoizedProps: path ? { [INSP_PATH_ATTR]: path } : {} });
}

/** A host node attached to `parentNode` in the DOM and under `parentFiber` in the fiber tree. */
function host(parentNode: unknown, parentFiber: Fiber | null, stamp: string | null = null, key = FIBER_KEY) {
    const node: HostNode = {
        parentNode,
        getAttribute: (name: string) => (name === INSP_PATH_ATTR ? stamp : null),
    };
    const own = fiber(5, parentFiber, { stateNode: node, memoizedProps: stamp ? { [INSP_PATH_ATTR]: stamp } : {} });
    node[key] = own;
    return { node, fiber: own };
}

/**
 * App with a ModalHost-rendered portal dialog:
 * root(#root) > App > div.app (main.jsx call site) > ModalHost (App.jsx:24) > HandDialog > portal(body) > mask > panel
 */
function modalHostApp() {
    const container = { nodeType: 1 };
    const body = { nodeType: 1 };
    const root = fiber(3, null, { stateNode: { containerInfo: container } });
    const app = component(root, '/p/src/main.jsx:4:53:App');
    const appDiv = host(container, app, '/p/src/main.jsx:4:53:App');
    const modalHost = component(appDiv.fiber, '/p/src/App.jsx:24:7:ModalHost');
    const dialog = component(modalHost, '/p/src/App.jsx:24:7:ModalHost');
    const portal = fiber(4, dialog, { stateNode: { containerInfo: body }, memoizedProps: [] });
    const mask = host(body, portal, '/p/src/widgets/HandDialog.tsx:5:5:div');
    const panel = host(mask.node, mask.fiber, '/p/src/widgets/HandDialog.tsx:6:7:div');
    return { container, body, root, appDiv, dialog, portal, mask, panel };
}

test('a portal root is a boundary; its children and normal elements are not', () => {
    const app = modalHostApp();
    assert.equal(isReactBoundary(app.mask.node), true);
    assert.deepEqual(logicalHostParent(app.mask.node), { dom: app.body, portal: true });
    assert.equal(isReactBoundary(app.panel.node), false);
    assert.equal(isReactBoundary(app.appDiv.node), false);
});

test('a node moved away from its React parent is a boundary; a node without a fiber never is', () => {
    const app = modalHostApp();
    const moved = host({ nodeType: 1 }, app.appDiv.fiber, '/p/src/App.jsx:30:9:div');
    assert.equal(isReactBoundary(moved.node), true);
    assert.equal(isReactBoundary({ parentNode: app.appDiv.node }), false);
});

test('React 16 nodes use __reactInternalInstance$ keys', () => {
    const body = { nodeType: 1 };
    const portal = fiber(4, component(fiber(3, null), '/p/src/App.jsx:9:3:Modal'), { stateNode: { containerInfo: body } });
    const mask = host(body, portal, null, '__reactInternalInstance$old');
    assert.equal(isReactBoundary(mask.node), true);
    assert.equal(nearestReactStamp(mask.node), '/p/src/App.jsx:9:3:Modal');
});

test('React 19 singletons (<html>, <body>) are host parents, so Next.js layouts are not boundaries', () => {
    const document = { nodeType: 9 };
    const root = fiber(3, null, { stateNode: { containerInfo: document } });
    const html = { parentNode: document, getAttribute: () => null } as HostNode;
    const htmlFiber = fiber(27, root, { stateNode: html });
    html[FIBER_KEY] = htmlFiber;
    const body = host(html, htmlFiber, '/p/app/layout.tsx:11:13:body');
    body.fiber.tag = 27;
    const overlayUsage = component(body.fiber, '/p/app/PortalCase.tsx:21:17:LibOverlay');
    const portal = fiber(4, overlayUsage, { stateNode: { containerInfo: body.node } });
    const mask = host(body.node, component(portal));
    assert.equal(isReactBoundary(html), false);
    assert.equal(isReactBoundary(body.node), false);
    assert.equal(isReactBoundary(mask.node), true);
    // The mask has no stamp: the nearest one is the <LibOverlay> usage, not the stamped <body>.
    assert.equal(nearestReactStamp(mask.node), '/p/app/PortalCase.tsx:21:17:LibOverlay');
});

test('a root rendered into a comment node keeps its children unbounded', () => {
    const parent = { nodeType: 1 };
    const comment = { nodeType: 8, parentNode: parent };
    const top = host(parent, component(fiber(3, null, { stateNode: { containerInfo: comment } })));
    assert.equal(isReactBoundary(top.node), false);
});

test('the nearest stamp crosses the portal and reads component props the DOM never got', () => {
    const container = { nodeType: 1 };
    const body = { nodeType: 1 };
    // FeedbackModal.tsx uses <DialogContent>; the ui/ wrapper and Radix drop the prop before the overlay.
    const usage = component(host(container, component(fiber(3, null, { stateNode: { containerInfo: container } }))).fiber, '/p/src/FeedbackModal.tsx:6:7:DialogContent');
    const radixPortal = component(usage);
    const portal = fiber(4, radixPortal, { stateNode: { containerInfo: body } });
    // A Fragment whose children are a string has non-object memoizedProps; it is skipped, not read.
    const fragment = fiber(7, portal, { memoizedProps: 'text' });
    const overlay = host(body, component(component(fragment)));
    assert.equal(nearestReactStamp(overlay.node), '/p/src/FeedbackModal.tsx:6:7:DialogContent');
    assert.equal(componentLocationOf(overlay.node as unknown as Element), '/p/src/FeedbackModal.tsx:6:7:DialogContent');
});

test('the render chain keeps one entry per file, marks the portal, and stops at the root', () => {
    const app = modalHostApp();
    assert.deepEqual(reactRenderChain(app.mask.node, '/p/src/widgets/HandDialog.tsx:5:5:div'), {
        renderChain: [
            '/p/src/widgets/HandDialog.tsx:5:5:div',
            '/p/src/App.jsx:24:7:ModalHost',
            '/p/src/main.jsx:4:53:App',
        ],
        portal: true,
    });
    assert.deepEqual(reactRenderChain(app.appDiv.node, '/p/src/main.jsx:4:53:App'), {
        renderChain: ['/p/src/main.jsx:4:53:App'],
        portal: false,
    });
});

test('the chain is capped at five entries but a portal further out still counts', () => {
    const body = { nodeType: 1 };
    let parent: Fiber = fiber(3, null);
    parent = fiber(4, component(parent, '/p/src/Outer.jsx:1:1:Outer'), { stateNode: { containerInfo: body } });
    for (let i = 0; i < 6; i += 1)
        parent = component(parent, `/p/src/Level${i}.jsx:${i + 1}:1:Level${i}`);
    const picked = host(body, parent, '/p/src/Picked.jsx:1:1:div');
    const chain = reactRenderChain(picked.node, '/p/src/Picked.jsx:1:1:div');
    assert.equal(chain?.renderChain.length, 5);
    assert.deepEqual(chain?.renderChain.slice(0, 2), ['/p/src/Picked.jsx:1:1:div', '/p/src/Level5.jsx:6:1:Level5']);
    assert.equal(chain?.portal, true);
});

test('over-long chain entries are skipped', () => {
    const body = { nodeType: 1 };
    const portal = fiber(4, component(fiber(3, null), '/p/src/App.jsx:3:1:Ok'), { stateNode: { containerInfo: body } });
    const noisy = component(portal, `/p/${'x'.repeat(1100)}.jsx:1:1:Noisy`);
    const picked = host(body, noisy, '/p/src/Picked.jsx:1:1:div');
    assert.deepEqual(reactRenderChain(picked.node, '/p/src/Picked.jsx:1:1:div')?.renderChain, [
        '/p/src/Picked.jsx:1:1:div',
        '/p/src/App.jsx:3:1:Ok',
    ]);
});

test(`a cyclic fiber chain stops after ${MAX_TREE_STEPS} steps and counts as no tree information`, () => {
    const loop = component(null);
    loop.return = loop;
    const node = host({ nodeType: 1 }, loop);
    assert.equal(logicalHostParent(node.node), null);
    assert.equal(isReactBoundary(node.node), false);
    assert.equal(nearestReactStamp(node.node), null);
    assert.equal(reactRenderChain(node.node, '/p/src/A.jsx:1:1:div'), null);
});

test('errors thrown by framework internals never reach the page', () => {
    const node = { parentNode: null };
    Object.defineProperty(node, '__reactFiber$broken', {
        enumerable: true,
        get() {
            throw new Error('internals changed');
        },
    });
    const el = node as unknown as Element;
    assert.equal(isFrameworkBoundary(el), false);
    assert.equal(componentLocationOf(el), null);
    assert.equal(pickRenderChain(el, '/p/src/A.jsx:1:1:div'), null);
});
