/**
 * Time built-in JSX stamping against code-inspector 1.6.2 on one corpus.
 *
 * Purpose: after one warmup, print both totals, whether raw transfer was on, and the Node version.
 * When raw transfer is on, also compare that output to a normal `parseSync` stamp and print
 * `raw-transfer byte-identical: yes|no`.
 *
 * Boundary: the ratio is measured in this process. Absolute milliseconds from another machine are not the bar.
 * Run: `node --import tsx scripts/bench-stamp.ts /path/to/src`
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { applyInsertions } from '../src/server/stamp/stamp-edits.js';
import { rawTransferEnabled, stampJsx } from '../src/server/stamp/stamp-jsx.js';

const requireFromPlugin = createRequire(createRequire(import.meta.url).resolve('code-inspector-plugin'));
const { transformCode } = requireFromPlugin('@code-inspector/core');

const root = path.resolve(process.argv[2] ?? '');

function walk(dir: string, out: string[] = []) {
    for (const name of fs.readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.'))
            continue;
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory())
            walk(full, out);
        else if (name.endsWith('.tsx'))
            out.push(full);
    }
    return out;
}

const files = walk(root).map((file) => ({ file, code: fs.readFileSync(file, 'utf8') }));
const raw = rawTransferEnabled();

async function timeOracle() {
    const start = performance.now();
    for (const item of files) {
        await transformCode({
            content: item.code,
            filePath: item.file,
            fileType: 'jsx',
            escapeTags: [],
            pathType: 'absolute',
        });
    }
    return performance.now() - start;
}

function stampAll(useRaw: boolean) {
    const start = performance.now();
    const outputs: string[] = [];
    for (const item of files) {
        const edits = stampJsx({ code: item.code, file: item.file, lang: 'tsx', raw: useRaw });
        outputs.push(edits ? applyInsertions(item.code, edits) : item.code);
    }
    return { ms: performance.now() - start, outputs };
}

// Warmup so the first measured pass is not paying for JIT and native init.
await timeOracle();
stampAll(raw);

const oracleMs = await timeOracle();
const builtIn = stampAll(raw);
let identical = true;
if (raw) {
    const plain = stampAll(false);
    identical = builtIn.outputs.every((text, index) => text === plain.outputs[index]);
}

console.log(`node ${process.version}`);
console.log(`raw transfer: ${raw ? 'on' : 'off'}`);
console.log(`code-inspector ${oracleMs.toFixed(1)} ms`);
console.log(`ide-byebye stamp ${builtIn.ms.toFixed(1)} ms`);
console.log(`files ${files.length}`);
if (raw)
    console.log(`raw-transfer byte-identical: ${identical ? 'yes' : 'no'}`);
const limit = raw ? oracleMs / 5 : oracleMs / 3;
if (builtIn.ms > limit || (raw && !identical))
    process.exitCode = 1;
