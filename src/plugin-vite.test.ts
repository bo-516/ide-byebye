/**
 * Vite adapter against a real Vite dev server in middleware mode (how SSR frameworks embed Vite).
 *
 * Purpose: prove both bootstrap paths — `transformIndexHtml` for SPAs and the `/@vite/client` append for frameworks
 * that render their own HTML (Nuxt, SvelteKit, SolidStart, Astro, …).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'vite';
import { CLIENT_CONFIG_GLOBAL } from './shared/constants.js';
import { vite as inspector } from './plugin.js';

test('Vite dev server: /@vite/client carries the JS bootstrap and index.html keeps the tag injection', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-vite-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><head></head><body><div id="app"></div></body></html>');
    const server = await createServer({
        root,
        logLevel: 'silent',
        configFile: false,
        server: { middlewareMode: true, hmr: false, ws: false },
        plugins: [inspector({ agents: { claudeApp: true } })],
    });
    try {
        const client = await server.transformRequest('/@vite/client');
        assert.ok(client?.code.includes(`var key = "${CLIENT_CONFIG_GLOBAL}"`), 'bootstrap appended to @vite/client');
        assert.match(client.code, /script\.src = "http:\/\/127\.0\.0\.1:\d+\/__intent-inspector\/client\.js\?token=/);

        const html = await server.transformIndexHtml('/', fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
        assert.ok(html.includes(`window.${CLIENT_CONFIG_GLOBAL}=`), 'SPA still gets the inline config tag');
        const htmlToken = /"token":"([^"]+)"/.exec(html)?.[1];
        const clientToken = /"token":"([^"]+)"/.exec(client.code)?.[1];
        assert.ok(htmlToken && htmlToken === clientToken, 'same token, so the JS path no-ops on SPA pages');
    }
    finally {
        await server.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});
