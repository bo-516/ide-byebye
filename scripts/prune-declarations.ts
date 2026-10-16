import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST_DIR = path.join(ROOT_DIR, 'dist');

/**
 * Relative module specifiers inside an emitted `.d.ts`.
 *
 * Boundary: covers the forms tsc emits for declarations — `import … from`, `export … from`, side-effect `import '…'`
 * and inline `import('…')` type queries. Bare specifiers (`node:fs`, `unplugin`) are skipped on purpose: they resolve
 * from the consumer's `node_modules`, not from `dist`. A reference form missing here would prune a file that a public
 * declaration still needs, so `findReachableDeclarations` throws on any specifier it cannot map to a file.
 *
 * @type {RegExp} Global pattern; capture group 1 is the `./` or `../` specifier.
 */
const RELATIVE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;

/**
 * Read the declaration entry points that `package.json` `exports` publishes.
 *
 * Boundary: every export condition must name a `types` file under `dist`. A subpath without one would leave its
 * declarations unreachable and pruned, so it throws instead of guessing.
 *
 * @returns {Promise<string[]>} Absolute paths of the exported `.d.ts` files.
 */
async function readExportedDeclarations() {
    const pkg = JSON.parse(await fs.readFile(path.join(ROOT_DIR, 'package.json'), 'utf8')) as {
        exports: Record<string, { types?: string }>;
    };
    return Object.entries(pkg.exports).map(([subpath, conditions]) => {
        if (!conditions.types) {
            throw new Error(`package.json exports["${subpath}"] has no "types" entry`);
        }
        return path.join(ROOT_DIR, conditions.types);
    });
}

/**
 * Walk the declaration graph from the exported entry points.
 *
 * Purpose: tsc emits a `.d.ts` for every server module, but consumers only ever load the ones the public entries
 * reference. The rest only weigh down the npm tarball.
 *
 * Boundary: a `.js` specifier maps to its sibling `.d.ts`; any other relative specifier must exist as written. A
 * specifier that resolves to no file throws, so a missed reference form fails the build instead of shipping broken
 * types.
 *
 * @param {string[]} entries Absolute paths of the exported `.d.ts` files.
 * @returns {Promise<Set<string>>} Absolute paths of every declaration reachable from `entries`.
 */
async function findReachableDeclarations(entries: string[]) {
    const reachable = new Set<string>();
    const pending = [...entries];
    for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
        if (reachable.has(file)) {
            continue;
        }
        reachable.add(file);
        const source = await fs.readFile(file, 'utf8');
        for (const match of source.matchAll(RELATIVE_SPECIFIER)) {
            const target = path.resolve(path.dirname(file), match[1].replace(/\.js$/, '.d.ts'));
            try {
                await fs.access(target);
            }
            catch {
                throw new Error(`${path.relative(ROOT_DIR, file)} references ${match[1]}, but ${path.relative(ROOT_DIR, target)} does not exist`);
            }
            pending.push(target);
        }
    }
    return reachable;
}

/**
 * Delete every `dist/**\/*.d.ts` that no exported declaration reaches.
 *
 * Boundary: runs after `tsc` in `npm run build` and only touches `.d.ts` files under `dist`; JavaScript output is left
 * alone because loaders such as `stamp-loader.js` are loaded by path, not through imports.
 *
 * @returns {Promise<void>} Resolves after the unreachable declarations are removed.
 */
async function pruneDeclarations() {
    const reachable = await findReachableDeclarations(await readExportedDeclarations());
    const emitted = (await fs.readdir(DIST_DIR, { recursive: true })).filter((relative) => relative.endsWith('.d.ts'));
    let removedFiles = 0;
    let removedBytes = 0;
    for (const relative of emitted) {
        const file = path.join(DIST_DIR, relative);
        if (reachable.has(file)) {
            continue;
        }
        removedBytes += (await fs.stat(file)).size;
        await fs.unlink(file);
        removedFiles += 1;
    }
    console.log(`Pruned ${removedFiles} internal .d.ts files (${Math.round(removedBytes / 1024)} KB); kept ${reachable.size}`);
}

await pruneDeclarations();
