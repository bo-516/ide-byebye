import { INSP_PATH_ATTR, MAX_RENDER_CHAIN_ENTRIES, MAX_RENDER_CHAIN_ENTRY_LENGTH } from '../../shared/constants.js';
import { parseInspPathLite } from './insp-path-lite.js';

/**
 * React component-tree reads for the picker (React 16.14–19 dev builds).
 *
 * Purpose: `createPortal` content sits under a container elsewhere in the DOM, so DOM ancestors stop describing where
 * it came from; the fiber's `return` chain still leads back across the portal to the component that rendered it.
 * Boundary: read-only, no React import or devtools hook (the fiber comes from the key React puts on each host node).
 * Foreign nodes, unexpected shapes and walks past {@link MAX_TREE_STEPS} mean "no tree information" (`null` /
 * `false`), so callers keep the DOM rules. Exceptions are caught by `component-tree.ts`, not here.
 */

/** DOM-node key prefixes that point a host node at its fiber: React 17+ first, then React 16. */
export const REACT_FIBER_KEY_PREFIXES = ['__reactFiber$', '__reactInternalInstance$'];
/** Host-element fiber tags: HostComponent (5), and React 19's HostHoistable (26) and HostSingleton (27, `<body>`). */
export const REACT_HOST_TAGS = [5, 26, 27];
/** Fiber tag of a `createPortal` boundary; its `stateNode.containerInfo` is the portal container. */
export const REACT_PORTAL_TAG = 4;
/** Fiber tag of a root (`createRoot` / `hydrateRoot`); its `stateNode.containerInfo` is the root container. */
export const REACT_ROOT_TAG = 3;
/** Most steps one fiber or Vue-instance walk takes; a longer walk counts as "no tree information" (a cycle or junk). */
export const MAX_TREE_STEPS = 512;

/** Fiber fields this module reads. Real fibers carry many more; tests pass plain objects of this shape. */
export interface FiberLike {
    tag: number;
    return: FiberLike | null;
    stateNode: unknown;
    memoizedProps: unknown;
}

/** Logical parent of a host node: the DOM node React attached it to, and whether a portal sits in between. */
export interface HostParent {
    dom: unknown;
    portal: boolean;
}

/** Locations from a pick outward, one per file (`renderChain[0]` is the pick); `portal`: a portal/Teleport was crossed. */
export interface RenderChain {
    renderChain: string[];
    portal: boolean;
}

/**
 * The fiber key last found on a node (`__reactFiber$<random>`), so most lookups skip `Object.keys`. A miss re-scans:
 * a page can run several copies of React (micro-frontends), each with its own key.
 */
let cachedFiberKey: string | null = null;

/**
 * Fiber attached to a DOM node by React.
 *
 * @param {object} node DOM node or test double. Nodes React did not render have no fiber.
 * @returns {FiberLike | null} The fiber, or `null` when the node carries none.
 */
export function fiberOf(node: object): FiberLike | null {
    const record = node as Record<string, unknown>;
    if (cachedFiberKey) {
        const cached = record[cachedFiberKey];
        if (cached && typeof cached === 'object')
            return cached as FiberLike;
    }
    for (const key of Object.keys(node)) {
        if (!REACT_FIBER_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)))
            continue;
        const value = record[key];
        if (!value || typeof value !== 'object')
            return null;
        cachedFiberKey = key;
        return value as FiberLike;
    }
    return null;
}

/**
 * @param {unknown} stateNode `FiberRoot` (tag 3) or portal state (tag 4).
 * @returns {unknown} Its `containerInfo` (the parent for a comment-node root, whose children sit beside the comment).
 */
function containerOf(stateNode: unknown): unknown {
    const container = (stateNode as { containerInfo?: { nodeType?: number, parentNode?: unknown } } | null)?.containerInfo;
    return container?.nodeType === 8 ? container.parentNode : container;
}

/**
 * Where React attached a host node: the DOM node of its nearest host ancestor fiber, or the portal / root container.
 *
 * @param {object} node DOM element or test double.
 * @returns {HostParent | null} Logical parent, or `null` without a fiber or a host ancestor within the step cap.
 */
export function logicalHostParent(node: object): HostParent | null {
    const fiber = fiberOf(node);
    let current = fiber ? fiber.return : null;
    for (let steps = 0; current && steps < MAX_TREE_STEPS; steps += 1) {
        if (REACT_HOST_TAGS.includes(current.tag))
            return { dom: current.stateNode, portal: false };
        if (current.tag === REACT_PORTAL_TAG)
            return { dom: containerOf(current.stateNode), portal: true };
        if (current.tag === REACT_ROOT_TAG)
            return { dom: containerOf(current.stateNode), portal: false };
        current = current.return;
    }
    return null;
}

