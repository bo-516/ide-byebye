import { INSP_PATH_ATTR } from '../../shared/constants.js';
import { snapshotValue, type StateValue } from '../../shared/state-value.js';
import { fiberOf, REACT_ROOT_TAG } from '../inspect/react-tree.js';
import type { ComponentHandle, ComponentSnapshot } from './state-types.js';

/**
 * Read-only access to one React component instance's props and state (React 16.14–19 dev builds).
 *
 * Purpose: give the dialog the committed state of the component that rendered a picked element, and tell it when that
 * state may have changed, without React DevTools or any React import.
 * Boundary: a DOM node's fiber key, and `.return` chains from it, can lead into the stale alternate tree after a
 * bailout, so state is always read from the fiber found by walking down from `FiberRoot.current`. Hook slots carry no
 * names; only `useState`/`useReducer`-style slots (a queue with `dispatch`) are read, keyed `#<slot>`, and the server
 * names them from source. Shapes this module does not recognize mean "no component" (`null`), never a throw.
 */

/** Fiber tags of components that own state or hooks: Function, Class, ForwardRef, SimpleMemo. */
export const REACT_COMPONENT_TAGS = [0, 1, 11, 15];
/** Fiber tag of class components, whose state is one object instead of a hook list. */
const REACT_CLASS_TAG = 1;
/** Most `.return` steps from a node to its root; deep trees stay far below it. */
const MAX_DEPTH_STEPS = 10000;
/** Most fibers one walk of the current tree visits before giving up. */
const MAX_TREE_VISITS = 200000;
/** Most fibers searched for stamps the component wrote itself. */
const MAX_STAMP_VISITS = 3000;
/** Most stamp candidates sent to the server for hook naming. */
const MAX_STAMP_CANDIDATES = 6;
/** Most hook slots read from one component. */
const MAX_HOOK_SLOTS = 200;
/** Re-read at least this often while subscribed, so commits that flip `FiberRoot.current` back within one frame count. */
export const REACT_POLL_FALLBACK_MS = 300;

/** Fiber fields this module reads. Tests pass plain objects of this shape. */
export interface StateFiber {
    tag: number;
    type: unknown;
    return: StateFiber | null;
    child: StateFiber | null;
    sibling: StateFiber | null;
    alternate: StateFiber | null;
    stateNode: unknown;
    memoizedProps: unknown;
    memoizedState: unknown;
    _debugOwner?: unknown;
}

/** The `FiberRoot` object a `HostRoot` fiber points at; `current` is the committed tree. */
interface FiberRootLike {
    current: StateFiber;
}

/** Frame scheduling used by {@link subscribeReactCommits}; tests inject a manual clock. */
export interface FrameScheduler {
    request: (cb: () => void) => number;
    cancel: (id: number) => void;
    now: () => number;
}

/**
 * Whether a value is a component fiber this module can read.
 *
 * @param {unknown} value Candidate fiber (e.g. a `_debugOwner`, which can also be a server-component info object).
 * @returns {boolean} True for function, class, forwardRef and simple-memo fibers.
 */
function isComponentFiber(value: unknown): boolean {
    return Boolean(value) && typeof value === 'object' && REACT_COMPONENT_TAGS.includes((value as StateFiber).tag);
}

/**
 * Display name of a component fiber's type.
 *
 * @param {StateFiber} fiber Component fiber.
 * @returns {string} `displayName`/`name` of the function, forwardRef render or memo inner type, or `''`.
 */
export function reactComponentName(fiber: StateFiber): string {
    const type = fiber.type as { displayName?: unknown; name?: unknown; render?: { displayName?: unknown; name?: unknown } } | null;
    if (!type || (typeof type !== 'function' && typeof type !== 'object'))
        return '';
    const candidates = [type.displayName, type.name, type.render?.displayName, type.render?.name];
    const found = candidates.find((value) => typeof value === 'string' && value);
    return typeof found === 'string' ? found : '';
}

/**
 * The component that rendered a picked DOM node: its `_debugOwner` (the component whose JSX created the node), else the
 * nearest component fiber above it.
 *
 * @param {object} node Picked DOM element or test double.
 * @returns {StateFiber | null} Component fiber (possibly the stale alternate), or `null` without a React fiber.
 */
