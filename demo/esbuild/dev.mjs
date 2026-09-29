/**
 * React + esbuild dev server.
 *
 * Purpose: copy `index.html` into `dist/` and serve that copy. The inspector's `onEnd` rewrites
 * HTML in place, so pointing `htmlFiles` at the copy leaves the source `index.html` free of the
 * bootstrap token (and of the dev token).
 *
 * Boundary: listens on `127.0.0.1`. `PORT` overrides the human default 5840. Does not open a browser.
 * The process stays up until the parent kills the group.
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import inspector from '../../dist/adapters/esbuild.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(dir, 'dist');
const port = Number(process.env.PORT) || 5840;

fs.mkdirSync(dist, { recursive: true });
fs.copyFileSync(path.join(dir, 'index.html'), path.join(dist, 'index.html'));

const ctx = await esbuild.context({
    absWorkingDir: dir,
    entryPoints: ['src/main.jsx'],
    bundle: true,
    format: 'esm',
    jsx: 'automatic',
    outdir: 'dist',
    plugins: inspector({ htmlFiles: ['./dist/index.html'] }),
});

await ctx.serve({
    host: '127.0.0.1',
    port,
    servedir: 'dist',
});