/**
 * Whether a node is a React boundary — a portal root, or a node moved away from where React put it — whose DOM parent
 * is therefore not its logical parent. DOM walks must not climb past it. Nodes without a fiber never are.
 *
 * @param {object} node DOM element (or test double with `parentNode`).
 * @returns {boolean} True for a portal root or a moved node.
 */
export function isReactBoundary(node: object): boolean {
    const parent = logicalHostParent(node);
    return parent !== null && (parent.portal || parent.dom !== (node as { parentNode?: unknown }).parentNode);
}

/**
 * `data-insp-path` of one fiber: a host fiber's DOM attribute, or the prop a component fiber received (kept in
 * `memoizedProps` even when the component never passes it on to the DOM).
 *
 * @param {FiberLike} fiber Fiber to read.
 * @returns {string | null} Non-empty path, or `null`.
 */
function stampOfFiber(fiber: FiberLike): string | null {
    const host = REACT_HOST_TAGS.includes(fiber.tag) ? fiber.stateNode as { getAttribute?: unknown } | null : null;
    if (host && typeof host.getAttribute === 'function')
        return (host as Element).getAttribute(INSP_PATH_ATTR) || null;
    const props = fiber.memoizedProps;
    const value = props && typeof props === 'object' ? (props as Record<string, unknown>)[INSP_PATH_ATTR] : null;
    return typeof value === 'string' && value ? value : null;
}

/**
 * Nearest `data-insp-path` on a node's fiber or its ancestors, crossing portals: where an unstamped portal root
 * (library markup, excluded files) comes from, e.g. the `<DialogContent>` line around a Radix overlay.
 *
 * @param {object} node DOM element or test double.
 * @returns {string | null} Path in `data-insp-path` form, or `null` when nothing up to the root is stamped.
 */
export function nearestReactStamp(node: object): string | null {
    let current = fiberOf(node);
    for (let steps = 0; current && steps < MAX_TREE_STEPS; steps += 1) {
        const path = stampOfFiber(current);
        if (path)
            return path;
        if (current.tag === REACT_ROOT_TAG)
            return null;
        current = current.return;
    }
    return null;
}

/**
 * Append one render-chain entry unless it adds nothing: an empty or over-long path, a full chain, or the same file as
 * the entry before it (a component's own markup and its call sites in one file collapse into the first one seen).
 *
 * Boundary: mutates `chain`. Shared by the React and Vue chain builders so both apply the same per-file rule.
 *
 * @param {string[]} chain Chain built so far; `chain[0]` is the pick.
 * @param {string | null} path Candidate `data-insp-path`. `null` is ignored.
 * @returns {void}
 */
export function pushChainEntry(chain: string[], path: string | null): void {
    if (!path || path.length > MAX_RENDER_CHAIN_ENTRY_LENGTH || chain.length >= MAX_RENDER_CHAIN_ENTRIES)
        return;
    const last = chain[chain.length - 1];
    if (last !== undefined && parseInspPathLite(last).file === parseInspPathLite(path).file)
        return;
    chain.push(path);
}

/**
 * Render chain of a picked node: its location, then each fiber stamp from another file on the way to the root.
 *
 * Boundary: entries follow {@link pushChainEntry}; once the chain is full the walk still continues to the root, so a
 * portal further out still sets `portal`.
 *
 * @param {object} node The picked element (a DOM hit) or the boundary element (a component-tree fallback).
 * @param {string} pickedPath The pick's own location; becomes `renderChain[0]`.
 * @returns {RenderChain | null} Chain and portal flag, or `null` without a fiber or past {@link MAX_TREE_STEPS}.
 */
export function reactRenderChain(node: object, pickedPath: string): RenderChain | null {
    const fiber = fiberOf(node);
    if (!fiber)
        return null;
    const renderChain = [pickedPath];
    let portal = false;
    let current = fiber.return;
    for (let steps = 0; current && current.tag !== REACT_ROOT_TAG; steps += 1) {
        if (steps >= MAX_TREE_STEPS)
            return null;
        if (current.tag === REACT_PORTAL_TAG)
            portal = true;
        else if (renderChain.length < MAX_RENDER_CHAIN_ENTRIES)
            pushChainEntry(renderChain, stampOfFiber(current));
        current = current.return;
    }
    return { renderChain, portal };
}