export function reactOwnerOf(node: object): StateFiber | null {
    const fiber = fiberOf(node) as StateFiber | null;
    if (!fiber)
        return null;
    if (isComponentFiber(fiber._debugOwner))
        return fiber._debugOwner as StateFiber;
    let current = fiber.return;
    for (let steps = 0; current && steps < MAX_DEPTH_STEPS; steps += 1) {
        if (isComponentFiber(current))
            return current;
        current = current.return;
    }
    return null;
}

/**
 * The `FiberRoot` above a fiber. Either copy of the `HostRoot` fiber points at the same `FiberRoot`, so a stale chain
 * still lands on the right one.
 *
 * @param {StateFiber} fiber Any fiber of the tree.
 * @returns {FiberRootLike | null} Root, or `null` past {@link MAX_DEPTH_STEPS} or without a `HostRoot`.
 */
export function reactRootOf(fiber: StateFiber): FiberRootLike | null {
    let current: StateFiber | null = fiber;
    for (let steps = 0; current && steps < MAX_DEPTH_STEPS; steps += 1) {
        if (current.tag === REACT_ROOT_TAG) {
            const root = current.stateNode as FiberRootLike | null;
            return root && typeof root === 'object' && root.current ? root : null;
        }
        current = current.return;
    }
    return null;
}

/**
 * The committed (current-tree) copy of a fiber, found by walking down from `root.current`.
 *
 * @param {FiberRootLike} root Root of the fiber's tree.
 * @param {StateFiber} fiber Either copy of the target instance.
 * @returns {StateFiber | null} The copy that is mounted now, or `null` when the instance is no longer in the tree.
 */
export function currentFiberOf(root: FiberRootLike, fiber: StateFiber): StateFiber | null {
    const stack: StateFiber[] = [root.current];
    for (let visits = 0; stack.length && visits < MAX_TREE_VISITS; visits += 1) {
        const node = stack.pop() as StateFiber;
        if (node === fiber || node === fiber.alternate)
            return node;
        if (node.sibling)
            stack.push(node.sibling);
        if (node.child)
            stack.push(node.child);
    }
    return null;
}

/**
 * Bounded props of a component, without `children` and the stamper's own prop.
 *
 * @param {unknown} props `memoizedProps`.
 * @returns {Record<string, StateValue>} Props view (empty for non-objects).
 */
function propsView(props: unknown): Record<string, StateValue> {
    const out: Record<string, StateValue> = {};
    if (!props || typeof props !== 'object')
        return out;
    for (const key of Object.keys(props)) {
        if (key !== 'children' && key !== INSP_PATH_ATTR)
            out[key] = snapshotValue((props as Record<string, unknown>)[key], 1);
    }
    return out;
}

/**
 * Bounded state of a component: a class component's state object, or the stateful hook slots of a function component.
 *
 * Boundary: a hook slot counts as state when its `queue` has a `dispatch` function (`useState`, `useReducer`, and the
 * state parts of `useTransition`/`useOptimistic`/`useActionState`). Effects, refs, memos and context take no key.
 *
 * @param {StateFiber} fiber Current component fiber.
 * @returns {Record<string, StateValue>} State view; hook slots are keyed `#<slot>`.
 */
function stateView(fiber: StateFiber): Record<string, StateValue> {
    const out: Record<string, StateValue> = {};
    if (fiber.tag === REACT_CLASS_TAG) {
        const state = fiber.memoizedState;
        if (state && typeof state === 'object') {
            for (const key of Object.keys(state))
                out[key] = snapshotValue((state as Record<string, unknown>)[key], 1);
        }
        return out;
    }
    let hook = fiber.memoizedState as { memoizedState?: unknown; queue?: { dispatch?: unknown } | null; next?: unknown } | null;
    for (let slot = 0; hook && typeof hook === 'object' && slot < MAX_HOOK_SLOTS; slot += 1) {
        if (hook.queue && typeof hook.queue.dispatch === 'function')
            out[`#${slot}`] = snapshotValue(hook.memoizedState, 1);
        hook = hook.next as typeof hook;
    }
    return out;
}

