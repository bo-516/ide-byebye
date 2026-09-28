import assert from 'node:assert/strict';
import test from 'node:test';
import { agentMenuRows } from './dialog-agent-model.js';

const ACTIONS = [
    { name: 'codex-app', label: 'Codex App', title: 'Open Codex', kind: 'app' },
    { name: 'grok-build', label: 'Grok Build', title: 'Open Grok', kind: 'terminal' },
    { name: 'my-client', label: 'My client', title: 'Send' },
];
const ENABLED = ['clipboard', 'codex-app', 'grok-build', 'my-client'];

test('agentMenuRows marks the Enter target and keeps menu order and kinds', () => {
    const rows = agentMenuRows(ACTIONS, { lastAgent: 'grok-build', enabledAgents: ENABLED });
    assert.deepEqual(rows.map((row) => [row.name, row.kind, row.selected]), [
        ['codex-app', 'app', false],
        ['grok-build', 'terminal', true],
        ['my-client', 'custom', false],
    ]);
    assert.equal(rows.every((row) => !row.unavailable && row.configured), true);
});

test('agentMenuRows treats unknown availability as available and carries the server reason', () => {
    const rows = agentMenuRows(ACTIONS, {
        enabledAgents: ENABLED,
        availability: [{ name: 'grok-build', available: false, reason: 'grok is not installed' }],
    });
    assert.equal(rows[0].unavailable, false);
    assert.equal(rows[1].unavailable, true);
    assert.equal(rows[1].reason, 'grok is not installed');
});

test('agentMenuRows marks agents missing from enabledAgents as unconfigured and unavailable', () => {
    const rows = agentMenuRows(ACTIONS, { enabledAgents: ['codex-app'] });
    assert.deepEqual(rows.map((row) => [row.configured, row.unavailable]), [[true, false], [false, true], [false, true]]);
    assert.equal(agentMenuRows(ACTIONS, {}).every((row) => row.unavailable), true);
});

test('agentMenuRows exposes a stored session only for agents that currently list sessions', () => {
    const targets = { 'codex-app': { id: 's1', title: 'Fix header' }, 'grok-build': { id: 's2' } };
    const rows = agentMenuRows(ACTIONS, {
        enabledAgents: ENABLED,
        targets,
        supports: (name) => name !== 'grok-build',
    });
    assert.deepEqual(rows[0].target, { id: 's1', title: 'Fix header' });
    assert.equal(rows[0].sessions, true);
    assert.equal(rows[1].target, null);
    assert.equal(rows[1].sessions, false);
    assert.equal(rows[2].target, null);
});

test('agentMenuRows returns no rows for a missing action list', () => {
    assert.deepEqual(agentMenuRows(undefined, {}), []);
});
