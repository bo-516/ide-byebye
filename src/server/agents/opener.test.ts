import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildOpenerArgv,
    defaultOpenerForPlatform,
    isCmdExe,
    quoteWindowsCmdArg,
    resolveOpener,
    spawnOpener,
} from './opener.js';

test('defaultOpenerForPlatform covers macOS, Windows, and Linux', () => {
    assert.deepEqual(defaultOpenerForPlatform('darwin'), { command: 'open', argsPrefix: [] });
    assert.deepEqual(defaultOpenerForPlatform('win32'), { command: 'cmd', argsPrefix: ['/c', 'start', '""'] });
    assert.deepEqual(defaultOpenerForPlatform('linux'), { command: 'xdg-open', argsPrefix: [] });
    assert.deepEqual(defaultOpenerForPlatform('freebsd'), { command: 'xdg-open', argsPrefix: [] });
});

test('resolveOpener uses platform defaults when openCommand is omitted or blank', () => {
    assert.deepEqual(resolveOpener({}, 'win32'), { command: 'cmd', argsPrefix: ['/c', 'start', '""'] });
    assert.deepEqual(resolveOpener({ openCommand: '  ' }, 'linux'), { command: 'xdg-open', argsPrefix: [] });
    assert.deepEqual(resolveOpener({}, 'darwin'), { command: 'open', argsPrefix: [] });
});

test('resolveOpener lets a custom openCommand replace the platform default', () => {
    assert.deepEqual(
        resolveOpener({ openCommand: 'cmd', openArgs: ['/c', 'start', '""'] }, 'linux'),
        { command: 'cmd', argsPrefix: ['/c', 'start', '""'] },
    );
    assert.deepEqual(
        resolveOpener({ openCommand: 'xdg-open' }, 'win32'),
        { command: 'xdg-open', argsPrefix: [] },
    );
});

test('resolveOpener appends openArgs after the platform prefix when openCommand is omitted', () => {
    assert.deepEqual(
        resolveOpener({ openArgs: ['-a', 'Safari'] }, 'darwin'),
        { command: 'open', argsPrefix: ['-a', 'Safari'] },
    );
    assert.deepEqual(
        resolveOpener({ openArgs: ['--'] }, 'win32'),
        { command: 'cmd', argsPrefix: ['/c', 'start', '""', '--'] },
    );
});

test('quoteWindowsCmdArg wraps tokens and doubles embedded quotes', () => {
    assert.equal(quoteWindowsCmdArg('cursor://x?a=1&b=2'), '"cursor://x?a=1&b=2"');
    assert.equal(quoteWindowsCmdArg('a"b'), '"a""b"');
});

test('isCmdExe matches cmd basename including .exe and absolute paths', () => {
    assert.equal(isCmdExe('cmd'), true);
    assert.equal(isCmdExe('CMD.EXE'), true);
    assert.equal(isCmdExe('C:\\Windows\\System32\\cmd.exe'), true);
    assert.equal(isCmdExe('xdg-open'), false);
});

test('buildOpenerArgv quotes the target only for cmd.exe on Windows', () => {
    const url = 'cursor://anysphere.cursor-deeplink/prompt?text=a&workspace=app';
    assert.deepEqual(
        buildOpenerArgv(defaultOpenerForPlatform('win32'), url, 'win32'),
        ['/c', 'start', '""', `"${url}"`],
    );
    assert.deepEqual(
        buildOpenerArgv(defaultOpenerForPlatform('darwin'), url, 'darwin'),
        [url],
    );
    assert.deepEqual(
        buildOpenerArgv({ command: 'xdg-open', argsPrefix: [] }, url, 'win32'),
        [url],
    );
});

test('spawnOpener resolves on exit 0 and rejects on non-zero or missing binary', async () => {
    await spawnOpener(process.execPath, ['-e', 'process.exit(0)']);
    await assert.rejects(
        () => spawnOpener(process.execPath, ['-e', 'process.exit(2)']),
        /exit code 2/,
    );
    await assert.rejects(
        () => spawnOpener('ide-byebye-missing-opener-bin', []),
        /ENOENT/,
    );
});