/**
 * `data-insp-path` values written inside a component's own render: props of fibers whose `_debugOwner` is the component.
 *
 * Boundary: a component's root element may carry its usage site instead (the stamper propagates call sites onto
 * roots), so the server checks each candidate against the component name before trusting it. Breadth-first and capped.
 *
 * @param {StateFiber} fiber Current component fiber.
 * @returns {string[]} Up to {@link MAX_STAMP_CANDIDATES} distinct paths.
 */
function ownStampCandidates(fiber: StateFiber): string[] {
    const owners = new Set<unknown>([fiber, fiber.alternate]);
    const found: string[] = [];
    const queue: StateFiber[] = fiber.child ? [fiber.child] : [];
    for (let index = 0; index < queue.length && index < MAX_STAMP_VISITS && found.length < MAX_STAMP_CANDIDATES; index += 1) {
        const node = queue[index];
        const props = node.memoizedProps as Record<string, unknown> | null;
        const stamp = props && typeof props === 'object' ? props[INSP_PATH_ATTR] : null;
        if (owners.has(node._debugOwner) && typeof stamp === 'string' && stamp && !found.includes(stamp))
            found.push(stamp);
        for (let child = node.child; child; child = child.sibling)
            queue.push(child);
    }
    return found;
}

/**
 * Call `onChange` after each commit of a root, polling once per animation frame.
 *
 * Boundary: a commit swaps `root.current`, so a changed identity triggers a read; two commits inside one frame swap it
 * back, so a read also happens every {@link REACT_POLL_FALLBACK_MS}. Nothing is patched into React.
 *
 * @param {FiberRootLike} root Root to watch.
 * @param {() => void} onChange Called when a commit may have happened.
 * @param {FrameScheduler} [scheduler] Frame/clock source; omitted uses `requestAnimationFrame` and `performance.now`.
 * @returns {() => void} Stops polling.
 */
export function subscribeReactCommits(root: FiberRootLike, onChange: () => void, scheduler?: FrameScheduler): () => void {
    const frames: FrameScheduler = scheduler ?? {
        request: (cb) => window.requestAnimationFrame(cb),
        cancel: (id) => window.cancelAnimationFrame(id),
        now: () => performance.now(),
    };
    const tick = () => {
        if (!active)
            return;
        const now = frames.now();
        if (root.current !== lastCurrent || now - lastRead >= REACT_POLL_FALLBACK_MS) {
            lastCurrent = root.current;
            lastRead = now;
            onChange();
        }
        if (active)
            id = frames.request(tick);
    };
    let lastCurrent = root.current;
    let lastRead = frames.now();
    let active = true;
    let id = frames.request(tick);
    return () => {
        active = false;
        frames.cancel(id);
    };
}

/**
 * Handle for the React component that rendered a picked node.
 *
 * @param {object} node Picked DOM element or test double.
 * @param {FrameScheduler} [scheduler] Passed to {@link subscribeReactCommits}; omitted uses the browser's.
 * @returns {ComponentHandle | null} Handle, or `null` without a React owner or root.
 */
export function reactComponentHandle(node: object, scheduler?: FrameScheduler): ComponentHandle | null {
    const owner = reactOwnerOf(node);
    const root = owner ? reactRootOf(owner) : null;
    const current = owner && root ? currentFiberOf(root, owner) : null;
    if (!owner || !root || !current)
        return null;
    const props = current.memoizedProps as Record<string, unknown> | null;
    const usage = props && typeof props === 'object' ? props[INSP_PATH_ATTR] : null;
    return {
        info: {
            framework: 'react',
            name: reactComponentName(current),
            usagePath: typeof usage === 'string' && usage ? usage : null,
            definitionFile: null,
            stampCandidates: ownStampCandidates(current),
            hookState: current.tag !== REACT_CLASS_TAG,
        },
        read(): ComponentSnapshot | null {
            const fiber = currentFiberOf(root, owner);
            return fiber ? { props: propsView(fiber.memoizedProps), state: stateView(fiber) } : null;
        },
        subscribe: (onChange) => subscribeReactCommits(root, onChange, scheduler),
    };
}
