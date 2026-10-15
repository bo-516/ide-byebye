import assert from 'node:assert/strict';
import test from 'node:test';
import { INSP_PATH_ATTR } from '../../shared/constants.js';
import { currentFiberOf, reactComponentHandle, reactOwnerOf, subscribeReactCommits, type FrameScheduler, type StateFiber } from './react-state.js';

/**
 * Fake fiber graphs. A DOM node carries its fiber under `__reactFiber$<random>` like React DOM. Each tree is built twice
 * (current + alternate) where needed, to reproduce the stale-alternate trap: the DOM node and `_debugOwner` point at the
 * old copy while `FiberRoot.current` leads to the new one.
 */
const FIBER_KEY = '__reactFiber$t3st';

function fiber(tag: number, extra: Partial<StateFiber> = {}): StateFiber {
    return { tag, type: null, return: null, child: null, sibling: null, alternate: null, stateNode: null, memoizedProps: {}, memoizedState: null, ...extra };
}

/** Link `children` under `parent` in order. */
function link(parent: StateFiber, ...children: StateFiber[]): StateFiber {
    parent.child = children[0] ?? null;
    children.forEach((child, i) => {
        child.return = parent;
        child.sibling = children[i + 1] ?? null;
    });
    return parent;
}

/** A hook list: `state` entries get a dispatch queue, `effect` entries do not. */
function hooks(...slots: Array<['state', unknown] | ['effect']>): unknown {
    let head: Record<string, unknown> | null = null;
    for (const slot of [...slots].reverse()) {
        head = slot[0] === 'state'
            ? { memoizedState: slot[1], queue: { dispatch() {} }, next: head }
            : { memoizedState: { tag: 9, create() {} }, queue: null, next: head };
    }
    return head;
}

function FocusTimer() {}

/** Root → FocusTimer → <span>, current copy committed with `left`, stale copy holding `staleLeft`. */
function timerTree(left: number, staleLeft: number) {
    const fiberRoot: { current: StateFiber } = { current: fiber(3) };
    const make = (value: number) => {
        const host = fiber(3, { stateNode: fiberRoot });
        const comp = fiber(0, { type: FocusTimer, memoizedProps: { [INSP_PATH_ATTR]: '/app/src/Sidebar.jsx:67:7:FocusTimer', label: 'x' }, memoizedState: hooks(['state', value], ['state', true], ['effect']) });
        const span = fiber(5, { type: 'span', memoizedProps: { [INSP_PATH_ATTR]: '/app/src/FocusTimer.jsx:40:9:span' } });
        link(host, comp);
        link(comp, span);
        span._debugOwner = comp;
        return { host, comp, span };
    };
    const current = make(left);
    const stale = make(staleLeft);
    for (const key of ['host', 'comp', 'span'] as const) {
        current[key].alternate = stale[key];
        stale[key].alternate = current[key];
    }
    fiberRoot.current = current.host;
    const domNode = { [FIBER_KEY]: stale.span };
    return { fiberRoot, current, stale, domNode };
}

test('reactOwnerOf prefers _debugOwner, then the nearest component above', () => {
    const { stale, domNode } = timerTree(1499, 1500);
    assert.equal(reactOwnerOf(domNode), stale.comp);
    stale.span._debugOwner = null;
    assert.equal(reactOwnerOf(domNode), stale.comp);
    assert.equal(reactOwnerOf({}), null);
});

test('reads committed state through FiberRoot.current, not the stale copy the DOM node points at', () => {
    const { domNode, current } = timerTree(1499, 1500);
    const handle = reactComponentHandle(domNode);
    assert.ok(handle);
    assert.deepEqual(handle.info, {
        framework: 'react',
        name: 'FocusTimer',
        usagePath: '/app/src/Sidebar.jsx:67:7:FocusTimer',
        definitionFile: null,
        stampCandidates: ['/app/src/FocusTimer.jsx:40:9:span'],
        hookState: true,
    });
    assert.deepEqual(handle.read(), { props: { label: 'x' }, state: { '#0': 1499, '#1': true } });
    current.comp.memoizedState = hooks(['state', 1498], ['state', false], ['effect']);
    assert.deepEqual(handle.read()?.state, { '#0': 1498, '#1': false });
});

test('read returns null once the instance left the tree', () => {
    const { domNode, fiberRoot } = timerTree(1, 2);
    const handle = reactComponentHandle(domNode);
    fiberRoot.current = fiber(3, { stateNode: fiberRoot });
    assert.equal(handle?.read(), null);
    assert.equal(currentFiberOf(fiberRoot, fiber(0)), null);
});

test('class components expose their state object by key', () => {
    class Counter {}
    const fiberRoot: { current: StateFiber } = { current: fiber(3) };
    const comp = fiber(1, { type: Counter, memoizedState: { count: 2, open: false } });
    const div = fiber(5, { type: 'div', _debugOwner: comp });
    link(fiberRoot.current, comp);
    fiberRoot.current.stateNode = fiberRoot;
    link(comp, div);
    const handle = reactComponentHandle({ [FIBER_KEY]: div });
    assert.equal(handle?.info.hookState, false);
    assert.deepEqual(handle?.read(), { props: {}, state: { count: 2, open: false } });
});

test('subscribeReactCommits fires on a root swap and on the fallback interval, and stops cleanly', () => {
    const queue: Array<() => void> = [];
    let clock = 0;
    let calls = 0;
    const scheduler: FrameScheduler = { request: (cb) => queue.push(cb), cancel: () => { queue.length = 0; }, now: () => clock };
    const root = { current: fiber(3) };
    const frame = () => queue.shift()?.();
    const stop = subscribeReactCommits(root, () => { calls += 1; }, scheduler);
    frame();
    assert.equal(calls, 0);
    root.current = fiber(3);
    frame();
    assert.equal(calls, 1);
    clock = 1000;
    frame();
    assert.equal(calls, 2);
    stop();
    frame();
    assert.equal(calls, 2);
});
