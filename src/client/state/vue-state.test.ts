import assert from 'node:assert/strict';
import test from 'node:test';
import { INSP_PATH_ATTR } from '../../shared/constants.js';
import { VUE_INSTANCE_KEY, vueComponentHandle, type VueInstanceLike } from './vue-state.js';

/** A ref-like raw binding, as Vue's setup result holds it before `proxyRefs` unwraps it. */
function ref(value: unknown) {
    return { __v_isRef: true, value };
}

/** A script-setup instance: refs and a computed are state; a constant, an import and a function are not. */
function timerInstance(): VueInstanceLike {
    const raw = { left: ref(1499), running: ref(true), mm: ref('24'), SESSION_SECONDS: 1500, computed() {}, tick() {} };
    return {
        type: { __name: 'FocusTimer', __file: '/app/src/components/FocusTimer.vue' },
        vnode: { props: { [INSP_PATH_ATTR]: '/app/src/Sidebar.vue:69:5:FocusTimer' } },
        props: { size: 64 },
        setupState: { left: 1499, running: true, mm: '24', SESSION_SECONDS: 1500, computed() {}, tick() {} },
        devtoolsRawSetupState: raw,
        data: {},
        isUnmounted: false,
        u: null,
    };
}

test('reads named reactive bindings and props, skipping constants and functions', () => {
    const handle = vueComponentHandle({ [VUE_INSTANCE_KEY]: timerInstance() });
    assert.ok(handle);
    assert.deepEqual(handle.info, {
        framework: 'vue',
        name: 'FocusTimer',
        usagePath: '/app/src/Sidebar.vue:69:5:FocusTimer',
        definitionFile: '/app/src/components/FocusTimer.vue',
        stampCandidates: [],
        hookState: false,
    });
    assert.deepEqual(handle.read(), { props: { size: 64 }, state: { left: 1499, running: true, mm: '24' } });
});

test('without a raw setup object every non-function binding counts, and Options API data is included', () => {
    const instance = { ...timerInstance(), devtoolsRawSetupState: null, data: { open: false } };
    assert.deepEqual(vueComponentHandle({ [VUE_INSTANCE_KEY]: instance })?.read()?.state, { left: 1499, running: true, mm: '24', SESSION_SECONDS: 1500, open: false });
});

test('subscribe rides the onUpdated list and unsubscribes; an unmounted instance reads null', () => {
    const instance = timerInstance();
    const handle = vueComponentHandle({ [VUE_INSTANCE_KEY]: instance });
    let calls = 0;
    const stop = handle?.subscribe(() => { calls += 1; });
    instance.u?.forEach((fn) => fn());
    assert.equal(calls, 1);
    stop?.();
    assert.deepEqual(instance.u, []);
    instance.isUnmounted = true;
    assert.equal(handle?.read(), null);
});

test('nodes without a Vue 3 instance have no handle', () => {
    assert.equal(vueComponentHandle({}), null);
    assert.equal(vueComponentHandle({ [VUE_INSTANCE_KEY]: { type: {} } }), null);
});
