import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCodexDockRequest } from './pipeline.js';

const PROJECT_ROOT = '/tmp/project';
const OPTIONS = { applyMode: 'prompt-only' };
const RESOLVED = { references: [] };

test('codex dock new thread requests discard stale thread ids', () => {
    const request = buildCodexDockRequest({
        pageUrl: 'http://localhost',
        intent: 'start fresh',
        threadId: 'thread-old',
        newThread: true,
        resume: true,
    }, RESOLVED, PROJECT_ROOT, OPTIONS);

    assert.equal(request.threadId, undefined);
    assert.equal(request.resume, false);
    assert.equal(request.newThread, true);
    assert.equal(request.applyMode, 'agent-edit');
    assert.equal('planMode' in request, false);
});

test('codex dock does not resume a stored thread without an explicit thread id', () => {
    const request = buildCodexDockRequest({
        pageUrl: 'http://localhost',
        intent: 'start fresh',
        resume: true,
    }, RESOLVED, PROJECT_ROOT, OPTIONS);

    assert.equal(request.threadId, undefined);
    assert.equal(request.resume, false);
    assert.equal(request.newThread, true);
    assert.equal(request.applyMode, 'agent-edit');
});

test('codex dock resumes only explicit existing thread ids', () => {
    const request = buildCodexDockRequest({
        pageUrl: 'http://localhost',
        intent: 'continue',
        threadId: 'thread-selected',
        newThread: false,
        resume: true,
    }, RESOLVED, PROJECT_ROOT, OPTIONS);

    assert.equal(request.threadId, 'thread-selected');
    assert.equal(request.resume, true);
    assert.equal(request.newThread, false);
    assert.equal(request.applyMode, 'agent-edit');
});

test('codex dock ignores stale plan-only payload fields', () => {
    const request = buildCodexDockRequest({
        pageUrl: 'http://localhost',
        intent: 'change files anyway',
        applyMode: 'prompt-only',
        planMode: true,
    }, RESOLVED, PROJECT_ROOT, OPTIONS);

    assert.equal(request.applyMode, 'agent-edit');
    assert.equal('planMode' in request, false);
});
