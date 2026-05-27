import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodexSdkAdapter, extractCodexMetrics, resolveCodexSdkThreadId } from '../server/agents/codex-sdk.js';

function createContext() {
    const values = new Map();
    return {
        projectRoot: '/repo/current',
        prompt: 'Do the thing\n',
        emitted: [],
        sessionStore: {
            get: (key) => values.get(key),
            set: (key, value) => values.set(key, value),
        },
        logger: {
            info() {},
            warn() {},
            error() {},
        },
        emit(event) {
            this.emitted.push(event);
        },
        values,
    };
}

test('resolves explicit, stored, and forced-new SDK thread ids', () => {
    assert.equal(resolveCodexSdkThreadId({ resumeLastThread: true }, { threadId: 'explicit', resume: true }, 'stored'), 'explicit');
    assert.equal(resolveCodexSdkThreadId({ resumeLastThread: true }, { resume: true }, 'stored'), 'stored');
    assert.equal(resolveCodexSdkThreadId({ threadId: 'configured' }, { resume: false }, 'stored'), 'configured');
    assert.equal(resolveCodexSdkThreadId({ resumeLastThread: true }, { newThread: true, threadId: 'explicit', resume: true }, 'stored'), undefined);
});

test('reports missing @openai/codex-sdk dependency', async () => {
    const adapter = createCodexSdkAdapter({}, async () => null);
    const availability = await adapter.isAvailable();
    const result = await adapter.send({ id: 'request-1' }, createContext());

    assert.equal(availability.available, false);
    assert.match(availability.reason, /Install @openai\/codex-sdk/);
    assert.equal(result.ok, false);
    assert.match(result.error, /Install @openai\/codex-sdk/);
});

test('starts a new SDK thread when requested', async () => {
    const calls = [];
    class Codex {
        startThread(options) {
            calls.push({ type: 'start', options });
            return {
                id: 'new-thread',
                run: async (prompt) => {
                    calls.push({ type: 'run', prompt });
                    return { threadId: 'new-thread', items: [{ type: 'message', text: 'working' }], finalResponse: 'done' };
                },
            };
        }
        resumeThread(id, options) {
            calls.push({ type: 'resume', id, options });
            return this.startThread(options);
        }
    }

    const adapter = createCodexSdkAdapter({ resumeLastThread: true }, async () => ({ Codex }));
    const context = createContext();
    const result = await adapter.send({ id: 'request-1', newThread: true, threadId: 'old-thread', resume: true }, context);

    assert.equal(result.ok, true);
    assert.equal(result.threadId, 'new-thread');
    assert.equal(calls[0].type, 'start');
    assert.equal(calls[1].prompt, 'Do the thing\n');
});

test('request model overrides configured SDK model', async () => {
    const calls = [];
    class Codex {
        startThread(options) {
            calls.push(options);
            return {
                id: 'thread-model',
                run: async () => ({ threadId: 'thread-model', items: [], finalResponse: 'done' }),
            };
        }
    }

    const adapter = createCodexSdkAdapter({ model: 'configured-model' }, async () => ({ Codex }));
    await adapter.send({ id: 'request-1', model: 'selected-model', newThread: true }, createContext());

    assert.equal(calls[0].model, 'selected-model');
});

test('extracts portable SDK usage metrics', () => {
    const metrics = extractCodexMetrics({
        usage: {
            input_tokens: 1000,
            output_tokens: 500,
            context_window: 6000,
        },
    }, 1_000, 4_000);

    assert.equal(metrics.tokensPerSecond, 500);
    assert.equal(metrics.contextPercent, 25);
    assert.equal(metrics.tokensUsed, 1500);
    assert.equal(metrics.contextWindow, 6000);
});

test('prefers direct SDK rate and context percentage metrics', () => {
    const metrics = extractCodexMetrics({
        metrics: {
            tokens_per_second: 42.42,
            context_percent: 0.83,
        },
    }, 1_000, 11_000);

    assert.equal(metrics.tokensPerSecond, 42.4);
    assert.equal(metrics.contextPercent, 83);
});

test('resumes an explicit SDK thread id', async () => {
    const calls = [];
    class Codex {
        resumeThread(id, options) {
            calls.push({ type: 'resume', id, options });
            return {
                id,
                run: async () => ({ threadId: id, items: [], finalResponse: 'resumed' }),
            };
        }
        startThread(options) {
            calls.push({ type: 'start', options });
            return {
                id: 'new-thread',
                run: async () => ({ threadId: 'new-thread', items: [], finalResponse: 'started' }),
            };
        }
    }

    const adapter = createCodexSdkAdapter({}, async () => ({ Codex }));
    const result = await adapter.send({ id: 'request-1', threadId: 'resume-me', resume: true }, createContext());

    assert.equal(result.ok, true);
    assert.equal(result.threadId, 'resume-me');
    assert.equal(calls[0].type, 'resume');
    assert.equal(calls[0].id, 'resume-me');
});
