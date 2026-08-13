import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    buildGrokBuildFilePrompt,
    buildGrokBuildLauncherFile,
    buildGrokBuildLauncherScript,
    buildGrokBuildPrompt,
    buildGrokBuildWindowsLauncherScript,
    formatGrokBuildHandoffPath,
    grokBuildLauncherExtension,
    powershellSingleQuote,
    resolveGrokBuildCommandCandidates,
    resolveGrokBuildProjectRoot,
    shellSingleQuote,
    shouldWriteGrokBuildPromptFile,
    withGrokBuildPathRoot,
} from './grok-build.js';

test('shellSingleQuote wraps and escapes embedded single quotes for bash', () => {
    assert.equal(shellSingleQuote(`/tmp/proj`), `'/tmp/proj'`);
    assert.equal(shellSingleQuote(`it's`), `'it'\\''s'`);
});

test('resolveGrokBuildProjectRoot uses explicit override then Vite project root', () => {
    assert.equal(
        resolveGrokBuildProjectRoot({ projectRoot: 'fixtures/app' }, { projectRoot: '/tmp/vite-root' }),
        path.resolve('fixtures/app'),
    );
    assert.equal(
        resolveGrokBuildProjectRoot({}, { projectRoot: '/tmp/vite-root' }),
        '/tmp/vite-root',
    );
});

test('withGrokBuildPathRoot rewrites projectRoot to Grok cwd when configured', () => {
    const request = { projectRoot: '/tmp/repo/apps/desktop', source: { filePath: '/tmp/repo/apps/desktop/src/A.tsx' } };
    assert.equal(withGrokBuildPathRoot(request, {}).projectRoot, '/tmp/repo/apps/desktop');
    assert.equal(
        withGrokBuildPathRoot(request, { projectRoot: '/tmp/repo' }).projectRoot,
        '/tmp/repo',
    );
    assert.notEqual(withGrokBuildPathRoot(request, { projectRoot: '/tmp/repo' }), request);
});

test('formatGrokBuildHandoffPath prefers cwd-relative paths', () => {
    assert.equal(
        formatGrokBuildHandoffPath('/tmp/repo/apps/desktop/.intent-inspector/requests/a.md', '/tmp/repo', 'relative'),
        'apps/desktop/.intent-inspector/requests/a.md',
    );
    assert.equal(
        formatGrokBuildHandoffPath('/tmp/repo/.intent-inspector/requests/a.md', '/tmp/repo', 'relative'),
        '.intent-inspector/requests/a.md',
    );
    assert.equal(
        formatGrokBuildHandoffPath('/tmp/repo/a.md', '/tmp/repo', 'absolute'),
        '/tmp/repo/a.md',
    );
});

test('resolveGrokBuildCommandCandidates prefers config.command then default install paths', () => {
    assert.deepEqual(resolveGrokBuildCommandCandidates({ command: '/opt/grok' }), ['/opt/grok']);
    assert.deepEqual(resolveGrokBuildCommandCandidates({}), [
        'grok',
        path.join(os.homedir(), '.grok', 'bin', 'grok'),
    ]);
});

test('shouldWriteGrokBuildPromptFile honors file mode and auto length budget', () => {
    assert.equal(shouldWriteGrokBuildPromptFile({ promptMode: 'file' }, 'short'), true);
    assert.equal(shouldWriteGrokBuildPromptFile({ promptMode: 'auto' }, 'short'), false);
    assert.equal(shouldWriteGrokBuildPromptFile({ promptMode: 'auto', promptArgLimit: 4 }, 'hello'), true);
    assert.equal(shouldWriteGrokBuildPromptFile({}, 'x'.repeat(12001)), true);
});

