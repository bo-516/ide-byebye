/**
 * Build `dist/` before `npm test` when the published bundle is missing or older than `src/`.
 *
 * Purpose: demo configs import `../../dist/...`, never TypeScript source. The matrix and the unit
 * suite both load that bundle. Skips the build when `dist/client.js` exists and `dist/index.js` is
 * at least as new as every file under `src/`.
 *
 * Boundary: invokes the package `build` script (clean `tsc` + client bundle). Does not watch.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distIndex = path.join(packageRoot, 'dist', 'index.js');
const distClient = path.join(packageRoot, 'dist', 'client.js');
const srcDir = path.join(packageRoot, 'src');

/**
 * Newest mtime under `dir`, in milliseconds. Missing directories return 0.
 *
 * @param {string} dir Absolute directory.
 * @returns {number} Max `mtimeMs`, or 0 when `dir` does not exist.
 */
function newestMtime(dir) {
    if (!fs.existsSync(dir))
        return 0;
    let max = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory())
            max = Math.max(max, newestMtime(full));
        else if (entry.isFile())
            max = Math.max(max, fs.statSync(full).mtimeMs);
    }
    return max;
}

const missing = !fs.existsSync(distClient) || !fs.existsSync(distIndex);
const stale = !missing && newestMtime(srcDir) > fs.statSync(distIndex).mtimeMs;
if (!missing && !stale)
    process.exit(0);

console.log(`[test] ${missing ? 'dist/client.js missing' : 'src/ is newer than dist/index.js'} — npm run build`);
const build = spawnSync('npm', ['run', 'build'], {
    cwd: packageRoot,
    stdio: 'inherit',
    env: process.env,
});
if ((build.status ?? 1) !== 0)
    process.exit(build.status ?? 1);
if (!fs.existsSync(distClient)) {
    console.error('[test] build finished but dist/client.js is still missing');
    process.exit(1);
}
