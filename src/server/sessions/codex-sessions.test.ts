import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listCodexSessions } from './codex-sessions.js';
import { toPublicSession } from './types.js';

const working = '11111111-1111-4111-8111-111111111111';
const idleNoLock = '22222222-2222-4222-8222-222222222222';
const complete = '33333333-3333-4333-8333-333333333333';
const subagent = '44444444-4444-4444-8444-444444444444';
const other = '55555555-5555-4555-8555-555555555555';
const archived = '66666666-6666-4666-8666-666666666666';

/**
 * One Codex rollout jsonl: session meta plus an optional lifecycle event.
 *
 * @param id Thread id.
 * @param cwd Session cwd stored in the meta payload.
 * @param threadSource `user` is listed; anything else is dropped.
 * @param event Lifecycle payload type. An empty string writes no event line, which stays idle.
 * @returns jsonl text.
 */
function rollout(id: string, cwd: string, threadSource: string, event: string) {
    const head = JSON.stringify({
        type: 'session_meta',
        payload: { id, cwd, thread_source: threadSource },
    });
    const tail = event
        ? `\n${JSON.stringify({ type: 'event_msg', payload: { type: event } })}\n`
        : '\n';
    return `${head}\n${tail}`;
}

/**
 * Write a rollout under `sessions/` or `archived_sessions/`.
 *
 * @param home Codex home.
 * @param id Thread id used in the filename.
 * @param body jsonl contents.
 * @param options `archivedFile` stores it outside the live tree. `mtime` older than the lookback window hides the file.
 *   Omitting both keeps a fresh live rollout.
 * @returns Absolute rollout path.
 */
function writeRollout(home: string, id: string, body: string, { archivedFile = false, mtime = null }: { archivedFile?: boolean; mtime?: Date | null } = {}) {
    const dir = path.join(home, archivedFile ? 'archived_sessions' : 'sessions', '2026', '09', '27');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `rollout-2026-09-27T00-00-00-${id}.jsonl`);
    fs.writeFileSync(file, body);
    if (mtime)
        fs.utimesSync(file, mtime, mtime);
    return file;
}

test('listCodexSessions returns the three in-project user threads with the last index title and lock status', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-proj-'));
    fs.mkdirSync(path.join(project, '.git'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
    const long = 'a'.repeat(121);
    fs.writeFileSync(path.join(home, 'session_index.jsonl'), [
        'not-json',
        JSON.stringify({ id: working, thread_name: 'old title', updated_at: '2099-01-01T00:00:00.000Z' }),
        JSON.stringify({ id: working, thread_name: 'newest title', updated_at: '2099-09-27T00:00:00.000Z' }),
        JSON.stringify({ id: idleNoLock, thread_name: long, updated_at: '2099-09-20T00:00:00.000Z' }),
        JSON.stringify({ id: complete, thread_name: 'done\nsecond line', updated_at: '2099-09-10T00:00:00.000Z' }),
        '',
    ].join('\n'));
    writeRollout(home, working, rollout(working, project, 'user', 'task_started'));
    writeRollout(home, idleNoLock, rollout(idleNoLock, project, 'user', 'task_started'));
    writeRollout(home, complete, rollout(complete, project, 'user', 'task_complete'));
    writeRollout(home, subagent, rollout(subagent, project, 'subagent', 'task_started'));
    writeRollout(home, other, rollout(other, path.join(project, '..', 'elsewhere'), 'user', 'task_started'));
    writeRollout(home, archived, rollout(archived, project, 'user', 'task_started'), { archivedFile: true });
    const old = new Date(Date.now() - 40 * 86400000);
    writeRollout(home, '77777777-7777-4777-8777-777777777777', rollout('77777777-7777-4777-8777-777777777777', project, 'user', 'task_started'), { mtime: old });
    fs.mkdirSync(path.join(home, 'thread-writer-locks'), { recursive: true });
    fs.writeFileSync(path.join(home, 'thread-writer-locks', `${working}.lock`), '');
    const listed = listCodexSessions({ projectRoot: project, config: { sessions: { home, limit: 20, lookbackDays: 30 } } });
    assert.equal(listed.delivery, 'prefill');
    assert.equal(listed.notice, undefined);
    assert.deepEqual(listed.sessions.map((session) => session.id), [working, idleNoLock, complete]);
    assert.equal(listed.sessions[0].title, 'newest title');
    assert.equal(listed.sessions[0].status, 'working');
    assert.equal(listed.sessions[0].live, true);
    assert.equal(listed.sessions[0].targetable, true);
    assert.equal(listed.sessions[1].status, 'idle');
    assert.equal(listed.sessions[1].live, false);
    assert.equal(listed.sessions[1].title.length, 120);
    assert.equal(listed.sessions[1].title.endsWith('…'), true);
    assert.equal(listed.sessions[2].status, 'idle');
    assert.equal(listed.sessions[2].title, 'done');
    assert.equal(listed.sessions[0].location, '.');
    const published = JSON.stringify(listed.sessions.map(toPublicSession));
    assert.equal(published.includes(project), false);
    assert.equal(published.includes('"cwd"'), false);
});

test('a lifecycle event outside the head and the 512KB tail is idle, and reads stay bounded', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bound-'));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bound-home-'));
    const id = '88888888-8888-4888-8888-888888888888';
    const dir = path.join(home, 'sessions', '2026', '09', '27');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `rollout-x-${id}.jsonl`);
    const size = 800 * 1024;
    const buf = Buffer.alloc(size, 0x61);
    const head = Buffer.from(JSON.stringify({ payload: { id, cwd: project, thread_source: 'user' } }) + '\n');
    head.copy(buf, 0);
    const event = Buffer.from(`{"payload":{"type":"task_started"}}`);
    event.copy(buf, 10_000);
    fs.writeFileSync(file, buf);
    fs.mkdirSync(path.join(home, 'thread-writer-locks'), { recursive: true });
    fs.writeFileSync(path.join(home, 'thread-writer-locks', `${id}.lock`), '');
    let bytes = 0;
    const io = {
        ...fs,
        readSync(handle: number, buffer: Buffer, offset: number, length: number, position: number | null) {
            bytes += length;
            return fs.readSync(handle, buffer, offset, length, position);
        },
        readFileSync(target: fs.PathOrFileDescriptor, encoding: BufferEncoding) {
            if (String(target).includes('rollout-'))
                throw new Error('full rollout read');
            return fs.readFileSync(target, encoding);
        },
    };
    const listed = listCodexSessions({
        projectRoot: project,
        config: { sessions: { home } },
        io,
    });
    assert.equal(listed.sessions[0]?.status, 'idle');
    assert.ok(bytes > 0);
    assert.ok(bytes <= 4096 + 65536 + 524288);
    assert.ok(bytes < size);
});

test('a missing Codex home is an empty list and an unreadable rollout shape is unsupported-format', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-miss-'));
    const missing = listCodexSessions({
        projectRoot: project,
        config: { sessions: { home: path.join(project, 'no-such-home') } },
    });
    assert.deepEqual(missing.sessions, []);
    assert.equal(missing.notice, undefined);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bad-'));
    const dir = path.join(home, 'sessions', '2026', '09', '27');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'rollout-x-99999999-9999-4999-8999-999999999999.jsonl'), 'this is not a session meta\n');
    const listed = listCodexSessions({ projectRoot: project, config: { sessions: { home } } });
    assert.deepEqual(listed.sessions, []);
    assert.equal(listed.notice, 'unsupported-format');
});
