/**
 * Element-table parity between the built-in JSX stamper and code-inspector 1.6.2.
 *
 * Purpose: local gate for the novel/src corpus. Prints
 * `files N | elements N (static N, propagated N) | mismatches N`.
 * `--oracle-only` counts the oracle and does not run the built-in stamper.
 *
 * Boundary: reads the directory you pass (default: sibling `novel/src` is not assumed).
 * `transformCode` skips files that are not on disk, so paths must be real.
 * Run: `node --import tsx scripts/stamp-parity.ts /path/to/src`
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { elementTable } from '../src/server/stamp/element-table.js';
import { stampJsx } from '../src/server/stamp/stamp-jsx.js';
import { applyInsertions } from '../src/server/stamp/stamp-edits.js';

const requireFromPlugin = createRequire(createRequire(import.meta.url).resolve('code-inspector-plugin'));
const { transformCode } = requireFromPlugin('@code-inspector/core');

const args = process.argv.slice(2).filter((arg) => arg !== '--oracle-only');
const oracleOnly = process.argv.includes('--oracle-only');
const root = path.resolve(args[0] ?? '');

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

const files = walk(root);
let elements = 0;
let propagated = 0;
let statics = 0;
let mismatches = 0;
const samples: string[] = [];

for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    const oracle = await transformCode({
        content: code,
        filePath: file,
        fileType: 'jsx',
        escapeTags: [],
        pathType: 'absolute',
    });
    const left = elementTable(oracle);
    elements += left.size;
    for (const entry of left.values()) {
        if (entry.kind === 'propagated')
            propagated += 1;
        else
            statics += 1;
    }
    if (oracleOnly)
        continue;
    const edits = stampJsx({ code, file, lang: 'tsx' });
    const ours = edits ? applyInsertions(code, edits) : code;
    const right = elementTable(ours);
    const keys = new Set([...left.keys(), ...right.keys()]);
    for (const key of keys) {
        const a = left.get(key);
        const b = right.get(key);
        if (!a || !b || a.kind !== b.kind || a.value !== b.value) {
            mismatches += 1;
            if (samples.length < 20)
                samples.push(`${path.relative(root, file)} ${key} oracle=${a?.kind ?? '-'} ours=${b?.kind ?? '-'}`);
        }
    }
}

console.log(`files ${files.length} | elements ${elements} (static ${statics}, propagated ${propagated}) | mismatches ${mismatches} | accepted divergences 0`);
if (samples.length)
    console.log(samples.join('\n'));
if (mismatches > 0)
    process.exitCode = 1;
