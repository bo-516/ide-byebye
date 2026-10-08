import { MAX_TREE_STEPS } from './react-tree.js';

/**
 * Vue 3 Teleport-root detection for the picker (Vue 3.2+ dev builds).
 *
 * Purpose: content moved by `<Teleport>` sits under `<body>` or another container, so DOM walks (stamp lookup,
 * same-size promotion) must stop at its root, and a pick inside it is a portal pick. An element is moved when it lies
 * outside the DOM range its instances rendered in place; it is the root when its DOM parent is not moved with it.
 * Boundary: read-only, using the owner instance Vue dev builds put on every element. Missing owners, unmounted vnodes
 * and walks past `MAX_TREE_STEPS` mean "not a boundary". Exceptions are caught by `component-tree.ts`, not here.
 */

/** Dev-build element key holding the component instance whose render patched the element in. */
const VUE_OWNER_KEY = '__vueParentComponent';
/** Vue `ShapeFlags` bits this module branches on: ELEMENT, FUNCTIONAL | STATEFUL component, TELEPORT, SUSPENSE. */
const SHAPE_ELEMENT = 1;
const SHAPE_COMPONENT = 2 | 4;
const SHAPE_TELEPORT = 64;
const SHAPE_SUSPENSE = 128;

/** Vnode fields this module reads. Fragments and static runs have no type bit and span `el` … `anchor`. */
export interface VNodeLike {
    shapeFlag?: number;
    props?: Record<string, unknown> | null;
    el?: unknown;
    anchor?: unknown;
    component?: InstanceLike | null;
    suspense?: { activeBranch?: VNodeLike | null } | null;
}

/** Component-instance fields this module reads. Tests pass plain objects of this shape. */
export interface InstanceLike {
    parent: InstanceLike | null;
    vnode?: VNodeLike | null;
    subTree?: VNodeLike | null;
}

/** DOM methods the range checks call; test doubles implement the same two. */
interface NodeLike {
    contains?: (other: unknown) => boolean;
    nextSibling?: unknown;
}

/** Where a node sits relative to the DOM a vnode rendered in place; `unknown` when the vnode cannot say. */
type Placement = 'top' | 'nested' | 'outside' | 'unknown';

/**
 * Component instance that rendered an element.
 *
 * @param {object} el DOM element or test double.
 * @returns {InstanceLike | null} The owner, or `null` outside Vue dev builds.
 */
export function vueOwnerOf(el: object): InstanceLike | null {
    const owner = (el as Record<string, unknown>)[VUE_OWNER_KEY];
    return owner && typeof owner === 'object' ? owner as InstanceLike : null;
}

/** @returns {boolean} Whether DOM-like `a` contains `b` (or is `b`). */
function contains(a: unknown, b: unknown): boolean {
    return typeof (a as NodeLike | null)?.contains === 'function' && (a as NodeLike).contains!(b);
}

/** Placement of `node` among the siblings `start` … `end` (a fragment, static run, or disabled Teleport). */
function siblingPlacement(start: unknown, end: unknown, node: unknown): Placement {
    let current = start as NodeLike | null | undefined;
    for (let steps = 0; current && steps < MAX_TREE_STEPS; steps += 1) {
        if (current === node)
            return 'top';
        if (contains(current, node))
            return 'nested';
        if (current === end)
            return 'outside';
        current = current.nextSibling as NodeLike | null | undefined;
    }
    return 'unknown';
}

/**
 * Where `node` sits in the DOM a vnode rendered in place: one of its top-level nodes, inside one, or outside (an
 * enabled Teleport renders nothing in place, so its content is always outside).
 *
 * @param {VNodeLike | null | undefined} vnode An instance's `subTree`, or a vnode inside it.
 * @param {unknown} node DOM node to place.
 * @param {number} [depth] Nested component / Suspense levels already entered.
 * @returns {Placement} The placement; `unknown` for a missing or unmounted vnode.
 */
function placementIn(vnode: VNodeLike | null | undefined, node: unknown, depth = 0): Placement {
    if (!vnode || !vnode.el || depth >= MAX_TREE_STEPS)
        return 'unknown';
    const flag = Number(vnode.shapeFlag) || 0;
    if (flag & SHAPE_COMPONENT)
        return placementIn(vnode.component?.subTree, node, depth + 1);
    if (flag & SHAPE_SUSPENSE)
        return placementIn(vnode.suspense?.activeBranch, node, depth + 1);
    if (flag & SHAPE_TELEPORT) {
        const disabled = vnode.props?.disabled;
        return disabled || disabled === '' ? siblingPlacement(vnode.el, vnode.anchor, node) : 'outside';
    }
    if (flag & SHAPE_ELEMENT) {
        if (vnode.el === node)
            return 'top';
        return contains(vnode.el, node) ? 'nested' : 'outside';
    }
    return vnode.anchor ? siblingPlacement(vnode.el, vnode.anchor, node) : 'outside';
}

/**
 * Instance whose in-place DOM `el` was moved out of: walking from its owner, each level where `el` is a top-level node
 * defers to the parent instance; the first level where it is outside the range is the one that teleported it.
 *
 * @param {Element} el Element to check.
 * @returns {InstanceLike | null} That instance, or `null` when `el` sits where its instances rendered it.
 */
function movedBy(el: Element): InstanceLike | null {
    let instance = vueOwnerOf(el);
    for (let steps = 0; instance && steps < MAX_TREE_STEPS; steps += 1) {
        const placement = placementIn(instance.subTree, el);
        if (placement === 'outside')
            return instance;
        if (placement !== 'top')
            return null;
        instance = instance.parent;
    }
    return null;
}

/** @returns {boolean} Whether `el` was rendered by `ancestor` or by a component below it. */
function ownedUnder(el: Element, ancestor: InstanceLike): boolean {
    let instance = vueOwnerOf(el);
    for (let steps = 0; instance && steps < MAX_TREE_STEPS; steps += 1) {
        if (instance === ancestor)
            return true;
        instance = instance.parent;
    }
    return false;
}

/**
 * Whether `el` is a Teleport root (or was moved by other code): its DOM parent is not its logical parent.
 *
 * Boundary: an element whose parent has the same owner is never a root. Otherwise `el` must have been moved out of an
 * instance's range, and its parent must not be part of that same moved content (rendered under the instance that
 * moved `el` and itself outside that instance's range).
 *
 * @param {Element} el DOM element.
 * @returns {boolean} True for a Teleport root.
 */
export function isVueBoundary(el: Element): boolean {
    const owner = vueOwnerOf(el);
    const parent = el.parentElement;
    if (!owner || (parent && vueOwnerOf(parent) === owner))
        return false;
    const mover = movedBy(el);
    if (!mover)
        return false;
    return !parent || !ownedUnder(parent, mover) || placementIn(mover.subTree, parent) !== 'outside';
}

/**
 * Whether `el` is Teleport content: it, or an ancestor, is a Teleport root.
 *
 * @param {Element} el DOM element.
 * @returns {boolean} True inside teleported content.
 */
export function isVueTeleported(el: Element): boolean {
    let node: Element | null = el;
    for (let steps = 0; node && steps < MAX_TREE_STEPS; steps += 1) {
        if (isVueBoundary(node))
            return true;
        node = node.parentElement;
    }
    return false;
}
