import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildRegistry } from './build.js';
import {
    antigravityLauncherExtension,
    buildAntigravityFilePrompt,
    buildAntigravityLauncherFile,
    buildAntigravityLauncherScript,
    buildAntigravityPrompt,
    resolveAntigravityCommandCandidates,
    resolveAntigravityProjectRoot,
    shouldWriteAntigravityPromptFile,
} from './antigravity-launcher.js';

test('Antigravity CLI stays unregistered until config turns it on', () => {
    assert.equal(buildRegistry({}).has('antigravity'), false);
    assert.equal(buildRegistry({ antigravity: false }).has('antigravity'), false);
    assert.equal(buildRegistry({ antigravity: { enabled: false } }).has('antigravity'), false);
    const enabled = buildRegistry({ antigravity: { command: '/opt/agy', mode: 'plan' } });
    assert.equal(enabled.has('antigravity'), true);
    assert.equal(enabled.has('antigravity-ide'), false);
});

test('both opt-in agents register after the default footer agents', () => {
    assert.deepEqual(
        buildRegistry({ antigravityIde: true, antigravity: true }).names(),
        ['clipboard', 'file', 'codex-app', 'claude-app', 'cursor-app', 'grok-build', 'claude-cli', 'opencode', 'antigravity-ide', 'antigravity'],
    );
});

test('resolveAntigravityCommandCandidates prefers command, then the user install', () => {
    assert.deepEqual(resolveAntigravityCommandCandidates({ command: '/opt/agy' }), ['/opt/agy']);
    assert.deepEqual(
        resolveAntigravityCommandCandidates({}, { platform: 'darwin', homedir: '/Users/me' }),
        ['agy', path.join('/Users/me', '.local', 'bin', 'agy')],
    );
    assert.deepEqual(
        resolveAntigravityCommandCandidates({}, { platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' } }),
        ['agy', path.join('C:\\Users\\me\\AppData\\Local', 'agy', 'bin', 'agy.exe')],
    );
    assert.equal(resolveAntigravityCommandCandidates({}, { platform: 'linux', homedir: os.homedir() })[0], 'agy');
});

test('resolveAntigravityProjectRoot uses the override, else the bundler root', () => {
    assert.equal(
        resolveAntigravityProjectRoot({ projectRoot: 'fixtures/app' }, { projectRoot: '/tmp/vite-root' }),
        path.resolve('fixtures/app'),
    );
    assert.equal(resolveAntigravityProjectRoot({}, { projectRoot: '/tmp/vite-root' }), '/tmp/vite-root');
});

test('shouldWriteAntigravityPromptFile honors file mode and the argv budget', () => {
    assert.equal(shouldWriteAntigravityPromptFile({ promptMode: 'file' }, 'short'), true);
    assert.equal(shouldWriteAntigravityPromptFile({ promptMode: 'auto' }, 'short'), false);
    assert.equal(shouldWriteAntigravityPromptFile({ promptArgLimit: 4 }, 'hello'), true);
    assert.equal(shouldWriteAntigravityPromptFile({}, 'x'.repeat(12001)), true);
});

test('buildAntigravityPrompt keeps source refs relative to the CLI cwd', () => {
    const prompt = buildAntigravityPrompt({
        projectRoot: '/tmp/repo/apps/web',
        intent: 'Tighten the button',
        selection: { line: 4 },
        source: { filePath: '/tmp/repo/apps/web/src/App.tsx' },
    }, { projectRoot: '/tmp/repo' });
    assert.match(prompt, /@apps\/web\/src\/App\.tsx/);
    assert.match(prompt, /Tighten the button/);
});

test('buildAntigravityFilePrompt points at the handoff without inlining the full request', () => {
    const prompt = buildAntigravityFilePrompt({
        projectRoot: '/tmp/repo',
        intent: 'Look here',
    }, '/tmp/repo/.intent-inspector/requests/a.md', {});
    assert.match(prompt, /\.intent-inspector\/requests\/a\.md/);
    assert.match(prompt, /Look here/);
});

test('buildAntigravityLauncherScript quotes paths and reads the prompt from disk', () => {
    const script = buildAntigravityLauncherScript({
        command: '/opt/agy',
        cwd: "/tmp/it's",
        promptPath: '/tmp/prompt.txt',
        mode: 'plan',
    });
    assert.match(script, /cd '\/tmp\/it'\\''s'/);
    assert.match(script, /exec '\/opt\/agy' --mode 'plan' --prompt-interactive "\$\(cat '\/tmp\/prompt\.txt'\)"/);
    const withoutMode = buildAntigravityLauncherScript({
        command: 'agy',
        cwd: '/tmp/proj',
        promptPath: '/tmp/proj/p.txt',
    });
    assert.doesNotMatch(withoutMode, /--mode/);
    assert.match(withoutMode, /exec 'agy' --prompt-interactive/);
});

test('buildAntigravityLauncherFile encodes the Windows launcher', () => {
    assert.equal(antigravityLauncherExtension('darwin'), '.command');
    const script = buildAntigravityLauncherFile({
        command: 'agy.exe',
        cwd: 'C:\\repo',
        promptPath: 'C:\\repo\\prompt.txt',
        mode: 'accept-edits',
    }, 'win32');
    const encoded = script.split('EncodedCommand ')[1].trim();
    const program = Buffer.from(encoded, 'base64').toString('utf16le');
    assert.match(program, /--mode 'accept-edits' --prompt-interactive \$prompt/);
    assert.match(program, /Get-Content -LiteralPath 'C:\\repo\\prompt\.txt'/);
});
