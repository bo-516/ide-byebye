import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
    antigravityAppCandidates,
    antigravityNavigateExpression,
    antigravityUserDataDir,
    buildAntigravityComposerUrl,
    parseDevToolsActivePort,
    resolveAntigravityApp,
    selectAntigravityPage,
} from './antigravity-app.js';

test('antigravityUserDataDir and app candidates follow the platform', () => {
    assert.equal(
        antigravityUserDataDir('darwin', '/Users/me'),
        path.join('/Users/me', 'Library', 'Application Support', 'Antigravity'),
    );
    assert.deepEqual(antigravityAppCandidates('darwin', '/Users/me'), [
        '/Applications/Antigravity.app',
        path.join('/Users/me', 'Applications', 'Antigravity.app'),
    ]);
    assert.equal(
        resolveAntigravityApp('darwin', '/Users/me', {}, (file) => file.endsWith('Antigravity.app') && file.startsWith('/Applications')),
        '/Applications/Antigravity.app',
    );
    assert.equal(resolveAntigravityApp('linux', '/home/me', {}, () => false), null);
});

test('parseDevToolsActivePort reads the port and ignores a blank file', () => {
    assert.deepEqual(parseDevToolsActivePort('62579\n/devtools/browser/abc\n'), {
        port: 62579,
        browserPath: '/devtools/browser/abc',
    });
    assert.equal(parseDevToolsActivePort(''), null);
    assert.equal(parseDevToolsActivePort('nope'), null);
});

test('buildAntigravityComposerUrl stays on the app origin and carries the prompt', () => {
    const url = buildAntigravityComposerUrl(
        'https://127.0.0.1:62594/conversations/1',
        'Make the button primary',
        '/tmp/proj',
    );
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://127.0.0.1:62594');
    assert.equal(parsed.pathname, '/');
    assert.equal(parsed.searchParams.get('q'), 'Make the button primary');
    assert.equal(parsed.searchParams.get('ws'), 'file:///tmp/proj');
    assert.throws(() => buildAntigravityComposerUrl('https://evil.example/', 'x', '/tmp'));
});

test('selectAntigravityPage keeps only the loopback composer page', () => {
    const page = selectAntigravityPage([
        { type: 'page', url: 'devtools://devtools/bundled/inspector.html', webSocketDebuggerUrl: 'ws://bad' },
        { type: 'page', url: 'https://127.0.0.1:62594/', webSocketDebuggerUrl: 'ws://127.0.0.1:62579/devtools/page/1' },
    ]);
    assert.equal(page?.webSocketDebuggerUrl, 'ws://127.0.0.1:62579/devtools/page/1');
    assert.equal(selectAntigravityPage([{ type: 'page', url: 'https://example.com', webSocketDebuggerUrl: 'ws://x' }]), null);
});

test('antigravityNavigateExpression embeds the URL as a JavaScript string', () => {
    const expression = antigravityNavigateExpression('https://127.0.0.1:1/?q="hi"');
    assert.equal(expression, 'location.href = "https://127.0.0.1:1/?q=\\"hi\\""');
});
