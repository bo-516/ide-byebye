import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
    antigravityAppCandidates,
    buildAntigravityDeepLink,
    resolveAntigravityApp,
} from './antigravity-app.js';

test('app candidates follow the platform', () => {
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

test('buildAntigravityDeepLink carries the prompt and the project on the open route', () => {
    const url = new URL(buildAntigravityDeepLink({
        prompt: '@src/App.vue #12\nMake it 100% & primary',
        projectId: ' ce4ea324-94f2-4abf-b32f-aeb9b3a908c7 ',
    }));
    // The app accepts the empty host or `open`; anything else is routed elsewhere.
    assert.equal(url.protocol, 'antigravity:');
    assert.equal(url.hostname, 'open');
    assert.equal(url.searchParams.get('prompt'), '@src/App.vue #12\nMake it 100% & primary');
    assert.equal(url.searchParams.get('project'), 'ce4ea324-94f2-4abf-b32f-aeb9b3a908c7');
    // `+` would decode as a space through URLSearchParams, so spaces must be %20.
    assert.equal(buildAntigravityDeepLink({ prompt: 'a b+c' }), 'antigravity://open?prompt=a%20b%2Bc');
    assert.equal(new URL(buildAntigravityDeepLink({ prompt: 'a b+c' })).searchParams.get('prompt'), 'a b+c');
});

test('buildAntigravityDeepLink leaves out a blank project', () => {
    assert.equal(buildAntigravityDeepLink({ prompt: 'hi', projectId: '  ' }), 'antigravity://open?prompt=hi');
    assert.equal(buildAntigravityDeepLink({ prompt: 'hi' }), 'antigravity://open?prompt=hi');
});
