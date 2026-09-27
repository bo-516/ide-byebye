import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createGrokBuildAdapter } from '../agents/grok-build.js';
import { listGrokSessions } from './grok-sessions.js';

const liveId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const deadId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const missingId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const subId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const forkId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const headlessId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function writeSession(home, cwd, id, summary, events) {
    const dir = path.join(home, 'sessions', encodeURIComponent(cwd), id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary));
    if (events != null)
        fs.writeFileSync(path.join(dir, 'events.jsonl'), events);
}

test('listGrokSessions filters kinds, live pids, and missing cwds', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-proj-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-home-'));
    const gone = path.join(project, 'gone');
    writeSession(home, project, liveId, {
        generated_title: 'live one',
        last_active_at: '2026-09-27T00:00:00.000Z',
    }, [
        '{"type":"turn_ended"}',
        '{"type":"turn_started"}',
        '{"type":"phase_changed","phase":"permission_prompt"}',
    ].join('\n'));
    writeSession(home, project, deadId, {
        generated_title: 'closed one',
        session_kind: '',
        last_active_at: '2026-09-26T00:00:00.000Z',
    }, '{"type":"turn_ended"}\n{"type":"turn_started"}\n');
    writeSession(home, gone, missingId, {
        session_summary: 'missing cwd',
        last_active_at: '2026-09-25T00:00:00.000Z',
    });
    writeSession(home, project, subId, { generated_title: 'sub', session_kind: 'subagent' });
    writeSession(home, project, forkId, {
        generated_title: 'forked',
        session_kind: 'fork',
        last_active_at: '2026-09-24T00:00:00.000Z',
    });
    writeSession(home, project, headlessId, { generated_title: 'headless', session_kind: 'headless' });
    fs.writeFileSync(path.join(home, 'active_sessions.json'), JSON.stringify([
        { session_id: liveId, pid: process.pid, cwd: project },
        { session_id: deadId, pid: 2147483646, cwd: project },
    ]));
    const listed = await listGrokSessions({ projectRoot: project, config: { sessions: { home } } });
    const byId = new Map(listed.sessions.map((session) => [session.id, session]));
    assert.equal(byId.has(subId), false);
    assert.equal(byId.has(headlessId), false);
    assert.equal(byId.get(forkId)?.targetable, true);
    assert.equal(byId.get(liveId)?.targetable, false);
    assert.equal(byId.get(liveId)?.reason, 'open-in-terminal');
    assert.equal(byId.get(liveId)?.status, 'waiting');
    assert.equal(byId.get(deadId)?.targetable, true);
    assert.equal(byId.get(deadId)?.status, 'idle');
    assert.equal(byId.get(missingId)?.targetable, false);
    assert.equal(byId.get(missingId)?.reason, 'cwd-missing');
    assert.equal(listed.delivery, 'resume-submit');
});

test('an unreadable active_sessions.json is retried once and then marks every row live-unknown', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-retry-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-retry-home-'));
    writeSession(home, project, deadId, { generated_title: 'one', last_active_at: '2026-09-27T00:00:00.000Z' });
    fs.writeFileSync(path.join(home, 'active_sessions.json'), '{');
    let reads = 0;
    let sleeps = 0;
    const io = {
        ...fs,
        sleep: async () => {
            sleeps += 1;
        },
        readFileSync(file, encoding) {
            if (String(file).endsWith('active_sessions.json')) {
                reads += 1;
                if (reads === 1)
                    return '{';
                return JSON.stringify([{ session_id: deadId, pid: 2147483646 }]);
            }
            return fs.readFileSync(file, encoding);
        },
    };
    const retried = await listGrokSessions({ projectRoot: project, config: { sessions: { home } }, io });
    assert.equal(reads, 2);
    assert.equal(sleeps, 1);
    assert.equal(retried.sessions[0].targetable, true);
    const stuck = {
        ...fs,
        sleep: async () => {},
        readFileSync(file, encoding) {
            if (String(file).endsWith('active_sessions.json'))
                return '{';
            return fs.readFileSync(file, encoding);
        },
    };
    const unknown = await listGrokSessions({ projectRoot: project, config: { sessions: { home } }, io: stuck });
    assert.equal(unknown.sessions[0].targetable, false);
    assert.equal(unknown.sessions[0].reason, 'live-unknown');
});

test('a session that becomes live before the launcher is written returns target-busy and writes nothing', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-busy-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-busy-home-'));
    const output = path.join(project, '.intent-inspector');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(home, 'active_sessions.json'), JSON.stringify([
        { session_id: liveId, pid: process.pid },
    ]));
    const adapter = createGrokBuildAdapter({
        sessions: { home },
        command: process.execPath,
        openCommand: process.execPath,
        openArgs: ['-e', 'process.exit(0)'],
    });
    const result = await adapter.send({
        id: 'req-1',
        createdAt: new Date().toISOString(),
        intent: 'hi',
        projectRoot: project,
    }, {
        projectRoot: project,
        outputDir: output,
        prompt: 'hi\n',
        emit() {},
        targetSession: { id: liveId, cwd: project, targetable: true },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'target-busy');
    assert.equal(fs.existsSync(path.join(output, 'launches')), false);
});
