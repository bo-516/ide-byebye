import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Multi-app / multi-bundler demo launcher.
 *
 * Usage:
 *   node dev.mjs                         → react + vite   (default)
 *   node dev.mjs --app vue               → vue + vite
 *   node dev.mjs --bundler webpack       → react + webpack
 *   node dev.mjs --app vue --bundler webpack
 *   node dev.mjs --app react --bundler rspack
 *
 * Shorthand flags: --react / --vue / --vite / --webpack / --rspack
 *
 * Before starting any bundler, ensures the parent package has `dist/client.js`
 * (source-tree demos load the plugin from `../../dist/index.js`, which serves that file).
 */
const dir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(dir, '..');
const clientBundlePath = path.join(packageRoot, 'dist', 'client.js');
const args = process.argv.slice(2);

function flagValue(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  return args[idx + 1] && !args[idx + 1].startsWith('--') ? args[idx + 1] : true;
}

const app =
  (flagValue('--app') === true ? null : flagValue('--app')) ||
  (args.includes('--vue') ? 'vue' : null) ||
  (args.includes('--react') ? 'react' : null) ||
  'react';

const bundler =
  (flagValue('--bundler') === true ? null : flagValue('--bundler')) ||
  (args.includes('--webpack') ? 'webpack' : null) ||
  (args.includes('--rspack') ? 'rspack' : null) ||
  (args.includes('--vite') ? 'vite' : null) ||
  'vite';

if (!['react', 'vue'].includes(app)) {
  console.error(`[demo] unknown app "${app}". Use react | vue.`);
  process.exit(1);
}
if (!['vite', 'webpack', 'rspack'].includes(bundler)) {
  console.error(`[demo] unknown bundler "${bundler}". Use vite | webpack | rspack.`);
  process.exit(1);
}
if (app === 'vue' && bundler === 'rspack') {
  console.error('[demo] vue + rspack is not wired yet — try --app vue --bundler vite|webpack.');
  process.exit(1);
}

const appDir = path.join(dir, app);
const bin = (name) => path.join(dir, 'node_modules', '.bin', name);

/** @type {[string, string[]]} */
let cmdArgs;
if (bundler === 'vite') {
  cmdArgs = [bin('vite'), ['--config', path.join(appDir, 'vite.config.js')]];
}
else if (bundler === 'webpack') {
  cmdArgs = [bin('webpack'), ['serve', '--mode', 'development', '--config', path.join(appDir, 'webpack.config.mjs')]];
}
else {
  // rspack
  cmdArgs = [bin('rspack'), ['serve', '--mode', 'development', '--config', path.join(appDir, 'rspack.config.mjs')]];
}

/**
 * Source-tree demos import `../../dist/index.js`, which serves the browser runtime from
 * `dist/client.js`. Without that artifact the inspector injects a no-op warn stub.
 *
 * Boundary: only builds when the file is missing (or empty). Does not rebuild on every
 * demo start — run `npm run build` in the package root after client source changes.
 */
function ensureClientBundle() {
  let needsBuild = true;
  try {
    needsBuild = !fs.existsSync(clientBundlePath) || fs.statSync(clientBundlePath).size === 0;
  }
  catch {
    needsBuild = true;
  }
  if (!needsBuild) {
    return;
  }

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

const child = spawn(cmdArgs[0], cmdArgs[1], {
  stdio: 'inherit',
  cwd: appDir,
  env: { ...process.env },
});
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error(`[demo] failed to launch ${app}/${bundler}:`, err.message);
  process.exit(1);
});