test('buildGrokBuildFilePrompt defaults relative source + absolute screenshot refs', () => {
    const prompt = buildGrokBuildFilePrompt({
        projectRoot: '/tmp/project',
        selection: { line: 4 },
        source: {
            filePath: '/tmp/project/src/Button.jsx',
            selectedNodeRange: { startLine: 4, endLine: 8 },
        },
        screenshots: [
            { filePath: '/tmp/project/.intent-inspector/screenshots/n708w16.webp' },
        ],
        intent: 'please keep working on this button',
    }, '/tmp/project/.intent-inspector/requests/request.md');

    assert.equal(
        prompt,
        [
            '@src/Button.jsx #4-8',
            '@/tmp/project/.intent-inspector/screenshots/n708w16.webp',
            '.intent-inspector/requests/request.md',
            '',
            'please keep working on this button',
            '',
        ].join('\n'),
    );
});

test('buildGrokBuildFilePrompt roots relative source at monorepo projectRoot; screenshots stay absolute', () => {
    const prompt = buildGrokBuildFilePrompt({
        projectRoot: '/tmp/project/apps/desktop',
        selection: { line: 4 },
        source: {
            filePath: '/tmp/project/apps/desktop/src/Button.jsx',
            selectedNodeRange: { startLine: 4, endLine: 8 },
        },
        screenshots: [
            { filePath: '/tmp/project/apps/desktop/.intent-inspector/screenshots/n708w16.webp' },
        ],
        intent: 'please keep working on this button',
    }, '/tmp/project/apps/desktop/.intent-inspector/requests/request.md', {
        projectRoot: '/tmp/project',
    });

    assert.equal(
        prompt,
        [
            '@apps/desktop/src/Button.jsx #4-8',
            '@/tmp/project/apps/desktop/.intent-inspector/screenshots/n708w16.webp',
            'apps/desktop/.intent-inspector/requests/request.md',
            '',
            'please keep working on this button',
            '',
        ].join('\n'),
    );
});

test('buildGrokBuildPrompt monorepo: relative source + absolute screenshots', () => {
    const prompt = buildGrokBuildPrompt({
        projectRoot: '/tmp/project/apps/desktop',
        selection: { line: 4 },
        source: {
            filePath: '/tmp/project/apps/desktop/src/widgets/SessionRailView.tsx',
            selectedNodeRange: { startLine: 120, endLine: 128 },
        },
        screenshots: [
            { filePath: '/tmp/project/apps/desktop/.intent-inspector/screenshots/hvd1wi3.webp' },
        ],
        intent: '垂直居中都没做到',
    }, {
        projectRoot: '/tmp/project',
    });

    assert.equal(
        prompt,
        [
            '@apps/desktop/src/widgets/SessionRailView.tsx #120-128',
            '@/tmp/project/apps/desktop/.intent-inspector/screenshots/hvd1wi3.webp',
            '',
            '垂直居中都没做到',
            '',
        ].join('\n'),
    );
});

test('buildGrokBuildPrompt artifactPathStyle relative restores monorepo-relative screenshot chips', () => {
    const prompt = buildGrokBuildPrompt({
        projectRoot: '/tmp/project/apps/desktop',
        selection: { line: 4 },
        source: {
            filePath: '/tmp/project/apps/desktop/src/widgets/SessionRailView.tsx',
            selectedNodeRange: { startLine: 120, endLine: 128 },
        },
        screenshots: [
            { filePath: '/tmp/project/apps/desktop/.intent-inspector/screenshots/hvd1wi3.webp' },
        ],
        intent: '垂直居中都没做到',
    }, {
        projectRoot: '/tmp/project',
        artifactPathStyle: 'relative',
    });

    assert.equal(
        prompt,
        [
            '@apps/desktop/src/widgets/SessionRailView.tsx #120-128',
            '@apps/desktop/.intent-inspector/screenshots/hvd1wi3.webp',
            '',
            '垂直居中都没做到',
            '',
        ].join('\n'),
    );
});

