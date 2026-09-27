import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listCodexSessions } from '../src/server/sessions/codex-sessions.js';

/**
 * Time 20 Codex catalog reads against the real home. Missing home prints a skip line and exits 0.
 *
 * Usage: `node --import tsx scripts/bench-sessions.ts [projectRoot]`
 * Prints one JSON line: `{ samples, p95 }`.
 */
const home = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
if (!fs.existsSync(home)) {
    console.log(JSON.stringify({ skipped: true, reason: 'no codex home', home }));
    process.exit(0);
}
const projectRoot = path.resolve(process.argv[2] ?? process.cwd());
const samples = [];
for (let i = 0; i < 20; i += 1) {
    const started = Date.now();
    listCodexSessions({ projectRoot, config: {} });
    samples.push(Date.now() - started);
}
samples.sort((a, b) => a - b);
const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
console.log(JSON.stringify({ home, projectRoot, samples, p95, targetMs: 150 }));
