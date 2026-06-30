import assert from 'node:assert/strict';
import test from 'node:test';
import { createInspectorServer } from './inspector-server.js';

const TOKEN = 'test-token';
const PAGE_ORIGIN = 'http://127.0.0.1:5300';

/** Minimal registry/logger doubles so the standalone server can be exercised without the full agent stack. */
function makeDeps(overrides = {}) {
    const registry = {
        names: () => ['claude-app'],
        has: (name) => name === 'claude-app',
        listAvailable: async () => [{ name: 'claude-app', available: true }],
        get: () => ({ isAvailable: async () => ({ available: true }), send: async () => ({ ok: true, events: [] }) }),
    };
    const noop = () => {};
    return {
        options: { defaultAgent: 'claude-app' },
        token: TOKEN,
        registry,
        sessionStore: {},
        logger: { info: noop, warn: noop, error: noop, audit: noop },
        clientCode: 'console.log("client v1")',
        projectRoot: process.cwd(),
        outputDirAbs: process.cwd(),
        ...overrides,
    };
}

test('createInspectorServer serves client.js with CORS for a token-bearing cross-origin request', async () => {
    const srv = await createInspectorServer(makeDeps());
    try {
        assert.match(srv.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
        const res = await fetch(`${srv.origin}/__intent-inspector/client.js?token=${TOKEN}`, {
            headers: { Origin: PAGE_ORIGIN },
        });
        assert.equal(res.status, 200);
        // The bootstrap is loaded as a cross-origin module script, so ACAO must echo the page origin.
        assert.equal(res.headers.get('access-control-allow-origin'), PAGE_ORIGIN);
        assert.equal(await res.text(), 'console.log("client v1")');
    }
    finally {
        await srv.close();
    }
});

test('createInspectorServer guards API routes by token and falls through unknown paths', async () => {
    const srv = await createInspectorServer(makeDeps());
    try {
        const ok = await fetch(`${srv.origin}/__intent-inspector/agents?token=${TOKEN}`, {
            headers: { Origin: PAGE_ORIGIN },
        });
        assert.equal(ok.status, 200);
        assert.equal((await ok.json()).defaultAgent, 'claude-app');

        const bad = await fetch(`${srv.origin}/__intent-inspector/agents?token=wrong`, {
            headers: { Origin: PAGE_ORIGIN },
        });
        assert.equal(bad.status, 403);

        const miss = await fetch(`${srv.origin}/not-an-inspector-route`);
        assert.equal(miss.status, 404);
    }
    finally {
        await srv.close();
    }
});

test('updateDeps swaps the served client bundle without restarting the listener', async () => {
    const srv = await createInspectorServer(makeDeps());
    try {
        const before = srv.origin;
        srv.updateDeps(makeDeps({ clientCode: 'console.log("client v2")' }));
        assert.equal(srv.origin, before, 'origin/port stays stable across updateDeps');
        const res = await fetch(`${srv.origin}/__intent-inspector/client.js?token=${TOKEN}`, {
            headers: { Origin: PAGE_ORIGIN },
        });
        assert.equal(await res.text(), 'console.log("client v2")');
    }
    finally {
        await srv.close();
    }
});
