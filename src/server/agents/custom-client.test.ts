import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DEFAULT_DELIVERY_MESSAGE_TYPE,
    DEFAULT_DELIVERY_TIMEOUT_MS,
    DELIVERY_PAYLOAD_VERSION,
    DELIVERY_SOURCE,
    buildDeliveryPayload,
    createCustomAgentAdapter,
    normalizeCustomAgents,
    resolveDeliveryPrompt,
} from './custom-client.js';
import { buildRegistry } from './build.js';

/** Minimal request skeleton shared by the payload and adapter tests. */
function makeRequest(overrides: any = {}) {
    return {
        id: 'req-1',
        createdAt: '2026-05-24T01:30:00.000Z',
        projectRoot: '/repo',
        pageUrl: 'http://localhost:5173/settings',
        intent: 'Make this the primary button',
        agent: 'grok-desktop',
        applyMode: 'prompt-only',
        selection: { file: '/repo/src/App.tsx', line: 12, column: 3 },
        source: { filePath: '/repo/src/App.tsx', startLine: 10, endLine: 20 },
        references: [{ source: { filePath: '/repo/src/Button.tsx' } }],
        screenshots: [{ scope: 'selection', filePath: '/repo/.intent-inspector/screenshots/a.webp' }],
        recordings: [{ scope: 'recording', stillFramePath: '/repo/.intent-inspector/screenshots/b.webp' }],
        ...overrides,
    };
}

/** Agent context with a captured event log, mirroring what the send route passes in. */
function makeContext(prompt = 'PROMPT\n') {
    const events = [];
    return { prompt, events, projectRoot: '/repo', outputDir: '/repo/.intent-inspector', emit: (event) => events.push(event) };
}

test('normalizeCustomAgents defaults to a postMessage client', () => {
    const [target]: any = normalizeCustomAgents([{ name: 'grok-desktop' }]);
    assert.equal(target.name, 'grok-desktop');
    assert.equal(target.label, 'grok-desktop');
    assert.equal(target.title, undefined);
    assert.equal(target.transport, 'postMessage');
    assert.equal(target.messageType, DEFAULT_DELIVERY_MESSAGE_TYPE);
    assert.equal(target.windowTarget, 'parent');
    assert.equal(target.targetOrigin, '*');
    assert.equal(target.pathStyles, undefined);
    assert.equal(target.configError, undefined);
});

test('normalizeCustomAgents treats a url as an http client and normalizes its request fields', () => {
    const [target]: any = normalizeCustomAgents({
        name: 'grok-desktop',
        label: 'Grok Desktop',
        url: 'http://127.0.0.1:8787/api/inspector/prompt',
        method: 'put',
        headers: { Authorization: 'Bearer x', 'X-Bad': 3 },
        timeoutMs: 1500,
    });
    assert.equal(target.transport, 'http');
    assert.equal(target.label, 'Grok Desktop');
    assert.equal(target.method, 'PUT');
    assert.deepEqual(target.headers, { Authorization: 'Bearer x' });
    assert.equal(target.timeoutMs, 1500);
    assert.equal(target.configError, undefined);
});

test('normalizeCustomAgents keeps an http client with a bad url but records the config error', () => {
    const [missing]: any = normalizeCustomAgents([{ name: 'a', transport: 'http' }]);
    const [scheme]: any = normalizeCustomAgents([{ name: 'b', url: 'ws://localhost:1234' }]);
    assert.equal(missing.transport, 'http');
    assert.match(missing.configError, /url/);
    assert.equal(scheme.timeoutMs, DEFAULT_DELIVERY_TIMEOUT_MS);
    assert.match(scheme.configError, /http\(s\)/);
});

test('normalizeCustomAgents drops unusable, disabled, shadowing, and duplicate entries', () => {
    const targets = normalizeCustomAgents([
        null,
        'grok-desktop',
        { label: 'no name' },
        { name: 'has space' },
        { name: 'claude-app' },
        { name: 'off', enabled: false },
        { name: 'keep', label: 'first' },
        { name: 'keep', label: 'second' },
    ]);
    assert.deepEqual(targets.map((target: any) => target.label), ['first']);
});

test('normalizeCustomAgents reads per-client path styles only when one is set', () => {
    const [inherit]: any = normalizeCustomAgents([{ name: 'a' }]);
    const [override]: any = normalizeCustomAgents([{ name: 'b', pathStyle: 'absolute' }]);
    assert.equal(inherit.pathStyles, undefined);
    assert.deepEqual(override.pathStyles, { pathStyle: 'absolute', artifactPathStyle: 'absolute' });
});

test('buildRegistry registers custom clients and refuses built-in names', () => {
    const registry = buildRegistry({ custom: [{ name: 'grok-desktop' }, { name: 'claude-app' }] });
    assert.equal(registry.has('grok-desktop'), true);
    assert.deepEqual(registry.names(), [
        'clipboard',
        'file',
        'codex-app',
        'claude-app',
        'cursor-app',
        'grok-build',
        'grok-desktop',
    ]);
});

