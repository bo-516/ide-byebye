import assert from 'node:assert/strict';
import test from 'node:test';
import { LAST_AGENT_PREF_KEY, loadLastAgent, saveLastAgent, setCustomAgentActions } from './dialog-utils.js';

// Pins the Enter-target contract the README documents under `defaultAgent`: only footer agents (the four app agents,
// then `agents.custom` clients) can take Enter, so the `clipboard` / `file` backend agents never do.

/** Every built-in adapter id, as `enabledAgents` lists them for a zero-config project. */
const ALL_AGENTS = ['clipboard', 'file', 'codex-app', 'claude-app', 'cursor-app', 'grok-build'];

/**
 * Run `fn` against an in-memory `window.localStorage`, restoring any prior global `window` afterward.
 *
 * @param {Record<string, string>} initial Entries present before `fn` runs.
 * @param {(store: Record<string, string>) => void} fn Test body; receives the backing object so it can assert writes.
 */
function withStorage(initial, fn) {
    const prev = globalThis.window;
    const store = { ...initial };
    (globalThis as any).window = {
        localStorage: {
            getItem: (key) => store[key] ?? null,
            setItem: (key, value) => { store[key] = String(value); },
        },
    };
    try {
        fn(store);
    }
    finally {
        (globalThis as any).window = prev;
    }
}

test('loadLastAgent targets a configured footer-agent default', () => {
    withStorage({}, () => {
        assert.equal(loadLastAgent({ enabledAgents: ALL_AGENTS, defaultAgent: 'cursor-app' }), 'cursor-app');
    });
});

test('loadLastAgent never targets clipboard or file, falling back to the first enabled footer agent', () => {
    withStorage({}, () => {
        assert.equal(loadLastAgent({ enabledAgents: ALL_AGENTS, defaultAgent: 'file' }), 'codex-app');
        assert.equal(loadLastAgent({ enabledAgents: ALL_AGENTS, defaultAgent: 'clipboard' }), 'codex-app');
        // Footer order decides the fallback, so with Codex App off the next one is Claude App.
        const withoutCodex = ALL_AGENTS.filter((agent) => agent !== 'codex-app');
        assert.equal(loadLastAgent({ enabledAgents: withoutCodex, defaultAgent: 'file' }), 'claude-app');
    });
});

test('loadLastAgent accepts an agents.custom client as the default and as the last fallback', () => {
    setCustomAgentActions([{ name: 'grok-desktop', label: 'Send to chat' }]);
    try {
        withStorage({}, () => {
            const config = { enabledAgents: [...ALL_AGENTS, 'grok-desktop'], defaultAgent: 'grok-desktop' };
            assert.equal(loadLastAgent(config), 'grok-desktop');
            // Custom clients sit after the four app agents, so they only catch the fallback when none of those is on.
            const customOnly = { enabledAgents: ['clipboard', 'file', 'grok-desktop'], defaultAgent: 'file' };
            assert.equal(loadLastAgent(customOnly), 'grok-desktop');
        });
    }
    finally {
        setCustomAgentActions([]);
    }
});

test('loadLastAgent picks a not-enabled agent when only clipboard and file are on', () => {
    // No footer agent can take Enter, so the dialog's send guard reports "not enabled" instead of silently copying or
    // writing a file.
    withStorage({}, () => {
        const config = { enabledAgents: ['clipboard', 'file'], defaultAgent: 'clipboard' };
        assert.equal(config.enabledAgents.includes(loadLastAgent(config)), false);
    });
});

test('loadLastAgent prefers the footer agent last clicked in this browser over defaultAgent', () => {
    withStorage({ [LAST_AGENT_PREF_KEY]: 'claude-app' }, () => {
        assert.equal(loadLastAgent({ enabledAgents: ALL_AGENTS, defaultAgent: 'cursor-app' }), 'claude-app');
    });
});

test('loadLastAgent ignores a remembered agent that is now disabled or is not a footer agent', () => {
    const withoutClaude = ALL_AGENTS.filter((agent) => agent !== 'claude-app');
    withStorage({ [LAST_AGENT_PREF_KEY]: 'claude-app' }, () => {
        assert.equal(loadLastAgent({ enabledAgents: withoutClaude, defaultAgent: 'cursor-app' }), 'cursor-app');
    });
    withStorage({ [LAST_AGENT_PREF_KEY]: 'file' }, () => {
        assert.equal(loadLastAgent({ enabledAgents: ALL_AGENTS, defaultAgent: 'cursor-app' }), 'cursor-app');
    });
});

test('saveLastAgent remembers footer agents but never clipboard or file', () => {
    withStorage({}, (store) => {
        saveLastAgent('clipboard');
        saveLastAgent('file');
        assert.equal(store[LAST_AGENT_PREF_KEY], undefined);
        saveLastAgent('grok-build');
        saveLastAgent('clipboard');
        assert.equal(store[LAST_AGENT_PREF_KEY], 'grok-build');
    });
});
