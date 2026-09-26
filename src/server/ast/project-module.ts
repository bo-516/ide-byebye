/**
 * Load a compiler from the project that owns a source file.
 *
 * Purpose: Vue, pug, and Svelte parsers must be the ones the user's app compiles with, not copies
 * bundled into ide-byebye. pnpm's strict layout hides `@vue/compiler-dom` from the app root when
 * the direct dependency is only `vue`; the `via` hop resolves from that package's directory.
 *
 * Boundary: Node `createRequire` only. A missing module returns `null` and is cached per directory
 * so a Vue 2.7 project does not re-probe every file. Success is cached by the resolved filename.
 * Do not point `fromFile` at a path inside ide-byebye if the caller meant the user's project.
 */

import { createRequire } from 'node:module';
import path from 'node:path';

const modules = new Map<string, unknown>();
const failures = new Set<string>();

/**
 * Drop cached resolutions. Tests build a fake package tree and then resolve again.
 *
 * @returns {void}
 */
export function clearProjectModuleCache(): void {
    modules.clear();
    failures.clear();
}

/**
 * Absolute path of `request` as Node would resolve it from `fromFile`, or `null`.
 *
 * When the direct lookup fails and `via` is set (`'vue'` or `'pug'`), resolution retries from
 * `via/package.json`'s directory. That is the pnpm case: the app depends on `vue`, and
 * `@vue/compiler-dom` is nested under `vue`.
 *
 * @param {string} fromFile Absolute file the import should be resolved against. The file need not exist.
 * @param {string} request Package or subpath (`'@vue/compiler-dom'`, `'svelte/compiler'`).
 * @param {string} [via] Host package name whose install directory is a second resolution root.
 * @returns {string | null} Resolved filename, or `null` when both lookups fail.
 */
export function resolveFromProject(fromFile: string, request: string, via?: string): string | null {
    const failKey = `${path.dirname(fromFile)}\0${request}\0${via ?? ''}`;
    if (failures.has(failKey))
        return null;
    const direct = tryResolve(fromFile, request);
    if (direct)
        return direct;
    if (via) {
        const host = tryResolve(fromFile, `${via}/package.json`);
        const nested = host ? tryResolve(host, request) : null;
        if (nested)
            return nested;
    }
    failures.add(failKey);
    return null;
}

/**
 * `require` `request` from the project that contains `fromFile`.
 *
 * @param {string} fromFile See {@link resolveFromProject}.
 * @param {string} request Package request.
 * @param {string} [via] Host package used when the direct request is not installed.
 * @returns {T | null} Module exports, or `null` when resolution or load fails. Cached.
 */
export function requireFromProject<T = unknown>(fromFile: string, request: string, via?: string): T | null {
    const resolved = resolveFromProject(fromFile, request, via);
    if (!resolved)
        return null;
    if (modules.has(resolved))
        return modules.get(resolved) as T;
    try {
        const loaded = createRequire(resolved)(resolved) as T;
        modules.set(resolved, loaded);
        return loaded;
    }
    catch {
        failures.add(`${path.dirname(fromFile)}\0${request}\0${via ?? ''}`);
        return null;
    }
}

/**
 * One `require.resolve` attempt. Failures are normal (package not installed) and return `null`.
 *
 * @param {string} fromFile Filename passed to `createRequire`.
 * @param {string} request Request string.
 * @returns {string | null}
 */
function tryResolve(fromFile: string, request: string): string | null {
    try {
        return createRequire(fromFile).resolve(request);
    }
    catch {
        return null;
    }
}