test('buildRegistry without agents.custom keeps the built-in agent set', () => {
    assert.deepEqual(buildRegistry({}).names(), [
        'clipboard',
        'file',
        'codex-app',
        'claude-app',
        'cursor-app',
        'grok-build',
    ]);
});

test('buildDeliveryPayload carries the prompt plus absolute source and artifact paths', () => {
    const [target]: any = normalizeCustomAgents([{ name: 'grok-desktop', messageType: 'grok:prompt' }]);
    const payload: any = buildDeliveryPayload(makeRequest(), 'PROMPT\n', target);
    assert.equal(payload.type, 'grok:prompt');
    assert.equal(payload.source, DELIVERY_SOURCE);
    assert.equal(payload.version, DELIVERY_PAYLOAD_VERSION);
    assert.equal(payload.agent, 'grok-desktop');
    assert.equal(payload.requestId, 'req-1');
    assert.equal(payload.prompt, 'PROMPT\n');
    assert.equal(payload.intent, 'Make this the primary button');
    assert.equal(payload.projectRoot, '/repo');
    assert.deepEqual(payload.files, ['/repo/src/App.tsx', '/repo/src/Button.tsx']);
    assert.deepEqual(payload.screenshots, ['/repo/.intent-inspector/screenshots/a.webp']);
    assert.deepEqual(payload.recordings, ['/repo/.intent-inspector/screenshots/b.webp']);
});

test('resolveDeliveryPrompt reuses the shared prompt unless the client overrides path styles', () => {
    const request = makeRequest({ screenshots: undefined, recordings: undefined, references: [] });
    const context = makeContext('SHARED\n');
    const [inherit]: any = normalizeCustomAgents([{ name: 'a' }]);
    const [absolute]: any = normalizeCustomAgents([{ name: 'b', pathStyle: 'absolute' }]);
    assert.equal(resolveDeliveryPrompt(request, context, inherit), 'SHARED\n');
    assert.match(resolveDeliveryPrompt(request, context, absolute), /^@\/repo\/src\/App\.tsx/);
});

test('postMessage client hands the delivery instruction back to the browser', async () => {
    const [target]: any = normalizeCustomAgents([{ name: 'grok-desktop', label: 'Grok Desktop', targetOrigin: 'http://localhost:1420' }]);
    const context = makeContext();
    const result: any = await createCustomAgentAdapter(target).send(makeRequest(), context);
    assert.equal(result.ok, true);
    assert.equal(result.agent, 'grok-desktop');
    assert.equal(result.deliver.transport, 'postMessage');
    assert.equal(result.deliver.windowTarget, 'parent');
    assert.equal(result.deliver.targetOrigin, 'http://localhost:1420');
    assert.equal(result.deliver.label, 'Grok Desktop');
    assert.equal(result.deliver.payload.prompt, 'PROMPT\n');
    assert.deepEqual(result.events.map((event) => event.type), ['started', 'completed']);
    assert.deepEqual(context.events.map((event: any) => event.type), ['started', 'completed']);
});

test('http client posts the payload as JSON with the configured method and headers', async () => {
    const [target]: any = normalizeCustomAgents([{
        name: 'grok-desktop',
        label: 'Grok Desktop',
        url: 'http://127.0.0.1:8787/api/inspector/prompt',
        headers: { Authorization: 'Bearer x' },
    }]);
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 202 };
    };
    const result: any = await createCustomAgentAdapter(target, { fetch: fetchImpl }).send(makeRequest(), makeContext());
    assert.equal(result.ok, true);
    assert.equal(result.deliver, undefined);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:8787/api/inspector/prompt');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer x');
    assert.equal(JSON.parse(calls[0].init.body).prompt, 'PROMPT\n');
});

test('http client reports the failing status and body instead of claiming success', async () => {
    const [target]: any = normalizeCustomAgents([{ name: 'grok-desktop', label: 'Grok Desktop', url: 'http://127.0.0.1:8787/x' }]);
    const fetchImpl = async () => ({ ok: false, status: 503, text: async () => 'no  session\nopen' });
    const context = makeContext();
    const result: any = await createCustomAgentAdapter(target, { fetch: fetchImpl }).send(makeRequest(), context);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Grok Desktop responded 503: no session open');
    assert.deepEqual(context.events.map((event: any) => event.type), ['started', 'failed']);
});

test('http client with an unusable url reports unavailable and never sends', async () => {
    const [target]: any = normalizeCustomAgents([{ name: 'grok-desktop', transport: 'http' }]);
    let called = false;
    const adapter = createCustomAgentAdapter(target, { fetch: async () => { called = true; return { ok: true }; } });
    const availability: any = await adapter.isAvailable();
    const result: any = await adapter.send(makeRequest(), makeContext());
    assert.equal(availability.available, false);
    assert.match(availability.reason, /url/);
    assert.equal(result.ok, false);
    assert.equal(called, false);
});
