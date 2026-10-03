import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPosixLauncherScript, buildWindowsLauncherScript } from './launch-script.js';
import {
    buildOpenCodeDeepLink,
    openCodeAppCandidates,
    openCodeLauncherArgs,
    parseOpenCodeBundleMajor,
    pickOpenCodeRoute,
    readOpenCodeLaunch,
    resolveOpenCodeCommandCandidates,
} from './opencode-route.js';

/**
 * XML `Info.plist` head as the desktop bundle ships it.
 *
 * @param {string} version `CFBundleShortVersionString`.
 * @returns {string} Plist text.
 */
function plist(version: string) {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        '  <key>CFBundleIdentifier</key>',
        '  <string>ai.opencode.desktop</string>',
        '  <key>CFBundleShortVersionString</key>',
        `  <string>${version}</string>`,
        '</dict>',
        '</plist>',
    ].join('\n');
}

test('parseOpenCodeBundleMajor reads the XML plist major and gives up on binary plists', () => {
    assert.equal(parseOpenCodeBundleMajor(plist('1.18.34')), 1);
    assert.equal(parseOpenCodeBundleMajor(plist('2.0.6')), 2);
    assert.equal(parseOpenCodeBundleMajor('bplist00\u0000\u0001binary'), null);
    assert.equal(parseOpenCodeBundleMajor(plist('beta')), null);
    assert.equal(parseOpenCodeBundleMajor(''), null);
});

test('auto routes macOS 1.x desktops to the deeplink and everything else to the CLI', () => {
    const auto = (platform: string, desktopMajor: number | null, cliAvailable: boolean) =>
        pickOpenCodeRoute({ launch: 'auto', platform, desktopMajor, cliAvailable });
    assert.deepEqual(auto('darwin', 1, false), { route: 'app' });
    assert.deepEqual(auto('darwin', 1, true), { route: 'app' });
    assert.deepEqual(auto('darwin', 2, true), { route: 'terminal' });
    assert.deepEqual(auto('darwin', null, true), { route: 'terminal' });
    assert.deepEqual(auto('linux', 1, true), { route: 'terminal' });
    assert.deepEqual(auto('win32', null, true), { route: 'terminal' });
    assert.deepEqual(auto('darwin', 2, false), { route: 'unavailable' });
    assert.deepEqual(auto('linux', null, false), { route: 'unavailable' });
});

test('launch app skips detection; launch terminal only uses the CLI', () => {
    assert.deepEqual(pickOpenCodeRoute({ launch: 'app', platform: 'linux', desktopMajor: null, cliAvailable: false }), { route: 'app' });
    assert.deepEqual(pickOpenCodeRoute({ launch: 'terminal', platform: 'darwin', desktopMajor: 1, cliAvailable: true }), { route: 'terminal' });
    assert.deepEqual(pickOpenCodeRoute({ launch: 'terminal', platform: 'darwin', desktopMajor: 1, cliAvailable: false }), { route: 'unavailable' });
    assert.equal(readOpenCodeLaunch('app'), 'app');
    assert.equal(readOpenCodeLaunch('terminal'), 'terminal');
    assert.equal(readOpenCodeLaunch('deeplink'), 'auto');
});

test('the deeplink round-trips + & = # %, newlines and CJK through both decoders (AC-9)', () => {
    const prompt = 'a+b & c=d #e %f\n中文';
    const url = buildOpenCodeDeepLink({ directory: '/Users/me/my shop', prompt });
    assert.ok(url.startsWith('opencode://new-session?directory=%2FUsers%2Fme%2Fmy%20shop&prompt='));
    assert.ok(!url.includes('+'));
    const parsed = new URL(url);
    assert.equal(parsed.hostname, 'new-session');
    assert.equal(parsed.searchParams.get('prompt'), prompt);
    assert.equal(parsed.searchParams.get('directory'), '/Users/me/my shop');
    assert.equal(decodeURIComponent(url.slice(url.indexOf('&prompt=') + 8)), prompt);
});

test('the launcher passes the directory and glues the prompt to --prompt= in bash and PowerShell', () => {
    const input = {
        command: '/Applications/OpenCode.app/Contents/Resources/opencode-cli',
        cwd: '/Users/me/shop',
        promptPath: '/Users/me/shop/.intent-inspector/launches/a.opencode.prompt.txt',
        args: openCodeLauncherArgs('/Users/me/shop'),
    };
    assert.equal(
        buildPosixLauncherScript(input).split('\n')[3],
        `exec '/Applications/OpenCode.app/Contents/Resources/opencode-cli' '/Users/me/shop' --prompt="$(cat '/Users/me/shop/.intent-inspector/launches/a.opencode.prompt.txt')"`,
    );
    const encoded = buildWindowsLauncherScript({ ...input, command: 'opencode.exe', cwd: 'C:\\shop', args: openCodeLauncherArgs('C:\\shop') })
        .match(/-EncodedCommand\s+(\S+)/)?.[1] ?? '';
    assert.match(Buffer.from(encoded, 'base64').toString('utf16le'), /& 'opencode\.exe' 'C:\\shop' "--prompt=\$prompt"$/);
});

test('app and CLI candidates: macOS bundles, the install script, then the CLI inside the app', () => {
    assert.deepEqual(openCodeAppCandidates({}, { platform: 'darwin', homedir: '/Users/me' }), [
        '/Applications/OpenCode.app',
        '/Users/me/Applications/OpenCode.app',
    ]);
    assert.deepEqual(openCodeAppCandidates({ appPath: '/opt/OpenCode.app' }, { platform: 'darwin', homedir: '/Users/me' }), ['/opt/OpenCode.app']);
    assert.deepEqual(openCodeAppCandidates({}, { platform: 'linux', homedir: '/home/me' }), []);
    assert.deepEqual(resolveOpenCodeCommandCandidates({}, { homedir: '/Users/me', appPath: '/Applications/OpenCode.app' }), [
        'opencode',
        '/Users/me/.opencode/bin/opencode',
        '/Applications/OpenCode.app/Contents/Resources/opencode-cli',
    ]);
    assert.deepEqual(resolveOpenCodeCommandCandidates({ command: ' /opt/oc ' }, { homedir: '/Users/me', appPath: null }), ['/opt/oc']);
});
