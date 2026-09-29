/**
 * Farm 1.7 HTML resources keep the document in `bytes`. The dev server body is a separate shape.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installFarmDevInjection, readFarmDevBody, readFarmHtml, writeFarmHtml } from './html-injection.js';

test('readFarmHtml decodes Farm 1.7 bytes and writeFarmHtml stores them back', () => {
    const resource = { name: 'index.html', bytes: [...Buffer.from('<head></head>')], emitted: false };
    assert.equal(readFarmHtml(resource), '<head></head>');
    const next = writeFarmHtml(resource, '<head><script></script></head>');
    assert.equal(next, resource);
    assert.equal(Buffer.from(resource.bytes).toString('utf8'), '<head><script></script></head>');
});

test('readFarmHtml ignores string and html/code resources', () => {
    assert.equal(readFarmHtml('<p>'), '');
    assert.equal(readFarmHtml({ html: '<p>' }), '');
    assert.equal(readFarmHtml({ code: '<p>' }), '');
    assert.equal(writeFarmHtml('<p>', '<div>'), '<p>');
    assert.equal(readFarmHtml({ bytes: [] }), '');
});

test('readFarmDevBody accepts the Koa response shapes', () => {
    assert.equal(readFarmDevBody('<p>'), '<p>');
    assert.equal(readFarmDevBody(Buffer.from('<p>')), '<p>');
    assert.equal(readFarmDevBody(Uint8Array.from(Buffer.from('<p>'))), '<p>');
    assert.equal(readFarmDevBody({ bytes: [60] }), '');
});

test('installFarmDevInjection unshifts and rewrites an HTML body', async () => {
    const app = { middleware: [async (_ctx, next) => { await next(); }] };
    installFarmDevInjection(app, async () => '<script id="boot"></script>');
    assert.equal(app.middleware.length, 2);
    const ctx = { type: 'html', path: '/', body: '<head></head>' };
    await app.middleware[0](ctx, async () => {});
    assert.match(ctx.body, /<script id="boot">/);
    assert.match(ctx.body, /<\/head>/);
});

test('installFarmDevInjection does not append when middleware is not an array', () => {
    let used = false;
    const app = { middleware: null, use() { used = true; } };
    installFarmDevInjection(app, async () => '<script></script>');
    assert.equal(used, false);
});