test('buildGrokBuildFilePrompt honors pathStyle absolute from agent config', () => {
    const prompt = buildGrokBuildFilePrompt({
        projectRoot: '/tmp/project/apps/desktop',
        selection: { line: 4 },
        source: {
            filePath: '/tmp/project/apps/desktop/src/Button.jsx',
            selectedNodeRange: { startLine: 4, endLine: 8 },
        },
        screenshots: [
            { filePath: '/tmp/project/apps/desktop/.intent-inspector/screenshots/n708w16.webp' },
        ],
        intent: 'please keep working on this button',
    }, '/tmp/project/apps/desktop/.intent-inspector/requests/request.md', {
        pathStyle: 'absolute',
    });

    assert.equal(
        prompt,
        [
            '@/tmp/project/apps/desktop/src/Button.jsx #4-8',
            '@/tmp/project/apps/desktop/.intent-inspector/screenshots/n708w16.webp',
            '/tmp/project/apps/desktop/.intent-inspector/requests/request.md',
            '',
            'please keep working on this button',
            '',
        ].join('\n'),
    );
});

test('buildGrokBuildLauncherScript quotes paths and never embeds the prompt body', () => {
    const script = buildGrokBuildLauncherScript({
        command: `/Users/me/.grok/bin/grok`,
        cwd: `/tmp/it's-project`,
        promptPath: `/tmp/it's-project/.intent-inspector/launches/a.prompt.txt`,
        permissionMode: 'plan',
    });

    assert.match(script, /^#!\/bin\/bash\n/);
    assert.match(script, /cd '\/tmp\/it'\\''s-project' \|\| exit 1/);
    assert.match(
        script,
        /exec '\/Users\/me\/\.grok\/bin\/grok' --cwd '\/tmp\/it'\\''s-project' --permission-mode 'plan' --verbatim "\$\(cat '\/tmp\/it'\\''s-project\/\.intent-inspector\/launches\/a\.prompt\.txt'\)"/,
    );
    assert.equal(script.includes('please fix'), false);
});

test('powershellSingleQuote doubles embedded single quotes', () => {
    assert.equal(powershellSingleQuote(`C:\\proj`), `'C:\\proj'`);
    assert.equal(powershellSingleQuote(`it's`), `'it''s'`);
});

test('grokBuildLauncherExtension is .cmd on Windows and .command elsewhere', () => {
    assert.equal(grokBuildLauncherExtension('win32'), '.cmd');
    assert.equal(grokBuildLauncherExtension('darwin'), '.command');
    assert.equal(grokBuildLauncherExtension('linux'), '.command');
});

test('buildGrokBuildWindowsLauncherScript encodes paths and never embeds the prompt body', () => {
    const script = buildGrokBuildWindowsLauncherScript({
        command: `C:\\Users\\me\\.grok\\bin\\grok`,
        cwd: `C:\\tmp\\it's-project`,
        promptPath: `C:\\tmp\\it's-project\\.intent-inspector\\launches\\a.prompt.txt`,
        permissionMode: 'plan',
    });
    assert.match(script, /^@echo off\r\n/);
    assert.match(script, /powershell\.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand /);
    const encoded = script.match(/-EncodedCommand\s+(\S+)/)?.[1];
    assert.ok(encoded);
    const program = Buffer.from(encoded, 'base64').toString('utf16le');
    assert.equal(
        program,
        [
            `Set-Location -LiteralPath 'C:\\tmp\\it''s-project'`,
            `$prompt = Get-Content -LiteralPath 'C:\\tmp\\it''s-project\\.intent-inspector\\launches\\a.prompt.txt' -Raw -Encoding UTF8`,
            `& 'C:\\Users\\me\\.grok\\bin\\grok' --cwd 'C:\\tmp\\it''s-project' --permission-mode 'plan' --verbatim $prompt`,
        ].join('; '),
    );
    assert.equal(script.includes('please fix'), false);
});

test('buildGrokBuildLauncherFile picks cmd vs bash by platform', () => {
    const input = {
        command: 'grok',
        cwd: '/tmp/p',
        promptPath: '/tmp/p/a.prompt.txt',
    };
    assert.match(buildGrokBuildLauncherFile(input, 'darwin'), /^#!\/bin\/bash\n/);
    assert.match(buildGrokBuildLauncherFile(input, 'win32'), /^@echo off\r\n/);
});
