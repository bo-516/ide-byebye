/**
 * Install `demo/` dependencies before `npm test` when they are missing or older than the lockfile.
 *
 * Purpose: the matrix boots real framework CLIs from `demo/node_modules`. Those packages stay out of the
 * library manifest. A warm install (lockfile not newer than `node_modules/.modules.yaml`) does nothing.
 *
 * Boundary: uses `pnpm install --frozen-lockfile` in `demo/`. `demo/pnpm-workspace.yaml` is the
 * nearest workspace file, so pnpm does not install the library root instead. When an install is
 * required and `pnpm` is not on `PATH`, exits 1 with `npm test requires pnpm to install demo/`
 * and does not fall back to npm.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const demoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'demo');
const modulesYaml = path.join(demoDir, 'node_modules', '.modules.yaml');
const lockfile = path.join(demoDir, 'pnpm-lock.yaml');

/**
 * Whether `demo/node_modules` is absent or the lockfile was touched after the last install.
 *
 * @returns {boolean} `true` when `pnpm install --frozen-lockfile` must run.
 */
function needsInstall() {
    if (!fs.existsSync(path.join(demoDir, 'node_modules')) || !fs.existsSync(modulesYaml))
        return true;
    if (!fs.existsSync(lockfile))
        return true;
    return fs.statSync(lockfile).mtimeMs > fs.statSync(modulesYaml).mtimeMs;
}

if (!needsInstall())
    process.exit(0);

const probe = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
    console.error('npm test requires pnpm to install demo/');
    process.exit(1);
}

console.log('[test] demo/ deps missing or lockfile changed — pnpm install --frozen-lockfile');
const install = spawnSync('pnpm', ['install', '--frozen-lockfile'], {
    cwd: demoDir,
    stdio: 'inherit',
});
process.exit(install.status ?? 1);
