import { spawn } from 'node:child_process';
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
 */
const dir = path.dirname(fileURLToPath(import.meta.url));
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
