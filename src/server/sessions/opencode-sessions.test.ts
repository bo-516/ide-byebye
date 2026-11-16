import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    listOpenCodeSessions,
    parseOpenCodeSessionList,
    runOpenCodeList,
} from './opencode-sessions.js';
import { toPublicSession } from './types.js';

const SESSION_A = 'ses_f9a103a5effepX7TCcFnkKPZNR';
const SESSION_B = 'ses_3cf7dd8d4ffeUPfENpVxfFojZ2';
const SESSION_GONE = 'ses_999999999999deadbeefcafe01';

test('parseOpenCodeSessionList parses ms/sec/ISO timestamps, drops bad ids, and flags non-array payloads', () => {
    const parsed = parseOpenCodeSessionList(JSON.stringify([
        { id: SESSION_A, title: 'First\nline two', directory: '/repo/app', updated: 1794797350230 },
        { id: SESSION_B, title: 'Seconds fallback', directory: '/repo/app', created: 1700000000 },
        { id: 'ses_iso12345', title: 'ISO', directory: '/repo/app', updated: '2026-11-16T00:00:00.000Z' },
        { id: 'not-ses-id', title: 'Bad prefix', directory: '/repo/app', updated: 1794797350230 },
        { id: 'ses_bad-dash', title: 'Hyphen rejected', directory: '/repo/app', updated: 1794797350230 },
        { id: SESSION_GONE, title: 'Blank dir', directory: '   ', updated: 1794797350230 },
    ]));
    assert.equal(parsed.valid, true);
    assert.deepEqual(parsed.rows.map((row) => row.id), [SESSION_A, SESSION_B, 'ses_iso12345']);
    assert.equal(parsed.rows[0].title, 'First');
    assert.equal(parsed.rows[0].updatedAt, new Date(1794797350230).toISOString());
    assert.equal(parsed.rows[1].updatedAt, new Date(1700000000 * 1000).toISOString());
    assert.equal(parsed.rows[2].updatedAt, '2026-11-16T00:00:00.000Z');
    assert.deepEqual(parseOpenCodeSessionList('not json'), { rows: [], valid: false });
    assert.deepEqual(parseOpenCodeSessionList('{"sessions":[]}'), { rows: [], valid: false });
});

test('runOpenCodeList uses --standalone first and only retries without it when standalone is rejected', () => {
    const calls: string[][] = [];
    const out2x = runOpenCodeList('/bin/opencode', '/repo', (_cmd, args) => {
        calls.push([...args]);
        return '[]';
    });
    assert.equal(out2x, '[]');
    assert.deepEqual(calls, [['session', 'list', '--standalone', '--format', 'json']]);

    const calls1x: string[][] = [];
    const out1x = runOpenCodeList('/bin/opencode', '/repo', (_cmd, args) => {
        calls1x.push([...args]);
        if (args.includes('--standalone')) {
            const err = Object.assign(new Error('exit 1'), { stderr: Buffer.from('Unknown argument: standalone') });
            throw err;
        }
        return '[{"id":"ses_abc12345"}]';
    });
    assert.equal(out1x, '[{"id":"ses_abc12345"}]');
    assert.deepEqual(calls1x, [
        ['session', 'list', '--standalone', '--format', 'json'],
        ['session', 'list', '--format', 'json'],
    ]);

    const otherCalls: string[][] = [];
    assert.throws(() => runOpenCodeList('/bin/opencode', '/repo', (_cmd, args) => {
        otherCalls.push([...args]);
        throw new Error('SQLITE_BUSY: database is locked');
    }), /SQLITE_BUSY/);
    assert.equal(otherCalls.length, 1);
});

test('listOpenCodeSessions filters to project scope, marks missing cwds, and leaks no paths', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'oc-sess-')));
    try {
        const project = path.join(root, 'packages', 'web');
        const gone = path.join(project, 'deleted-sub');
        const outside = path.join(root, '..', 'other-repo');
        fs.mkdirSync(path.join(root, '.git'));
        fs.mkdirSync(project, { recursive: true });
        const list = JSON.stringify([
            { id: SESSION_B, title: 'Older', directory: project, updated: 1790000000000 },
            { id: SESSION_A, title: 'Newest', directory: root, updated: 1795000000000 },
            { id: SESSION_GONE, title: 'Removed folder', directory: gone, updated: 1792000000000 },
            { id: 'ses_outside12345', title: 'Elsewhere', directory: outside, updated: 1799000000000 },
        ]);
        const res = await listOpenCodeSessions({
            projectRoot: project,
            config: { sessions: { limit: 2 } },
            io: { resolveCommand: () => '/bin/opencode', runList: () => list },
        });
        assert.equal(res.delivery, 'resume-submit');
        assert.equal(res.notice, undefined);
        assert.deepEqual(res.sessions.map((row) => row.id), [SESSION_A, SESSION_GONE]);
        assert.equal(res.sessions[0].targetable, true);
        assert.equal(res.sessions[1].targetable, false);
        assert.equal(res.sessions[1].reason, 'cwd-missing');
        const publicJson = JSON.stringify(res.sessions.map(toPublicSession));
        assert.equal(publicJson.includes(root), false);
        assert.equal(publicJson.includes('"cwd"'), false);
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('listOpenCodeSessions reports cli-unreachable and unsupported-format notices', async () => {
    assert.deepEqual(
        await listOpenCodeSessions({ projectRoot: '/repo', io: { resolveCommand: () => null } }),
        { sessions: [], delivery: 'resume-submit', notice: 'cli-unreachable' },
    );
    assert.deepEqual(
        await listOpenCodeSessions({
            projectRoot: '/repo',
            io: { resolveCommand: () => '/bin/opencode', runList: () => { throw new Error('timeout'); } },
        }),
        { sessions: [], delivery: 'resume-submit', notice: 'cli-unreachable' },
    );
    assert.deepEqual(
        await listOpenCodeSessions({
            projectRoot: '/repo',
            io: { resolveCommand: () => '/bin/opencode', runList: () => 'unexpected table output' },
        }),
        { sessions: [], delivery: 'resume-submit', notice: 'unsupported-format' },
    );
});
