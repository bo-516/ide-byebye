import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
    assertPathInsideRoot,
    isInsideRoot,
    isLocalRequest,
    readToken,
    tokenMatches,
} from './security.js';
import { TOKEN_HEADER } from '../shared/constants.js';

const ROOT = path.resolve('/tmp/project-root');

test('assertPathInsideRoot accepts files under root and returns absolute path', () => {
    const resolved = assertPathInsideRoot('src/App.tsx', ROOT);
    assert.equal(resolved, path.resolve(ROOT, 'src/App.tsx'));
    assert.equal(assertPathInsideRoot('./nested/file.js', ROOT), path.resolve(ROOT, 'nested/file.js'));
});

test('assertPathInsideRoot rejects path traversal and absolute escapes', () => {
    assert.throws(() => assertPathInsideRoot('../secret', ROOT), /outside the Vite project root/);
    assert.throws(() => assertPathInsideRoot('../../etc/passwd', ROOT), /outside/);
    // Empty relative lands on root itself — also rejected (relative === '').
    assert.throws(() => assertPathInsideRoot('.', ROOT), /outside/);
    assert.throws(() => assertPathInsideRoot('', ROOT), /outside/);
});

test('isInsideRoot mirrors assertPathInsideRoot without throwing', () => {
    assert.equal(isInsideRoot('src/ok.js', ROOT), true);
    assert.equal(isInsideRoot('../escape.js', ROOT), false);
    assert.equal(isInsideRoot('.', ROOT), false);
});

test('tokenMatches is length-sensitive and constant-time-ish', () => {
    assert.equal(tokenMatches('abc123', 'abc123'), true);
    assert.equal(tokenMatches('abc123', 'abc124'), false);
    assert.equal(tokenMatches('abc123', 'abc12'), false);
    assert.equal(tokenMatches('abc123', ''), false);
    assert.equal(tokenMatches('abc123', null), false);
    assert.equal(tokenMatches('abc123', undefined), false);
});

test('readToken prefers header then query string', () => {
    assert.equal(
        readToken({ headers: { [TOKEN_HEADER]: 'from-header' }, url: '/x?token=from-query' }),
        'from-header',
    );
    assert.equal(
        readToken({ headers: { [TOKEN_HEADER]: ['first', 'second'] }, url: '/x' }),
        'first',
    );
    assert.equal(
        readToken({ headers: {}, url: '/path?token=query-token&other=1' }),
        'query-token',
    );
    assert.equal(readToken({ headers: {}, url: '/path' }), undefined);
    assert.equal(readToken({ headers: {}, url: undefined }), undefined);
});

test('isLocalRequest allows missing origin/referer and localhost hosts', () => {
    assert.equal(isLocalRequest({ headers: {} }), true);
    assert.equal(isLocalRequest({ headers: { origin: 'http://localhost:5173' } }), true);
    assert.equal(isLocalRequest({ headers: { origin: 'http://127.0.0.1:3000' } }), true);
    assert.equal(isLocalRequest({ headers: { referer: 'http://[::1]/8888/app' } }), true);
    assert.equal(isLocalRequest({ headers: { origin: 'http://app.localhost' } }), true);
    assert.equal(isLocalRequest({ headers: { origin: 'https://evil.example' } }), false);
    assert.equal(isLocalRequest({ headers: { origin: 'not-a-url' } }), false);
});
