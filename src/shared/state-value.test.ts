import assert from 'node:assert/strict';
import test from 'node:test';
import { diffValues, snapshotValue, STATE_MAX_DIFF_CHANGES, STATE_MAX_ITEMS, STATE_MAX_KEYS, STATE_MAX_STRING, STATE_MORE_KEY, type StateChange } from './state-value.js';

test('snapshotValue keeps plain data and marks what is not data', () => {
    function toggle() {}
    const element = { $$typeof: Symbol.for('react.element'), type: function Card() {} };
    const node = { nodeType: 1, nodeName: 'BUTTON', id: 'go' };
    assert.deepEqual(snapshotValue({ a: 1, b: 'x', c: true, d: null, e: [1, 2] }), { a: 1, b: 'x', c: true, d: null, e: [1, 2] });
    assert.equal(snapshotValue(undefined), '[undefined]');
    assert.equal(snapshotValue(NaN), 'NaN');
    assert.equal(snapshotValue(10n), '10n');
    assert.equal(snapshotValue(toggle), '[Function toggle]');
    assert.equal(snapshotValue(element), '[React element <Card>]');
    assert.equal(snapshotValue(node), '[Element <button#go>]');
    assert.equal(snapshotValue(new Date('2026-01-02T03:04:05Z')), '2026-01-02T03:04:05.000Z');
    assert.equal(snapshotValue(Promise.resolve()), '[Promise]');
    assert.deepEqual(snapshotValue(new Map([[1, 'a']])), { 1: 'a' });
    assert.deepEqual(snapshotValue(new Set(['x'])), ['x']);
});

test('snapshotValue caps depth, size and strings, and survives cycles and throwing getters', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    const hostile = Object.defineProperty({}, 'bad', { enumerable: true, get() { throw new Error('nope'); } });
    const wide = Object.fromEntries(Array.from({ length: STATE_MAX_KEYS + 5 }, (_, i) => [`k${i}`, i]));
    const long = Array.from({ length: STATE_MAX_ITEMS + 3 }, (_, i) => i);
    assert.deepEqual(snapshotValue(cyclic), { name: 'loop', self: '[Circular]' });
    assert.deepEqual(snapshotValue(hostile), { bad: '[Unreadable]' });
    assert.deepEqual(snapshotValue({ a: { b: { c: { d: { e: 1 } } } } }), { a: { b: { c: { d: '[Object]' } } } });
    assert.equal(Object.keys(snapshotValue(wide) as object).length, STATE_MAX_KEYS + 1);
    assert.equal((snapshotValue(wide) as Record<string, unknown>)[STATE_MORE_KEY], '+5 keys');
    assert.equal((snapshotValue(long) as unknown[]).at(-1), '…+3');
    assert.equal((snapshotValue('x'.repeat(STATE_MAX_STRING + 9)) as string).length, STATE_MAX_STRING + 1);
    assert.deepEqual(snapshotValue({ __v_skip: true, value: 1 }), { value: 1 });
});

test('diffValues reports leaf changes with dotted and bracketed paths', () => {
    const out: StateChange[] = [];
    const dropped = diffValues({ tasks: [{ done: true }, { done: false }], n: 1 }, { tasks: [{ done: false }, { done: false }], n: 1, extra: 'x' }, 'state', out);
    assert.equal(dropped, 0);
    assert.deepEqual(out, [
        { path: 'state.tasks[0].done', from: true, to: false },
        { path: 'state.extra', from: '[undefined]', to: 'x' },
    ]);
});

test('diffValues treats a type change as one change and caps a flood', () => {
    const typeChange: StateChange[] = [];
    diffValues({ a: [1] }, { a: { 0: 1 } }, '', typeChange);
    assert.deepEqual(typeChange, [{ path: 'a', from: [1], to: { 0: 1 } }]);
    const flood: StateChange[] = [];
    const before = Array.from({ length: 30 }, (_, i) => i);
    const dropped = diffValues(before, before.map((i) => i + 1), 'list', flood);
    assert.equal(flood.length, STATE_MAX_DIFF_CHANGES);
    assert.equal(dropped, 30 - STATE_MAX_DIFF_CHANGES);
});
