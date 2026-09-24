/**
 * JS bootstrap statement: behavior in a browser-like global, on the server, and across token rotation.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { CLIENT_CONFIG_GLOBAL } from '../shared/constants.js';
import { buildBootstrapStatement } from './bootstrap-script.js';
import { isViteClientModule } from './vite-client.js';

/**
 * Minimal browser-like sandbox recording appended scripts.
 *
 * @param {Record<string, unknown>} [windowProps] Initial window properties.
 * @returns {{ context: vm.Context, appended: Array<{ type: string, src: string }> }} Sandbox and script log.
 */
function browser(windowProps = {}) {
    const appended = [];
    const head = { appendChild: (node) => appended.push({ type: node.type, src: node.src }) };
    const window: Record<string, unknown> = { ...windowProps };
    const document = { head, documentElement: head, createElement: () => ({}) };
    window.window = window;
    window.document = document;
    return { context: vm.createContext(window), appended };
}

const statement = (token) => buildBootstrapStatement({
    config: { token, apiOrigin: 'http://127.0.0.1:4000', locale: 'en' },
    clientSrc: `http://127.0.0.1:4000/__intent-inspector/client.js?token=${token}`,
});

test('publishes the config and loads the client once', () => {
    const { context, appended } = browser();
    vm.runInContext(statement('t1'), context);
    vm.runInContext(statement('t1'), context);
    assert.equal(context[CLIENT_CONFIG_GLOBAL].token, 't1');
    assert.deepEqual(appended, [{ type: 'module', src: 'http://127.0.0.1:4000/__intent-inspector/client.js?token=t1' }]);
});

test('no-ops when HTML injection already published the same token', () => {
    const { context, appended } = browser({ [CLIENT_CONFIG_GLOBAL]: { token: 't1', from: 'html' } });
    vm.runInContext(statement('t1'), context);
    assert.equal(context[CLIENT_CONFIG_GLOBAL].from, 'html');
    assert.equal(appended.length, 0);
});

test('a new token rotates the live config in place without reloading a running client', () => {
    const live = { token: 'old', apiOrigin: 'http://127.0.0.1:1' };
    const { context, appended } = browser({ [CLIENT_CONFIG_GLOBAL]: live, __CII_INSTALLED__: true });
    vm.runInContext(statement('new'), context);
    assert.equal(context[CLIENT_CONFIG_GLOBAL], live, 'same object the client holds');
    assert.equal(live.token, 'new');
    assert.equal(live.apiOrigin, 'http://127.0.0.1:4000');
    assert.equal(appended.length, 0);
});

test('is inert on the server (no window / document)', () => {
    const context = vm.createContext({});
    assert.doesNotThrow(() => vm.runInContext(statement('t1'), context));
    assert.equal(context[CLIENT_CONFIG_GLOBAL], undefined);
});

test('isViteClientModule matches only Vite browser client entries', () => {
    assert.ok(isViteClientModule('/app/node_modules/vite/dist/client/client.mjs'));
    assert.ok(isViteClientModule('/app/node_modules/.pnpm/vite@8.2.0/node_modules/vite/dist/client/client.mjs?v=1'));
    assert.ok(isViteClientModule('C:\\app\\node_modules\\rolldown-vite\\dist\\client\\client.mjs'));
    assert.ok(isViteClientModule('/app/node_modules/vite/dist/client/bundledDevClient.mjs'));
    assert.ok(!isViteClientModule('/app/node_modules/vite/dist/client/env.mjs'));
    assert.ok(!isViteClientModule('/app/src/client/client.mjs'));
    assert.ok(!isViteClientModule(undefined));
});
