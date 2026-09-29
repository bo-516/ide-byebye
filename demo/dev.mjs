import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandBin, demos, launchArgs } from './catalog.mjs';

/**
 * Multi-app / multi-bundler demo launcher.
 *
 * Usage:
 *   node dev.mjs                         → react + vite   (default)
 *   node dev.mjs --app vue               → vue + vite
 *   node dev.mjs --app next --bundler webpack
 *
 * Shorthand: `--<app>` for an app name in `catalog.mjs`, and `--vite` / `--webpack` / `--rspack`.
 * The default bundler is the first catalog row for that app.
 *
 * Human launches do not set `PORT`. Env rows keep the port in the tool config.
 * Argv rows pass `humanPort` from the catalog. `DEMO_OPEN` is left unset, so the
 * React and Vue Vite configs still open a browser.
 *
 * Before starting, ensures the parent package has `dist/client.js`.
 */
const dir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(dir, '..');
const clientBundlePath = path.join(packageRoot, 'dist', 'client.js');
const args = process.argv.slice(2);

/**
 * Value of a `--name value` flag. `true` when the flag is present without a value.
 *
 * @param {string} name Flag including the leading dashes.
 * @returns {string | boolean | null} Value, `true`, or null when absent.
 */
function flagValue(name) {
    const idx = args.indexOf(name);
    if (idx === -1)
        return null;
    return args[idx + 1] && !args[idx + 1].startsWith('--') ? args[idx + 1] : true;
}

const apps = [];
for (const row of demos) {
    if (!apps.includes(row.app))
        apps.push(row.app);
}

const app = (typeof flagValue('--app') === 'string' ? flagValue('--app') : null)
    || apps.find((name) => args.includes(`--${name}`))
    || 'react';

const bundler = (typeof flagValue('--bundler') === 'string' ? flagValue('--bundler') : null)
    || (args.includes('--webpack') ? 'webpack' : null)
    || (args.includes('--rspack') ? 'rspack' : null)
    || (args.includes('--vite') ? 'vite' : null)
    || demos.find((row) => row.app === app)?.bundler;

const row = demos.find((item) => item.app === app && item.bundler === bundler);
if (!row) {
    if (app === 'vue' && bundler === 'rspack')
        console.error('[demo] vue + rspack is not wired — try --app vue --bundler vite|webpack.');
    else
        console.error(`[demo] unknown app/bundler "${app}/${bundler}".`);
    process.exit(1);
}

const appDir = path.join(dir, row.cwd);
const command = commandBin(dir, row.command);

/**
 * Source-tree demos import `../../dist/index.js`, which serves the browser runtime from
 * `dist/client.js`. Without that artifact the inspector injects a no-op warn stub.
 *
 * Boundary: only builds when the file is missing (or empty). Does not rebuild on every
 * demo start — run `npm run build` in the package root after client source changes.
 *
 * @returns {void} Exits the process when the build fails.
 */
function ensureClientBundle() {
    let needsBuild = true;
    try {
        needsBuild = !fs.existsSync(clientBundlePath) || fs.statSync(clientBundlePath).size === 0;
    }
    catch {
        needsBuild = true;
    }
    if (!needsBuild)
        return;

    console.log('[demo] dist/client.js missing — building package (npm run build)…');
    const result = spawnSync('npm', ['run', 'build'], {
        cwd: packageRoot,
        stdio: 'inherit',
        env: process.env,
        shell: process.platform === 'win32',
    });
    if (result.status !== 0) {
        console.error('[demo] package build failed; the inspector client will not load.');
        process.exit(result.status ?? 1);
    }
    if (!fs.existsSync(clientBundlePath)) {
        console.error(`[demo] build finished but ${clientBundlePath} is still missing.`);
        process.exit(1);
    }
}

ensureClientBundle();

console.log(`[demo] launching ${app} · ${bundler}`);
console.log(`[demo] cwd=${appDir}`);

const child = spawn(command, launchArgs(row, row.humanPort), {
    stdio: 'inherit',
    cwd: appDir,
    env: { ...process.env },
});
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
    console.error(`[demo] failed to launch ${app}/${bundler}:`, err.message);
    process.exit(1);
});
