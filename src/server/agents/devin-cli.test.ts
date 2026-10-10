import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    buildDevinCliLauncherFile,
    buildDevinCliLauncherScript,
    buildDevinCliWindowsLauncherScript,
    devinCliLauncherExtension,
    DEVIN_SESSION_ID_PATTERN,
    resolveDevinCliCommandCandidates,
    resolveDevinCliProjectRoot,
    shouldWriteDevinCliPromptFile,
} from './devin-cli.js';
import { listDevinSessions, parseDevinSessionList } from '../sessions/devin-sessions.js';

test('buildDevinCliLauncherScript cds into the project and passes the prompt after --', () => {
    const script = buildDevinCliLauncherScript({
        command: 'devin',
        cwd: '/tmp/proj',
        promptPath: '/tmp/out/x.prompt.txt',
    });
    assert.match(script, /^#!\/bin\/bash\n/);
    assert.match(script, /cd '\/tmp\/proj' \|\| exit 1/);
    assert.match(script, /exec 'devin' -- "\$\(cat '\/tmp\/out\/x\.prompt\.txt'\)"/);
});

test('buildDevinCliLauncherScript adds resume, permission-mode, model, and cloud', () => {
    const script = buildDevinCliLauncherScript({
        command: '/Applications/Devin.app/cli/devin',
        cwd: '/tmp/proj',
        promptPath: '/tmp/out/x.prompt.txt',
        permissionMode: 'accept-edits',
        model: 'sonnet',
        cloud: true,
        resumeSessionId: 'alluring-calendula',
    });
    assert.match(script, /-r 'alluring-calendula'/);
    assert.match(script, /--permission-mode 'accept-edits'/);
    assert.match(script, /--model 'sonnet'/);
    assert.match(script, /--cloud/);
    assert.match(script, /-- "\$\(cat /);
});

test('buildDevinCliLauncherScript rejects a hostile resume id before it reaches the shell', () => {
    assert.throws(() => buildDevinCliLauncherScript({
        command: 'devin',
        cwd: '/tmp/proj',
        promptPath: '/tmp/out/x.prompt.txt',
        resumeSessionId: `x'; rm -rf ~; '`,
    }));
    assert.equal(DEVIN_SESSION_ID_PATTERN.test('alluring-calendula'), true);
    assert.equal(DEVIN_SESSION_ID_PATTERN.test('../etc'), false);
    assert.equal(DEVIN_SESSION_ID_PATTERN.test('--cloud'), false);
});

test('buildDevinCliLauncherScript uses --prompt-file instead of an inline prompt when promptFile is set', () => {
    const script = buildDevinCliLauncherScript({
        command: 'devin',
        cwd: '/tmp/proj',
        promptPath: '/tmp/out/x.prompt.txt',
        promptFile: '/tmp/out/requests/r.md',
    });
    assert.match(script, /--prompt-file '\/tmp\/out\/requests\/r\.md'/);
    assert.equal(script.includes('$(cat'), false);
});

test('buildDevinCliWindowsLauncherScript emits an encoded PowerShell program', () => {
    const script = buildDevinCliWindowsLauncherScript({
        command: 'devin',
        cwd: 'C:\\proj',
        promptPath: 'C:\\out\\x.prompt.txt',
        resumeSessionId: 'alluring-calendula',
    });
    assert.match(script, /^@echo off\r\n/);
    const encoded = script.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)?.[1] ?? '';
    const program = Buffer.from(encoded, 'base64').toString('utf16le');
    assert.match(program, /Set-Location -LiteralPath 'C:\\proj'/);
    assert.match(program, /-r 'alluring-calendula'/);
});

test('devinCliLauncherExtension picks .command off Windows', () => {
    assert.equal(devinCliLauncherExtension('darwin'), '.command');
    assert.equal(devinCliLauncherExtension('win32'), '.cmd');
});

test('buildDevinCliLauncherFile chooses the platform builder', () => {
    const input = { command: 'devin', cwd: '/tmp/proj', promptPath: '/tmp/x.txt' };
    assert.match(buildDevinCliLauncherFile(input, 'darwin'), /^#!\/bin\/bash/);
    assert.match(buildDevinCliLauncherFile(input, 'win32'), /^@echo off/);
});

test('resolveDevinCliCommandCandidates prefers config.command then PATH name then app bundle', () => {
    assert.deepEqual(resolveDevinCliCommandCandidates({ command: '/opt/devin' }), ['/opt/devin']);
    assert.deepEqual(resolveDevinCliCommandCandidates({}, { platform: 'darwin', homedir: '/u/me' }), [
        'devin',
        '/Applications/Devin.app/Contents/Resources/app/extensions/windsurf/devin/bin/devin',
        '/opt/homebrew/bin/devin',
        '/usr/local/bin/devin',
    ]);
    assert.deepEqual(resolveDevinCliCommandCandidates({}, { platform: 'linux', homedir: '/u/me' }), [
        'devin',
        '/u/me/.local/bin/devin',
    ]);
});

test('resolveDevinCliProjectRoot uses explicit override then bundler root', () => {
    assert.equal(
        resolveDevinCliProjectRoot({ projectRoot: 'fixtures/app' }, { projectRoot: '/tmp/vite-root' }),
        path.resolve('fixtures/app'),
    );
    assert.equal(resolveDevinCliProjectRoot({}, { projectRoot: '/tmp/vite-root' }), '/tmp/vite-root');
});

test('shouldWriteDevinCliPromptFile honors file mode and auto length budget', () => {
    assert.equal(shouldWriteDevinCliPromptFile({ promptMode: 'file' }, 'short'), true);
    assert.equal(shouldWriteDevinCliPromptFile({ promptMode: 'auto' }, 'short'), false);
    assert.equal(shouldWriteDevinCliPromptFile({ promptMode: 'auto', promptArgLimit: 4 }, 'hello'), true);
    assert.equal(shouldWriteDevinCliPromptFile({}, 'x'.repeat(12001)), true);
});

test('parseDevinSessionList keeps slug ids with a working directory and drops hostile rows', () => {
    const rows = parseDevinSessionList(JSON.stringify([
        { id: 'alluring-calendula', working_directory: '/repo', title: 'Fix bug', last_activity_at: 1791604678 },
        { id: "x'; rm -rf ~; '", working_directory: '/repo', title: 'evil' },
        { id: 'no-dir', working_directory: '', title: 'x' },
        { short_id: 'short-only', working_directory: '/repo/sub', title: 'fallback id', last_activity_at: 'bad' },
        'garbage',
    ]));
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, 'alluring-calendula');
    assert.equal(rows[0].workingDirectory, '/repo');
    assert.equal(rows[0].title, 'Fix bug');
    assert.equal(rows[0].updatedAt, new Date(1791604678 * 1000).toISOString());
    assert.equal(rows[1].id, 'short-only');
    assert.equal(rows[1].updatedAt, '');
    assert.deepEqual(parseDevinSessionList('not json'), []);
    assert.deepEqual(parseDevinSessionList('{"a":1}'), []);
});

test('listDevinSessions filters to the project scope and marks missing cwd non-targetable', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'devin-proj-'));
    const inside = path.join(project, 'app');
    fs.mkdirSync(inside, { recursive: true });
    const gone = path.join(project, 'gone');
    const list = JSON.stringify([
        { id: 'inside-proj', working_directory: inside, title: 'one', last_activity_at: 2000 },
        { id: 'outside-proj', working_directory: '/elsewhere-outside', title: 'two', last_activity_at: 3000 },
        { id: 'gone-proj', working_directory: gone, title: 'three', last_activity_at: 1000 },
    ]);
    const io = {
        resolveCommand: () => '/bin/devin',
        runList: () => list,
    };
    const res = await listDevinSessions({ projectRoot: project, config: {}, io });
    assert.equal(res.delivery, 'resume-submit');
    const ids = res.sessions.map((session) => session.id);
    assert.deepEqual(ids, ['inside-proj', 'gone-proj']);
    assert.equal(res.sessions[0].targetable, true);
    assert.equal(res.sessions[1].targetable, false);
    assert.equal(res.sessions[1].reason, 'cwd-missing');
});

test('listDevinSessions reports cli-unreachable when the binary or list call fails', async () => {
    const missing = await listDevinSessions({
        projectRoot: '/repo',
        config: {},
        io: { resolveCommand: () => null, runList: () => 'x' },
    });
    assert.deepEqual(missing, { sessions: [], delivery: 'resume-submit', notice: 'cli-unreachable' });
    const failing = await listDevinSessions({
        projectRoot: '/repo',
        config: {},
        io: {
            resolveCommand: () => '/bin/devin',
            runList: () => {
                throw new Error('boom');
            },
        },
    });
    assert.deepEqual(failing, { sessions: [], delivery: 'resume-submit', notice: 'cli-unreachable' });
});
