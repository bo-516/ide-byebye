/**
 * Angular CLI integration: a dev-server proxy configuration that hosts the inspector.
 *
 * Purpose: the Angular CLI builders expose no bundler plugins or HTML hooks, but `ng serve` loads a JS `proxyConfig`
 * module inside the dev-server process. Awaiting {@link angularProxy} there starts the loopback inspector and proxies
 * `/__intent-inspector/*` to it, so the page (and the generated bootstrap script from the `scripts` option) talks to
 * it same-origin. Element mapping needs no build transform: Angular dev mode reports each element's component.
 *
 * Boundary: only `ng serve` loads proxy configs, so production builds are untouched. One runtime per workspace root per
 * process; the runtime enables the same-origin `/session` route that hands the page its config.
 */

import path from 'node:path';
import { ROUTE_PREFIX } from '../../shared/constants.js';
import type { AngularIdeByebyeOptions } from '../../types.js';
import { createInspectorRuntime } from '../plugin-runtime.js';

/** Registry slot on `globalThis`, shared by every copy of this module loaded in the process. */
const REGISTRY_KEY = Symbol.for('ide-byebye.angular.runtimes');

/**
 * Get (or create) the inspector runtime for an Angular workspace root.
 *
 * @param {string} root Absolute workspace root.
 * @param {AngularIdeByebyeOptions} options Plugin options; only the first call per root is honored.
 * @returns {ReturnType<typeof createInspectorRuntime>} Shared runtime.
 */
function angularRuntime(root: string, options: AngularIdeByebyeOptions) {
    const registry: Map<string, ReturnType<typeof createInspectorRuntime>> = (globalThis as any)[REGISTRY_KEY] ??= new Map();
    if (!registry.has(root)) {
        const runtime = createInspectorRuntime(options, { exposeSession: true });
        runtime.initPaths(root);
        registry.set(root, runtime);
    }
    return registry.get(root);
}

/**
 * Start the inspector and return the `proxyConfig` entries that route to it.
 *
 * @param {AngularIdeByebyeOptions} [options] ide-byebye options; `root` defaults to `process.cwd()` (where `ng serve`
 *   runs, i.e. the workspace with `angular.json`). `enabled: false` returns `{}` and starts nothing.
 * @returns {Promise<Record<string, { target: string, secure: boolean }>>} Proxy entries; spread them next to your own:
 *   `export default { ...(await angularProxy()), '/api': { target: 'http://localhost:3000' } }`.
 */
export async function angularProxy(options: AngularIdeByebyeOptions = {}) {
    if (options.enabled === false)
        return {};
    const runtime = angularRuntime(path.resolve(options.root ?? process.cwd()), options);
    const { origin } = await runtime.ensureServer();
    return { [ROUTE_PREFIX]: { target: origin, secure: false } };
}
