import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_WATCH_CHANGES, startStateWatch } from './state-watch.js';
import type { ComponentHandle, ComponentSnapshot } from './state-types.js';

/** A handle whose reading and change notifications the test drives by hand. */
function fakeHandle(initial: ComponentSnapshot | null) {
    let reading = initial;
    let listener: (() => void) | null = null;
    const handle: ComponentHandle = {
        info: { framework: 'react', name: 'X', usagePath: null, definitionFile: null, stampCandidates: [], hookState: true },
        read: () => reading,
        subscribe(onChange) {
            listener = onChange;
            return () => { listener = null; };
        },
    };
    return {
        handle,
        set(next: ComponentSnapshot | null) {
            reading = next;
            listener?.();
        },
        isSubscribed: () => listener !== null,
    };
}

test('logs each leaf change with its time, then stops and unsubscribes', () => {
    let clock = 100;
    const fake = fakeHandle({ props: { task: { done: false } }, state: { '#0': 1500 } });
    const session = startStateWatch(fake.handle, { now: () => clock });
    clock = 1100;
    fake.set({ props: { task: { done: false } }, state: { '#0': 1499 } });
    clock = 2100;
    fake.set({ props: { task: { done: true } }, state: { '#0': 1499 } });
    fake.set({ props: { task: { done: true } }, state: { '#0': 1499 } });
    assert.equal(session.count(), 2);
    clock = 3100;
    const result = session.stop();
    assert.deepEqual(result.changes, [
        { t: 1000, path: 'state.#0', from: 1500, to: 1499 },
        { t: 2000, path: 'props.task.done', from: false, to: true },
    ]);
    assert.equal(result.durationMs, 3000);
    assert.equal(result.unmountedAt, null);
    assert.deepEqual(result.initial.state, { '#0': 1500 });
    assert.equal(fake.isSubscribed(), false);
    assert.equal(session.stop(), result);
});

test('stop reads once more, so a change that did not notify is still logged', () => {
    const fake = fakeHandle({ props: {}, state: { open: false } });
    const session = startStateWatch(fake.handle, { now: () => 0 });
    fake.handle.read = () => ({ props: {}, state: { open: true } });
    assert.deepEqual(session.stop().changes, [{ t: 0, path: 'state.open', from: false, to: true }]);
});

test('an unmount ends reading and is recorded', () => {
    let clock = 0;
    const fake = fakeHandle({ props: {}, state: { n: 1 } });
    const session = startStateWatch(fake.handle, { now: () => clock });
    clock = 500;
    fake.set(null);
    assert.equal(fake.isSubscribed(), false);
    assert.equal(session.stop().unmountedAt, 500);
});

test('refuses to start on an unmounted component and caps a long log', () => {
    assert.throws(() => startStateWatch(fakeHandle(null).handle));
    const fake = fakeHandle({ props: {}, state: { n: 0 } });
    const session = startStateWatch(fake.handle, { now: () => 0 });
    for (let n = 1; n <= MAX_WATCH_CHANGES + 7; n += 1)
        fake.set({ props: {}, state: { n } });
    const result = session.stop();
    assert.equal(result.changes.length, MAX_WATCH_CHANGES);
    assert.equal(result.dropped, 7);
});

test('every component-state string has zh and en copy, and each key is used by the UI', async () => {
    const { STATE_STRINGS } = await import('../lib/i18n-state.js');
    const { hasString } = await import('../lib/i18n.js');
    const fs = await import('node:fs');
    const sources = ['dialog-state.ts', 'dialog-state-menu.ts'].map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
    for (const key of Object.keys(STATE_STRINGS)) {
        assert.equal(hasString(key, 'zh'), true, key);
        assert.equal(hasString(key, 'en'), true, key);
        assert.ok(sources.includes(`'${key}'`), `${key} is unused`);
    }
});
