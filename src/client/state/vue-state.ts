import { INSP_PATH_ATTR } from '../../shared/constants.js';
import { snapshotValue, type StateValue } from '../../shared/state-value.js';
import type { ComponentHandle, ComponentSnapshot } from './state-types.js';

/**
 * Read-only access to one Vue 3 component instance's props and state (dev builds).
 *
 * Purpose: Vue keeps names for everything, so the dialog can show `left: 1499` directly: script-setup bindings come from
 * `setupState`, Options API state from `data`. Changes are observed through the instance's own `onUpdated` list.
 * Boundary: no Vue import. Only reactive bindings (refs, computed, reactive objects) count as state, using the raw setup
 * result Vue keeps for devtools (`devtoolsRawSetupState`, or the proxy's `__v_raw`); plain constants, imports and
 * functions are left out. Without either raw source every non-function binding is kept. Vue 2 instances (`__vue__`)
 * are not read.
 */

/** DOM expando Vue 3 sets on each element: the instance whose render produced it. */
export const VUE_INSTANCE_KEY = '__vueParentComponent';

/** Instance fields this module reads. Tests pass plain objects of this shape. */
export interface VueInstanceLike {
    type: { __name?: unknown; name?: unknown; __file?: unknown } | null;
    vnode: { props?: Record<string, unknown> | null } | null;
    props: Record<string, unknown> | null;
    setupState: Record<string, unknown> | null;
    devtoolsRawSetupState?: Record<string, unknown> | null;
    data: Record<string, unknown> | null;
    isUnmounted?: boolean;
    /** Vue's internal `onUpdated` hook list; null until a hook is registered. */
    u: Array<() => void> | null;
}

/**
 * Whether a raw setup binding is reactive state (ref, computed, reactive or readonly object).
 *
 * @param {unknown} value Raw binding from the setup result.
 * @returns {boolean} True for reactive bindings.
 */
function isReactiveBinding(value: unknown): boolean {
    if (!value || typeof value !== 'object')
        return false;
    const flags = value as { __v_isRef?: unknown; __v_isReactive?: unknown; __v_isReadonly?: unknown };
    return flags.__v_isRef === true || flags.__v_isReactive === true || flags.__v_isReadonly === true;
}

/**
 * Raw (non-unwrapped) setup result of an instance, when Vue exposes it.
 *
 * @param {VueInstanceLike} instance Component instance.
 * @returns {Record<string, unknown> | null} Raw setup object, or `null` when unavailable.
 */
function rawSetupOf(instance: VueInstanceLike): Record<string, unknown> | null {
    if (instance.devtoolsRawSetupState && typeof instance.devtoolsRawSetupState === 'object')
        return instance.devtoolsRawSetupState;
    const raw = (instance.setupState as { __v_raw?: unknown } | null)?.__v_raw;
    return raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
}

/**
 * Bounded state of an instance: reactive setup bindings (unwrapped values) plus Options API `data`.
 *
 * @param {VueInstanceLike} instance Component instance.
 * @returns {Record<string, StateValue>} Named state view.
 */
function stateView(instance: VueInstanceLike): Record<string, StateValue> {
    const out: Record<string, StateValue> = {};
    const setup = instance.setupState;
    const raw = rawSetupOf(instance);
    if (setup && typeof setup === 'object') {
        for (const key of Object.keys(raw ?? setup)) {
            if (key.startsWith('__'))
                continue;
            const value = setup[key];
            if (typeof value === 'function' || (raw ? !isReactiveBinding(raw[key]) : false))
                continue;
            out[key] = snapshotValue(value, 1);
        }
    }
    if (instance.data && typeof instance.data === 'object') {
        for (const key of Object.keys(instance.data))
            out[key] = snapshotValue(instance.data[key], 1);
    }
    return out;
}

/**
 * Bounded props of an instance, without the stamper's own attribute.
 *
 * @param {VueInstanceLike} instance Component instance.
 * @returns {Record<string, StateValue>} Props view.
 */
function propsView(instance: VueInstanceLike): Record<string, StateValue> {
    const out: Record<string, StateValue> = {};
    const props = instance.props;
    if (!props || typeof props !== 'object')
        return out;
    for (const key of Object.keys(props)) {
        if (key !== INSP_PATH_ATTR)
            out[key] = snapshotValue(props[key], 1);
    }
    return out;
}

/**
 * Display name of an instance's component: `__name` (script setup), `name`, or the file's base name.
 *
 * @param {VueInstanceLike} instance Component instance.
 * @returns {string} Name, or `''`.
 */
function vueComponentName(instance: VueInstanceLike): string {
    const type = instance.type;
    if (!type)
        return '';
    if (typeof type.__name === 'string' && type.__name)
        return type.__name;
    if (typeof type.name === 'string' && type.name)
        return type.name;
    const file = typeof type.__file === 'string' ? type.__file : '';
    return file.split(/[\\/]/).pop()?.replace(/\.vue$/, '') ?? '';
}

/**
 * Handle for the Vue instance that rendered a picked node.
 *
 * Boundary: `subscribe` appends to the instance's `onUpdated` list, so it fires after each re-render of this instance;
 * a state change that does not re-render it is seen on the next read (the watcher reads once more when it stops).
 *
 * @param {object} node Picked DOM element or test double.
 * @returns {ComponentHandle | null} Handle, or `null` when the node has no Vue 3 instance.
 */
export function vueComponentHandle(node: object): ComponentHandle | null {
    const instance = (node as Record<string, unknown>)[VUE_INSTANCE_KEY] as VueInstanceLike | undefined;
    if (!instance || typeof instance !== 'object' || !('setupState' in instance))
        return null;
    const usage = instance.vnode?.props?.[INSP_PATH_ATTR];
    const file = instance.type?.__file;
    return {
        info: {
            framework: 'vue',
            name: vueComponentName(instance),
            usagePath: typeof usage === 'string' && usage ? usage : null,
            definitionFile: typeof file === 'string' && file ? file : null,
            stampCandidates: [],
            hookState: false,
        },
        read(): ComponentSnapshot | null {
            return instance.isUnmounted ? null : { props: propsView(instance), state: stateView(instance) };
        },
        subscribe(onChange) {
            const hook = () => onChange();
            const list = instance.u ?? (instance.u = []);
            list.push(hook);
            return () => {
                const index = instance.u ? instance.u.indexOf(hook) : -1;
                if (index >= 0)
                    instance.u?.splice(index, 1);
            };
        },
    };
}
