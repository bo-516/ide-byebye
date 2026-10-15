import type { StateChange, StateValue } from '../../shared/state-value.js';

/**
 * Shared shapes for reading a live React/Vue component and watching its state.
 *
 * Boundary: everything here is plain data or a small handle interface; the framework readers in `react-state.ts` and
 * `vue-state.ts` produce it, `state-watch.ts` and the dialog controller consume it.
 */

/** One reading of a component: bounded props and state (see `snapshotValue`). React hook slots use `#<slot>` keys. */
export interface ComponentSnapshot {
    props: Record<string, StateValue>;
    state: Record<string, StateValue>;
}

/** Which framework produced a handle. */
export type StateFramework = 'react' | 'vue';

/**
 * Static facts about one component instance, sent with the payload so the server can label it.
 *
 * `usagePath` is the `data-insp-path` the instance received at its usage site. `definitionFile` is the component's own
 * file when the framework records it (Vue `type.__file`). `stampCandidates` are `data-insp-path` values written inside
 * the component's own render (React), which the server uses to find the definition and name hook slots. `hookState`
 * says state keys are `#<slot>` hook positions rather than names.
 */
export interface ComponentInfo {
    framework: StateFramework;
    name: string;
    usagePath: string | null;
    definitionFile: string | null;
    stampCandidates: string[];
    hookState: boolean;
}

/**
 * A live component instance the dialog can read and watch.
 *
 * Boundary: `read()` returns `null` once the instance is unmounted (it never throws for that). `subscribe` calls
 * `onChange` after the instance may have changed — possibly when nothing did, so the caller diffs. The returned function
 * unsubscribes and is safe to call twice.
 */
export interface ComponentHandle {
    info: ComponentInfo;
    read(): ComponentSnapshot | null;
    subscribe(onChange: () => void): () => void;
}

/** One logged change: a leaf difference plus milliseconds since the watch started. */
export interface TimedStateChange extends StateChange {
    t: number;
}

/** Outcome of one watch session, as attached to the prompt. */
export interface StateWatchResult {
    durationMs: number;
    initial: ComponentSnapshot;
    changes: TimedStateChange[];
    dropped: number;
    unmountedAt: number | null;
}
