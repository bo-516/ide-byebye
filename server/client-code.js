import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Global key used by the single-file build to stash the browser client bundle.
 *
 * Boundary: the value behind this key must be a non-empty JavaScript string. Missing or non-string values are treated
 * as no embedded bundle, which makes the loader fall back to file-system candidates.
 */
export const EMBEDDED_CLIENT_CODE_GLOBAL = '__CODE_INTENT_INSPECTOR_EMBEDDED_CLIENT_CODE__';

/**
 * Read browser client code embedded by the single-file bundle.
 *
 * Boundary: this helper only accepts a non-empty string from the supplied global-like object. Passing `null`, a
 * primitive, or an object without the expected key returns `null`, causing callers to try disk-based bundles instead.
 *
 * @param {Record<string, unknown> | typeof globalThis | null | undefined} globalObject Global-like object to inspect.
 * @returns {string | null} Embedded browser client JavaScript, or `null` when unavailable.
 */
export function readEmbeddedClientCode(globalObject = globalThis) {
    if (!globalObject || typeof globalObject !== 'object') {
        return null;
    }

    const code = globalObject[EMBEDDED_CLIENT_CODE_GLOBAL];
    return typeof code === 'string' && code.trim() ? code : null;
}

/**
 * Build the ordered disk locations that may contain the browser client bundle.
 *
 * Boundary: `moduleUrl` must be this module's `import.meta.url`, because the relative candidates are calculated from
 * `server/client-code.js`. Passing a URL from another directory can make the loader miss the core `dist/client.js`;
 * passing a bad `cwd` only affects the final host-project `dist/client.js` fallback.
 *
 * @param {string} moduleUrl URL for this module.
 * @param {string} cwd Current working directory used for the final fallback.
 * @returns {string[]} Absolute file paths to probe in order.
 */
function buildClientBundleCandidates(moduleUrl, cwd) {
    return [
        fileURLToPath(new URL('../dist/client.js', moduleUrl)),
        fileURLToPath(new URL('../client.js', moduleUrl)),
        path.resolve(cwd, 'dist/client.js'),
    ];
}

/**
 * Locate browser client code for the Vite middleware.
 *
 * Boundary: single-file builds win through the embedded global; source-tree usage falls back to `dist/client.js`, then
 * the legacy root `client.js`, then the host project's `dist/client.js`. Missing all candidates throws a descriptive
 * error so the plugin can serve a no-op warning script instead of crashing the dev server.
 *
 * @param {{ pluginName?: string, cwd?: string, moduleUrl?: string }} input Loader options. `pluginName` is only used in
 * error messages; `cwd` and `moduleUrl` should usually be omitted.
 * @returns {string} Browser client JavaScript to serve from `/__intent-inspector/client.js`.
 */
export function loadClientCode({ pluginName = 'vite-plugin-code-intent-inspector', cwd = process.cwd(), moduleUrl = import.meta.url } = {}) {
    const embedded = readEmbeddedClientCode();
    if (embedded) {
        return embedded;
    }

    const candidates = buildClientBundleCandidates(moduleUrl, cwd);
    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) {
                return fs.readFileSync(candidate, 'utf8');
            }
        }
        catch {
            // try next
        }
    }

    throw new Error(`[${pluginName}] Could not find the browser client bundle. ` +
        'Expected core/dist/client.js, legacy core/client.js, host dist/client.js, or an embedded single-file bundle before starting the dev server.');
}
