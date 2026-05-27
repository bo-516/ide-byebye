import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    buildProjectSessionSearchArgs,
    listProjectCodexSessions,
    parseCodexSessionFile,
    parseCodexSessionMessages,
    recentSessionDateDirs,
    resolveCodexProjectRoots,
    resolveCodexSessionsRoot,
} from '../server/codex-sessions.js';

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'cii-codex-sessions-'));
}

function writeJsonl(filePath, records) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
}

test('resolves only ~/.codex/sessions by default', () => {
    assert.equal(resolveCodexSessionsRoot(undefined, '/Users/example'), '/Users/example/.codex/sessions');
});

test('computes recent local date directories newest first', () => {
    const dirs = recentSessionDateDirs('/sessions', 3, new Date(2026, 4, 27, 20, 22));

    assert.deepEqual(dirs, [
        '/sessions/2026/05/27',
        '/sessions/2026/05/26',
        '/sessions/2026/05/25',
    ]);
});

test('builds one ripgrep command over computed directories', () => {
    assert.deepEqual(buildProjectSessionSearchArgs('/repo/app', ['/sessions/2026/05/27']), [
        '-l',
        '--fixed-strings',
        '/repo/app',
        '/sessions/2026/05/27',
    ]);
});

test('builds one ripgrep command for multiple project roots', () => {
    assert.deepEqual(buildProjectSessionSearchArgs(['/repo/app', '/repo'], ['/sessions/2026/05/27']), [
        '-l',
        '--fixed-strings',
        '-e',
        '/repo/app',
        '-e',
        '/repo',
        '/sessions/2026/05/27',
    ]);
});

test('deduplicates session project roots', () => {
    assert.deepEqual(resolveCodexProjectRoots('/repo/app', ['/repo/app', '/repo']), ['/repo/app', '/repo']);
});

test('parses metadata and first user message from a matched JSONL file', async () => {
    const root = tempDir();
    const projectRoot = '/repo/current';
    const filePath = path.join(root, '2026/05/27/rollout-2026-05-27T10-11-12-thread-1.jsonl');
    writeJsonl(filePath, [
        {
            timestamp: '2026-05-27T02:11:12.000Z',
            type: 'session_meta',
            payload: {
                id: 'thread-1',
                timestamp: '2026-05-27T02:11:12.000Z',
                cwd: projectRoot,
                originator: 'Codex Desktop',
                model_provider: 'openai',
            },
        },
        {
            type: 'event_msg',
            payload: {
                type: 'user_message',
                message: 'Fix the dock layout',
            },
        },
    ]);

    const parsed = await parseCodexSessionFile(filePath, projectRoot);

    assert.equal(parsed.id, 'thread-1');
    assert.equal(parsed.title, 'Fix the dock layout');
    assert.equal(parsed.cwd, projectRoot);
    assert.equal(parsed.source, 'Codex Desktop');
    assert.equal(parsed.model, 'openai');
});

test('prefers session index thread_name over the first user message title', async () => {
    const base = tempDir();
    const root = path.join(base, 'sessions');
    const projectRoot = '/repo/current';
    const filePath = path.join(root, '2026/05/27/rollout-2026-05-27T10-11-12-thread-1.jsonl');
    writeJsonl(filePath, [
        { type: 'session_meta', payload: { id: 'thread-1', cwd: projectRoot, timestamp: '2026-05-27T10:00:00.000Z' } },
        { type: 'event_msg', payload: { type: 'user_message', message: 'This was my raw message' } },
    ]);
    fs.writeFileSync(path.join(base, 'session_index.jsonl'), JSON.stringify({
        id: 'thread-1',
        thread_name: 'Real generated session title',
        updated_at: '2026-05-27T11:00:00.000Z',
    }) + '\n');

    const sessions = await listProjectCodexSessions({
        projectRoot,
        sessionsRoot: root,
        days: 1,
        now: new Date(2026, 4, 27, 12),
        searchFiles: async () => [filePath],
    });

    assert.equal(sessions[0].title, 'Real generated session title');
    assert.equal(sessions[0].updatedAt, '2026-05-27T11:00:00.000Z');
});

