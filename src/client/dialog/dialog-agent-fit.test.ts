import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENT_MORE_LIST_MAX, AGENT_MORE_LIST_MIN, agentMoreListMax } from './dialog-agent-fit.js';

test('agentMoreListMax uses the full cap when the viewport has room', () => {
    assert.deepEqual(agentMoreListMax(900, 240), { list: AGENT_MORE_LIST_MAX, menuScroll: false });
});

test('agentMoreListMax shrinks the list to the room left on the menu side', () => {
    assert.deepEqual(agentMoreListMax(416, 226), { list: 190, menuScroll: false });
});

test('agentMoreListMax keeps a minimum list and asks the menu to scroll when even that cannot fit', () => {
    assert.deepEqual(agentMoreListMax(300, 240), { list: AGENT_MORE_LIST_MIN, menuScroll: true });
});
