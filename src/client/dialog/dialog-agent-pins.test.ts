import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PINNED_AGENTS } from '../../shared/constants.js';
import { normalizePinnedAgents, PINNED_AGENTS_MAX } from '../../shared/pinned-agents.js';
import {
    AGENT_PIN_TIP_PREF_KEY,
    dismissPinTip,
    isPinTipDismissed,
    loadPinnedAgents,
    PINNED_AGENTS_PREF_KEY,
    setAgentPinned,
} from './dialog-agent-pins.js';

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

test('loadPinnedAgents prefers storage, then config, then the built-in default', () => {
    assert.deepEqual(loadPinnedAgents(undefined, memoryStore().store), DEFAULT_PINNED_AGENTS);
    assert.deepEqual(loadPinnedAgents(['cursor-app'], memoryStore().store), ['cursor-app']);
    assert.deepEqual(loadPinnedAgents(['cursor-app'], memoryStore({ [PINNED_AGENTS_PREF_KEY]: '["opencode"]' }).store), ['opencode']);
    // An explicit empty choice is respected rather than refilled from config.
    assert.deepEqual(loadPinnedAgents(['cursor-app'], memoryStore({ [PINNED_AGENTS_PREF_KEY]: '[]' }).store), []);
});

test('loadPinnedAgents ignores malformed storage and config', () => {
    assert.deepEqual(loadPinnedAgents('cursor-app', memoryStore({ [PINNED_AGENTS_PREF_KEY]: '{not json' }).store), DEFAULT_PINNED_AGENTS);
    assert.deepEqual(loadPinnedAgents(null, memoryStore({ [PINNED_AGENTS_PREF_KEY]: '{"a":1}' }).store), DEFAULT_PINNED_AGENTS);
});

test('setAgentPinned copies the config default on first change and persists the whole list', () => {
    const { store, data } = memoryStore();
    assert.deepEqual(setAgentPinned('claude-app', false, ['codex-app', 'claude-app'], store), ['codex-app']);
    assert.deepEqual(setAgentPinned('cursor-app', true, ['codex-app', 'claude-app'], store), ['codex-app', 'cursor-app']);
    assert.deepEqual(setAgentPinned('cursor-app', true, null, store), ['codex-app', 'cursor-app']);
    assert.equal(data[PINNED_AGENTS_PREF_KEY], '["codex-app","cursor-app"]');
});

test('pin tip dismissal is remembered', () => {
    const { store, data } = memoryStore();
    assert.equal(isPinTipDismissed(store), false);
    dismissPinTip(store);
    assert.equal(isPinTipDismissed(store), true);
    assert.equal(data[AGENT_PIN_TIP_PREF_KEY], 'true');
});

test('normalizePinnedAgents trims, dedupes, drops non-strings and caps the list', () => {
    assert.equal(normalizePinnedAgents('codex-app'), null);
    assert.deepEqual(normalizePinnedAgents([' a ', 'a', '', 3, null, 'b']), ['a', 'b']);
    assert.deepEqual(normalizePinnedAgents(['x'.repeat(65), 'ok']), ['ok']);
    assert.equal(normalizePinnedAgents(Array.from({ length: 100 }, (_, i) => `id-${i}`))?.length, PINNED_AGENTS_MAX);
});