test('parses displayable session history without bootstrap or duplicate messages', async () => {
    const root = tempDir();
    const projectRoot = '/repo/current';
    const filePath = path.join(root, '2026/05/27/history.jsonl');
    writeJsonl(filePath, [
        { type: 'session_meta', payload: { id: 'thread-history', cwd: projectRoot } },
        { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context> <cwd>/repo/current</cwd>' }] } },
        { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for /repo/current\nignore' }] } },
        { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello Codex' }] } },
        { type: 'event_msg', payload: { type: 'user_message', message: 'Hello Codex' } },
        { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Working on it' }] } },
        { type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: 'Working on it' } },
        { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Done' }] } },
        { type: 'event_msg', payload: { type: 'agent_message', phase: 'final_answer', message: 'Done' } },
    ]);

    const messages = await parseCodexSessionMessages(filePath, projectRoot);

    assert.deepEqual(messages, [
        { type: 'user', text: 'Hello Codex' },
        { type: 'status', text: 'Working on it' },
        { type: 'assistant', text: 'Done' },
    ]);
});

test('skips environment context when deriving a session title', async () => {
    const root = tempDir();
    const projectRoot = '/repo/current';
    const filePath = path.join(root, '2026/05/27/env-first.jsonl');
    writeJsonl(filePath, [
        { type: 'session_meta', payload: { id: 'thread-env', cwd: projectRoot } },
        { type: 'event_msg', payload: { type: 'user_message', message: '<environment_context> <cwd>/repo/current</cwd>' } },
        { type: 'event_msg', payload: { type: 'user_message', message: '# Files mentioned by the user:\n\n## a.png\n\n## My request for Codex:\nBuild the web dock' } },
    ]);

    const parsed = await parseCodexSessionFile(filePath, projectRoot);

    assert.equal(parsed.title, 'Build the web dock');
});

test('skips AGENTS instructions when deriving a session title', async () => {
    const root = tempDir();
    const projectRoot = '/repo/current';
    const filePath = path.join(root, '2026/05/27/agents-first.jsonl');
    writeJsonl(filePath, [
        { type: 'session_meta', payload: { id: 'thread-agents', cwd: projectRoot } },
        { type: 'event_msg', payload: { type: 'user_message', message: '# AGENTS.md instructions for /repo/current\n<INSTRUCTIONS>' } },
        { type: 'event_msg', payload: { type: 'user_message', message: 'Fix session titles' } },
    ]);

    const parsed = await parseCodexSessionFile(filePath, projectRoot);

    assert.equal(parsed.title, 'Fix session titles');
});

test('lists only exact-cwd project sessions and sorts newest first', async () => {
    const root = tempDir();
    const projectRoot = '/repo/current';
    const newer = path.join(root, '2026/05/27/newer.jsonl');
    const older = path.join(root, '2026/05/26/older.jsonl');
    const other = path.join(root, '2026/05/27/other.jsonl');
    writeJsonl(newer, [
        { type: 'session_meta', payload: { id: 'newer', cwd: projectRoot, timestamp: '2026-05-27T10:00:00.000Z' } },
        { type: 'event_msg', payload: { type: 'user_message', message: 'Newer task' } },
    ]);
    writeJsonl(older, [
        { type: 'session_meta', payload: { id: 'older', cwd: projectRoot, timestamp: '2026-05-26T10:00:00.000Z' } },
        { type: 'event_msg', payload: { type: 'user_message', message: 'Older task' } },
    ]);
    writeJsonl(other, [
        { type: 'session_meta', payload: { id: 'other', cwd: '/repo/other', timestamp: '2026-05-27T11:00:00.000Z' } },
        { type: 'event_msg', payload: { type: 'user_message', message: 'Other task' } },
    ]);
    fs.utimesSync(older, new Date('2026-05-26T10:00:00Z'), new Date('2026-05-26T10:00:00Z'));
    fs.utimesSync(newer, new Date('2026-05-27T10:00:00Z'), new Date('2026-05-27T10:00:00Z'));

    const sessions = await listProjectCodexSessions({
        projectRoot,
        sessionsRoot: root,
        days: 2,
        now: new Date(2026, 4, 27, 12),
        searchFiles: async () => [older, other, newer],
    });

    assert.deepEqual(sessions.map((session) => session.id), ['newer', 'older']);
});

test('lists sessions matching alternate project roots', async () => {
    const root = tempDir();
    const viteRoot = '/repo/current/web';
    const cwdRoot = '/repo/current';
    const filePath = path.join(root, '2026/05/27/current.jsonl');
    writeJsonl(filePath, [
        { type: 'session_meta', payload: { id: 'current', cwd: cwdRoot, timestamp: '2026-05-27T10:00:00.000Z' } },
        { type: 'event_msg', payload: { type: 'user_message', message: 'Use project cwd' } },
    ]);

    const sessions = await listProjectCodexSessions({
        projectRoot: viteRoot,
        projectRoots: [cwdRoot],
        sessionsRoot: root,
        days: 1,
        now: new Date(2026, 4, 27, 12),
        searchFiles: async (roots) => {
            assert.deepEqual(roots, [viteRoot, cwdRoot]);
            return [filePath];
        },
    });

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].cwd, cwdRoot);
});

test('falls back to a Node scan when rg is unavailable', async () => {
    const root = tempDir();
    const projectRoot = '/repo/current';
    const filePath = path.join(root, '2026/05/27/current.jsonl');
    const otherPath = path.join(root, '2026/05/27/other.jsonl');
    writeJsonl(filePath, [
        { type: 'session_meta', payload: { id: 'current', cwd: projectRoot, timestamp: '2026-05-27T10:00:00.000Z' } },
        { type: 'event_msg', payload: { type: 'user_message', message: 'Recover without rg' } },
    ]);
    writeJsonl(otherPath, [
        { type: 'session_meta', payload: { id: 'other', cwd: '/repo/other', timestamp: '2026-05-27T10:00:00.000Z' } },
        { type: 'event_msg', payload: { type: 'user_message', message: 'Other project' } },
    ]);

    const sessions = await listProjectCodexSessions({
        projectRoot,
        sessionsRoot: root,
        days: 1,
        now: new Date(2026, 4, 27, 12),
        rgPath: path.join(root, 'missing-rg'),
    });

    assert.deepEqual(sessions.map((session) => session.id), ['current']);
});
