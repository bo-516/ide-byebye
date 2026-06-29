import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertPathInsideRoot } from './security.js';

/**
 * Map of public vendor route names to the npm package that backs each one.
 *
 * Boundary: only names listed here may be served; an unknown name is rejected so the vendor route can never be used to
 * read arbitrary files from the host machine. A package added here must ship a browser-safe, fully self-contained ESM
 * build (no bare/relative imports) because it is served as a single file for a browser `import()`.
 *
 * @type {Record<string, string>} Route name -> npm package specifier.
 */
export const VENDOR_PACKAGES = {
    record: '@rrweb/record',
    replay: '@rrweb/replay',
};

/**
 * Pick the ESM entry path declared by a package manifest.
 *
 * Boundary: prefers the modern `exports['.'].import` condition, then the legacy `module` field, then `main`. A package
 * that only exposes a CommonJS `main` still returns that path; the caller serves it verbatim and relies on the package
 * actually shipping browser ESM. Throws when no entry can be determined so the route fails loudly instead of serving
 * an empty body.
 *
 * @param {Record<string, unknown>} manifest Parsed package.json contents.
 * @returns {string} Package-root-relative path to the ESM entry file.
 */
function pickEsmEntry(manifest) {
    const dot = manifest.exports && typeof manifest.exports === 'object' ? manifest.exports['.'] : undefined;
    const imp = dot && typeof dot === 'object' ? dot.import : undefined;
    if (typeof imp === 'string')
        return imp;
    if (imp && typeof imp === 'object' && typeof imp.default === 'string')
        return imp.default;
    if (typeof manifest.module === 'string')
        return manifest.module;
    if (typeof manifest.main === 'string')
        return manifest.main;
    throw new Error(`Package "${manifest.name}" does not declare an ESM entry`);
}

/**
 * Locate the installed package-root directory for a specifier, resolved from the host project.
 *
 * Boundary: resolution is anchored at `projectRoot` so the host project's own `node_modules` wins over the plugin's.
 * `require.resolve` returns the package's CommonJS/main entry, so this walks up to the directory whose package.json
 * `name` matches `spec`. Throws when the package is not installed so callers can surface an actionable install hint.
 *
 * @param {string} spec npm package specifier, e.g. `@rrweb/record`.
 * @param {string} projectRoot Absolute host Vite project root.
 * @returns {string} Absolute package-root directory containing the matching package.json.
 */
function resolvePackageRoot(spec, projectRoot) {
    const require = createRequire(path.join(projectRoot, 'noop.js'));
    const entry = require.resolve(spec);
    let dir = path.dirname(entry);
    while (dir !== path.dirname(dir)) {
        const manifestPath = path.join(dir, 'package.json');
        if (fs.existsSync(manifestPath)) {
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                if (manifest.name === spec)
                    return dir;
            }
            catch {
                // Keep walking up if a manifest along the way is malformed.
            }
        }
        dir = path.dirname(dir);
    }
    throw new Error(`Could not locate the package root for "${spec}"`);
}

/**
 * Resolve the absolute path of a vendor package's browser ESM bundle, from the host project.
 *
 * Boundary: `name` must be a key of `VENDOR_PACKAGES`; unknown names throw before any filesystem access. The resolved
 * file is asserted to live inside the package directory so a crafted manifest cannot redirect the route at unrelated
 * files. A missing package throws with an `npm i <spec>` hint so the recording feature degrades to a clear error rather
 * than a generic 500.
 *
 * @param {string} name Public vendor route name (`record` | `replay`).
 * @param {string} projectRoot Absolute host Vite project root used for module resolution.
 * @returns {string} Absolute path to the ESM file to serve to the browser.
 */
export function resolveVendorEsmPath(name, projectRoot) {
    const spec = VENDOR_PACKAGES[name];
    if (!spec) {
        throw new Error(`Unknown vendor module "${name}"`);
    }
    let packageRoot;
    try {
        packageRoot = resolvePackageRoot(spec, projectRoot);
    }
    catch {
        throw new Error(`"${spec}" is not installed in this project. Run: npm i ${spec}`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    const entryFile = path.resolve(packageRoot, pickEsmEntry(manifest));
    assertPathInsideRoot(entryFile, packageRoot);
    return entryFile;
}
