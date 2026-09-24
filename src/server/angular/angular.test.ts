/**
 * Angular CLI integration: proxy config, the token-issuing `/session` route's guards, and the generated bootstrap.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { CLIENT_CONFIG_GLOBAL, ENDPOINTS } from '../../shared/constants.js';
import { createInspectorRuntime } from '../plugin-runtime.js';
import { buildAngularBootstrapScript } from './bootstrap-script.js';
import { angularProxy } from './proxy.js';

/**
 * GET the session route of a running runtime with explicit headers.
 *
 * @param {string} origin Server origin.
 * @param {Record<string, string>} headers Request headers (`host` overrides the Host header).
 * @returns {Promise<{ status: number, body: any, headers: Record<string, unknown> }>} Response summary (JSON bodies parsed).
 */
async function getSession(origin: string, headers: Record<string, string>) {
    const { request } = await import('node:http');
    const url = new URL(`${origin}${ENDPOINTS.session}`);
    return new Promise<{ status: number, body: any, headers: Record<string, unknown> }>((resolve, reject) => {
        const req = request({ hostname: url.hostname, port: url.port, path: url.pathname, headers }, (res) => {
            let text = '';
            res.on('data', (chunk) => (text += chunk));
            res.on('end', () => {
                let body: any = text;
                try {
                    body = text ? JSON.parse(text) : null;
                }
                catch {
                    // plain-text fallthrough responses (404) stay as text
                }
                resolve({ status: res.statusCode, body, headers: res.headers });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

test('angularProxy returns a proxy entry for the inspector routes; enabled:false starts nothing', async () => {
    assert.deepEqual(await angularProxy({ enabled: false }), {});
    const proxy = await angularProxy({ root: process.cwd() });
    const entry = proxy['/__intent-inspector'];
    assert.match(entry.target, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(entry.secure, false);
});

test('/session serves same-origin local pages only, as non-executable JSON with a relative client URL', async () => {
    const runtime = createInspectorRuntime({}, { exposeSession: true });
    const { origin } = await runtime.ensureServer();
    const ok = await getSession(origin, { host: 'localhost:4200', 'sec-fetch-site': 'same-origin' });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers['x-content-type-options'], 'nosniff');
    assert.equal(ok.body.config.apiOrigin, '', 'endpoints stay relative (through the dev-server proxy)');
    assert.match(ok.body.clientSrc, /^\/__intent-inspector\/client\.js\?token=[\w-]+$/);
    assert.equal(typeof ok.body.config.token, 'string');

    assert.equal((await getSession(origin, { host: 'localhost:4200', 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await getSession(origin, { host: 'localhost:4200', 'sec-fetch-site': 'same-site' })).status, 403);
    assert.equal((await getSession(origin, { host: 'evil.example:4200', 'sec-fetch-site': 'same-origin' })).status, 403, 'DNS rebinding');
    assert.equal((await getSession(origin, { host: 'localhost:4200', origin: 'http://evil.example' })).status, 403, 'no fetch metadata, foreign Origin');
});

test('/session does not exist on runtimes created by the bundler adapters', async () => {
    const runtime = createInspectorRuntime({});
    const { origin } = await runtime.ensureServer();
    const res = await getSession(origin, { host: 'localhost:4200', 'sec-fetch-site': 'same-origin' });
    assert.equal(res.status, 404);
});

/**
 * Run the generated bootstrap in a browser-like sandbox.
 *
 * @param {(url: string) => Promise<any>} fetchImpl Fake fetch.
 * @param {Record<string, unknown>} [windowProps] Initial window properties.
 * @returns {Promise<{ context: vm.Context, appended: string[], warnings: string[] }>} Sandbox state after it settles.
 */
async function runBootstrap(fetchImpl, windowProps = {}) {
    const appended = [];
    const warnings = [];
    const head = { appendChild: (node) => appended.push(node.src) };
    const window: Record<string, unknown> = { ...windowProps };
    Object.assign(window, {
        window,
        fetch: fetchImpl,
        document: { head, documentElement: head, createElement: () => ({}) },
        console: { warn: (msg) => warnings.push(msg) },
    });
    const context = vm.createContext(window);
    vm.runInContext(buildAngularBootstrapScript(), context);
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { context, appended, warnings };
}

/** Fake `fetch` response. */
const response = (ok: boolean, type: string, body: unknown) => Promise.resolve({
    ok,
    headers: { get: () => type },
    json: () => Promise.resolve(body),
});

test('generated bootstrap publishes the session config and loads the client once', async () => {
    const session = { config: { token: 't' }, clientSrc: '/__intent-inspector/client.js?token=t' };
    const { context, appended, warnings } = await runBootstrap(() => response(true, 'application/json; charset=utf-8', session));
    assert.deepEqual(context[CLIENT_CONFIG_GLOBAL], { token: 't' });
    assert.deepEqual(appended, ['/__intent-inspector/client.js?token=t']);
    assert.deepEqual(warnings, []);
});

test('generated bootstrap is inert without the proxy (HTML fallback) and when already configured', async () => {
    const missing = await runBootstrap(() => response(true, 'text/html', null));
    assert.equal(missing.context[CLIENT_CONFIG_GLOBAL], undefined);
    assert.equal(missing.warnings.length, 1);
    let called = false;
    const configured = await runBootstrap(() => { called = true; return response(true, 'application/json', {}); }, { [CLIENT_CONFIG_GLOBAL]: { token: 'x' } });
    assert.equal(called, false);
    assert.deepEqual(configured.appended, []);
});
