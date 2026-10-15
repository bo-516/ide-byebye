import { diffValues, type StateChange } from '../../shared/state-value.js';
import { reactComponentHandle } from './react-state.js';
import { vueComponentHandle } from './vue-state.js';
import type { ComponentHandle, ComponentSnapshot, StateWatchResult, TimedStateChange } from './state-types.js';

/**
 * Find the component behind a picked element and record how its props/state change over time.
 *
 * Boundary: framework detection is React first, then Vue 3; anything else (Svelte, Solid, Angular, Preact, production
 * builds) has no handle. Reader exceptions on unexpected internals are caught and mean "no component" or "no change".
 */

/** Most changes one watch keeps; later ones are only counted. */
export const MAX_WATCH_CHANGES = 300;

/** Live watch session returned by {@link startStateWatch}. */
export interface StateWatchSession {
    /** Changes logged so far (including dropped ones). */
    count(): number;
    /** Milliseconds since the watch started. */
    elapsedMs(): number;
    /** Read one last time, unsubscribe, and return the log. Safe to call once. */
    stop(): StateWatchResult;
}

/**
 * Handle for the React or Vue component that rendered `element`.
 *
 * @param {Element | null} element Picked element. `null` yields `null`.
 * @returns {ComponentHandle | null} Handle, or `null` when no supported component is found.
 */
export function componentHandleFor(element: Element | null): ComponentHandle | null {
    if (!element)
        return null;
    try {
        return reactComponentHandle(element) ?? vueComponentHandle(element);
    }
    catch {
        return null;
    }
}

/**
 * Leaf changes between two readings, with `props.` / `state.` path prefixes.
 *
 * @param {ComponentSnapshot} prev Older reading.
 * @param {ComponentSnapshot} next Newer reading.
 * @returns {{ changes: StateChange[], dropped: number }} Changes and how many the per-diff cap left out.
 */
export function diffSnapshots(prev: ComponentSnapshot, next: ComponentSnapshot): { changes: StateChange[]; dropped: number } {
    const changes: StateChange[] = [];
    const dropped = diffValues(prev.props, next.props, 'props', changes) + diffValues(prev.state, next.state, 'state', changes);
    return { changes, dropped };
}

/**
 * Start recording the changes of one component.
 *
 * Boundary: throws when the component is already unmounted (nothing to watch). After an unmount the session stops
 * reading and `unmountedAt` is set. Errors thrown by `read()` during the watch are swallowed for that read.
 *
 * @param {ComponentHandle} handle Component to watch.
 * @param {{ now?: () => number, onUpdate?: () => void }} [options] `now` is the clock (default `performance.now`);
 *   `onUpdate` runs after each logged batch so the UI can refresh a counter.
 * @returns {StateWatchSession} Running session.
 */
export function startStateWatch(handle: ComponentHandle, options: { now?: () => number; onUpdate?: () => void } = {}): StateWatchSession {
    const now = options.now ?? (() => performance.now());
    const initial = handle.read();
    if (!initial)
        throw new Error('component unmounted');
    const startedAt = now();
    const changes: TimedStateChange[] = [];
    const check = () => {
        if (unmountedAt !== null)
            return;
        let next: ComponentSnapshot | null;
        try {
            next = handle.read();
        }
        catch {
            return;
        }
        const t = Math.round(now() - startedAt);
        if (!next) {
            unmountedAt = t;
            unsubscribe?.();
            options.onUpdate?.();
            return;
        }
        const diff = diffSnapshots(last, next);
        last = next;
        dropped += diff.dropped;
        for (const change of diff.changes) {
            if (changes.length < MAX_WATCH_CHANGES)
                changes.push({ t, ...change });
            else
                dropped += 1;
        }
        if (diff.changes.length || diff.dropped)
            options.onUpdate?.();
    };
    let last: ComponentSnapshot = initial;
    let dropped = 0;
    let unmountedAt: number | null = null;
    let result: StateWatchResult | null = null;
    // Assigned after the other lets: `check` may run synchronously inside `subscribe` and reads them.
    let unsubscribe: (() => void) | null = null;
    unsubscribe = handle.subscribe(check);
    return {
        count: () => changes.length + dropped,
        elapsedMs: () => now() - startedAt,
        stop() {
            if (result)
                return result;
            check();
            unsubscribe?.();
            result = { durationMs: Math.round(now() - startedAt), initial, changes, dropped, unmountedAt };
            return result;
        },
    };
}
