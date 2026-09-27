import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { buildRegistry } from './build.js';
import {
    antigravityIdeLauncherExtension,
    buildAntigravityIdeFilePrompt,
    buildAntigravityIdeLauncherFile,
    buildAntigravityIdeLauncherScript,
    collectAntigravityIdeContextFiles,
    resolveAntigravityIdeCommandCandidates,
    resolveAntigravityIdeProjectRoot,
    retainPathsInsideRoots,
    shouldWriteAntigravityIdePromptFile,
} from './antigravity-ide-cli.js';

test('Antigravity IDE stays unregistered until config turns it on', () => {
    assert.equal(buildRegistry({}).has('antigravity-ide'), false);
    assert.equal(buildRegistry({ antigravityIde: false }).has('antigravity-ide'), false);
    assert.equal(buildRegistry({ antigravityIde: { enabled: false } }).has('antigravity-ide'), false);
    const enabled = buildRegistry({ antigravityIde: true });
    assert.equal(enabled.has('antigravity-ide'), true);
    assert.deepEqual(enabled.names().slice(-1), ['antigravity-ide']);
});

test('resolveAntigravityIdeCommandCandidates prefers command, then the platform install', () => {
    assert.deepEqual(resolveAntigravityIdeCommandCandidates({ command: '/opt/agy-ide' }), ['/opt/agy-ide']);
    assert.deepEqual(
        resolveAntigravityIdeCommandCandidates({}, { platform: 'darwin' }),
        ['antigravity-ide', '/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide'],
    );
    assert.deepEqual(
        resolveAntigravityIdeCommandCandidates({}, { platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' } }),
        ['antigravity-ide', path.join('C:\\Users\\me\\AppData\\Local', 'Programs', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd')],
    );
    assert.deepEqual(resolveAntigravityIdeCommandCandidates({}, { platform: 'linux' }), ['antigravity-ide']);
});

test('resolveAntigravityIdeProjectRoot uses the override, else the bundler root', () => {
    assert.equal(
        resolveAntigravityIdeProjectRoot({ projectRoot: 'fixtures/app' }, { projectRoot: '/tmp/vite-root' }),
        path.resolve('fixtures/app'),
    );
    assert.equal(
        resolveAntigravityIdeProjectRoot({}, { projectRoot: '/tmp/vite-root' }),
        '/tmp/vite-root',
    );
});

test('retainPathsInsideRoots drops paths outside every trusted root', () => {
    const files = collectAntigravityIdeContextFiles({
        source: { filePath: '/repo/src/App.tsx' },
        references: [{ source: { filePath: '/repo/src/App.tsx' } }, { source: { filePath: '/etc/passwd' } }],
        screenshots: [{ filePath: '/repo/.intent-inspector/screenshots/a.webp' }],
        recordings: [{ stillFramePath: '/repo/.intent-inspector/screenshots/b.webp' }],
    });
    assert.deepEqual(retainPathsInsideRoots(files, ['/repo']), [
        '/repo/src/App.tsx',
        '/repo/.intent-inspector/screenshots/a.webp',
        '/repo/.intent-inspector/screenshots/b.webp',
    ]);
});

test('shouldWriteAntigravityIdePromptFile forces a pointer for file mode, leading dashes, and long prompts', () => {
    assert.equal(shouldWriteAntigravityIdePromptFile({ promptMode: 'file' }, 'short'), true);
    assert.equal(shouldWriteAntigravityIdePromptFile({ promptMode: 'auto' }, 'short'), false);
    assert.equal(shouldWriteAntigravityIdePromptFile({ promptMode: 'auto' }, '-flag looking prompt'), true);
    assert.equal(shouldWriteAntigravityIdePromptFile({ promptArgLimit: 4 }, 'hello'), true);
    assert.equal(shouldWriteAntigravityIdePromptFile({}, 'x'.repeat(12001)), true);
});

test('buildAntigravityIdeFilePrompt starts with a non-flag label and names the handoff', () => {
    const prompt = buildAntigravityIdeFilePrompt({ intent: '-do it', projectRoot: '/repo' }, '/repo/.intent-inspector/requests/a.md');
    assert.equal(prompt.startsWith('Request file:\n/repo/.intent-inspector/requests/a.md\n'), true);
    assert.match(prompt, /-do it\n$/);
});

test('buildAntigravityIdeLauncherScript only opens the folder', () => {
    const script = buildAntigravityIdeLauncherScript({
        command: '/opt/antigravity-ide',
        cwd: '/tmp/proj',
        reuseWindow: true,
        newWindow: true,
    });
    assert.match(script, /^#!\/bin\/bash\n/);
    assert.match(script, /cd '\/tmp\/proj'/);
    assert.match(script, /'\/opt\/antigravity-ide' '\/tmp\/proj' --new-window\n/);
    assert.doesNotMatch(script, /\bchat\b/);
    assert.doesNotMatch(script, /sleep/);
});

test('buildAntigravityIdeLauncherFile uses a cmd wrapper on Windows', () => {
    assert.equal(antigravityIdeLauncherExtension('win32'), '.cmd');
    const script = buildAntigravityIdeLauncherFile({
        command: 'antigravity-ide.cmd',
        cwd: 'C:\\repo',
    }, 'win32');
    assert.match(script, /^@echo off\r\n/);
    assert.match(script, /EncodedCommand /);
    const encoded = script.split('EncodedCommand ')[1].trim();
    const program = Buffer.from(encoded, 'base64').toString('utf16le');
    assert.match(program, /& 'antigravity-ide\.cmd' 'C:\\repo'/);
    assert.doesNotMatch(program, /\bchat\b/);
    assert.doesNotMatch(program, /Get-Content/);
});
