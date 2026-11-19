import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AGENT_NOTICE_DISMISSED_PREF_KEY,
    agentNoticeId,
    dismissAgentNoticeForever,
    loadDismissedAgentNotices,
    nextAgentNoticeState,
    visibleAgentNotice,
    type AgentNoticeState,
} from './dialog-agent-notice.js';

/**
 * In-memory `Storage` stand-in exposing its backing object so tests can seed and inspect raw values.
 * @param {Record<string, string>} [initial] Entries present before the test. @returns {{ store: Storage, data: Record<string, string> }}
 */
function memoryStore(initial: Record<string, string> = {}): { store: Storage; data: Record<string, string> } {
    const data = { ...initial };
    const store = {
        getItem: (key: string) => data[key] ?? null,
        setItem: (key: string, value: string) => { data[key] = String(value); },
    } as unknown as Storage;
    return { store, data };
}

/** Context with nothing unavailable or dismissed. */
const OPEN = { unavailable: false, dismissed: [] };

test('only the WorkBuddy desktop app has a notice', () => {
    assert.equal(agentNoticeId('workbuddy-app'), 'workbuddyGroup');
    assert.equal(agentNoticeId('workbuddy-cli'), null);
    assert.equal(agentNoticeId('codex-app'), null);
    assert.equal(agentNoticeId('toString'), null);
    assert.equal(agentNoticeId(null), null);
});

test('a new destination re-arms the notice; the same one keeps "dismissed once"', () => {
    const closed: AgentNoticeState = { agent: 'workbuddy-app', closedOnce: true };
    assert.equal(nextAgentNoticeState(closed, 'workbuddy-app'), closed);
    assert.deepEqual(nextAgentNoticeState(closed, 'codex-app'), { agent: 'codex-app', closedOnce: false });
    assert.deepEqual(nextAgentNoticeState({ agent: null, closedOnce: false }, 'workbuddy-app'), { agent: 'workbuddy-app', closedOnce: false });
});

test('the notice shows for WorkBuddy until dismissed once, dismissed for good, or unavailable', () => {
    const armed: AgentNoticeState = { agent: 'workbuddy-app', closedOnce: false };
    assert.equal(visibleAgentNotice(armed, OPEN), 'workbuddyGroup');
    assert.equal(visibleAgentNotice({ ...armed, closedOnce: true }, OPEN), null);
    assert.equal(visibleAgentNotice(armed, { unavailable: true, dismissed: [] }), null);
    assert.equal(visibleAgentNotice(armed, { unavailable: false, dismissed: ['workbuddyGroup'] }), null);
    assert.equal(visibleAgentNotice({ agent: 'codex-app', closedOnce: false }, OPEN), null);
});

test('switching away and back to WorkBuddy shows the notice again after "Dismiss"', () => {
    let state: AgentNoticeState = { agent: 'workbuddy-app', closedOnce: true };
    state = nextAgentNoticeState(state, 'codex-app');
    state = nextAgentNoticeState(state, 'workbuddy-app');
    assert.equal(visibleAgentNotice(state, OPEN), 'workbuddyGroup');
});

test('"Don\'t show again" persists once per id and survives malformed storage', () => {
    const { store, data } = memoryStore();
    assert.deepEqual(loadDismissedAgentNotices(store), []);
    dismissAgentNoticeForever('workbuddyGroup', store);
    dismissAgentNoticeForever('workbuddyGroup', store);
    assert.deepEqual(JSON.parse(data[AGENT_NOTICE_DISMISSED_PREF_KEY]), ['workbuddyGroup']);
    assert.deepEqual(loadDismissedAgentNotices(memoryStore({ [AGENT_NOTICE_DISMISSED_PREF_KEY]: '{bad' }).store), []);
    assert.deepEqual(loadDismissedAgentNotices(memoryStore({ [AGENT_NOTICE_DISMISSED_PREF_KEY]: '["a",1,null]' }).store), ['a']);
});
