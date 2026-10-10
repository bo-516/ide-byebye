import assert from 'node:assert/strict';
import test from 'node:test';
import { createInspectorServer } from '../inspector-server.js';
import { buildRegistry } from './build.js';

const TOKEN = 'test-token';

/**
 * Agent rows `GET /agents` returns for `agents`, with every availability check stubbed so no CLI is spawned.
 *
 * @param {Record<string, unknown>} agents Plugin `agents` option.
 * @returns {Promise<Array<{ name: string, available: boolean }>>} Rows in registry order.
 */
async function listedAgents(agents: Record<string, unknown>) {
    const registry = buildRegistry(agents);
    for (const adapter of registry.adapters.values())
        adapter.isAvailable = async () => ({ available: true });
    const noop = () => {};
    const srv = await createInspectorServer({
        options: { defaultAgent: 'claude-app' },
        token: TOKEN,
        registry,
        sessionStore: {},
        logger: { info: noop, warn: noop, error: noop, audit: noop },
        clientCode: '',
        projectRoot: process.cwd(),
        outputDirAbs: process.cwd(),
    });
    try {
        const res = await fetch(`${srv.origin}/__intent-inspector/agents?token=${TOKEN}`);
        assert.equal(res.status, 200);
        return (await res.json()).agents as Array<{ name: string, available: boolean }>;
    }
    finally {
        await srv.close();
    }
}

test('GET /agents lists Claude Code CLI, OpenCode, and Devin CLI by default, right after Grok Build', async () => {
    assert.deepEqual((await listedAgents({})).map((row) => row.name), [
        'clipboard', 'file', 'codex-app', 'claude-app', 'cursor-app', 'grok-build', 'claude-cli', 'opencode', 'devin-cli',
    ]);
});

test('agents.claudeCli / agents.opencode set to false or { enabled: false } remove them (AC-8)', async () => {
    for (const off of [false, { enabled: false }]) {
        const names = (await listedAgents({ claudeCli: off, opencode: off })).map((row) => row.name);
        assert.equal(names.includes('claude-cli'), false, JSON.stringify(off));
        assert.equal(names.includes('opencode'), false, JSON.stringify(off));
        assert.equal(names.includes('grok-build'), true);
    }
    const objects = buildRegistry({ claudeCli: { launch: 'terminal', permissionMode: 'plan' }, opencode: { launch: 'app' } });
    assert.equal(objects.has('claude-cli'), true);
    assert.equal(objects.has('opencode'), true);
});
