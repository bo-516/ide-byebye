/**
 * Facts about the Next.js project a config wrapper runs in: its directory and installed version.
 *
 * Purpose: `withIdeByebye()` receives only a config object, yet it must know where the Next project lives (the
 * bootstrap module has to sit inside it so Next compiles its `'use client'` directive) and which config key the
 * installed version reads Turbopack rules from.
 *
 * Boundary: best effort with safe fallbacks — the project directory falls back to `process.cwd()` and an unknown
 * version is treated as current (stable `turbopack` key). Both can be pinned with the `root` option.
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Matches a `next.config.*` path inside a stack frame (`file://` URL, POSIX or Windows path). */
const NEXT_CONFIG_FRAME = /((?:file:\/\/)?(?:\/|[A-Za-z]:[\\/])[^\s()]*?[\\/]next\.config\.(?:[cm]?[jt]s))(?::\d+)*/;

/**
 * Directory of the `next.config.*` file currently being evaluated, read from the call stack.
 *
 * Purpose: `next dev apps/web` run from a monorepo root leaves `process.cwd()` at the root, while every Next config
 * format (`.js`, `.mjs`, `.cjs`, and `.ts` compiled in memory) keeps its own path in stack frames.
 *
 * @param {string} [stack] Stack trace to inspect; defaults to the current one (tests pass a fixture).
 * @returns {string | null} Absolute project directory, or `null` when no config frame is present.
 */
export function detectNextProjectDir(stack: string = new Error().stack ?? '') {
    for (const line of stack.split('\n')) {
        const match = NEXT_CONFIG_FRAME.exec(line);
        if (!match)
            continue;
        const file = match[1].startsWith('file://') ? fileURLToPath(match[1]) : match[1];
        return path.dirname(file);
    }
    return null;
}

/**
 * Installed Next.js version, resolved from the project and then from the running Next CLI.
 *
 * @param {string} projectDir Absolute Next project directory.
 * @param {string | undefined} [entryScript] Script of the running process (`process.argv[1]`, e.g. Next's
 *   `start-server.js`), used when `next` is not resolvable from `projectDir` (hoisting quirks).
 * @returns {string | null} Version string such as `'16.3.6'`, or `null` when unknown.
 */
export function detectNextVersion(projectDir: string, entryScript: string | undefined = process.argv[1]) {
    const bases = [path.join(projectDir, 'package.json')];
    if (entryScript)
        bases.push(entryScript);
    for (const base of bases) {
        try {
            const pkgPath = createRequire(base).resolve('next/package.json');
            const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
            if (typeof version === 'string')
                return version;
        }
        catch {
            // try the next base
        }
    }
    return null;
}

/**
 * Major version of a Next.js version string.
 *
 * @param {string | null} version Installed Next version (`null` = unknown).
 * @returns {number | null} Major version, or `null` when unknown / unparsable.
 */
export function nextMajor(version: string | null) {
    const match = /^(\d+)\./.exec(version ?? '');
    return match ? Number(match[1]) : null;
}

/**
 * Whether Turbopack rules belong under the stable `turbopack` key (Next ≥ 15.3) instead of `experimental.turbo`.
 *
 * @param {string | null} version Installed Next version (`null` = unknown → assume current).
 * @returns {boolean} `true` for `turbopack.rules`, `false` for `experimental.turbo.rules`.
 */
export function usesStableTurbopackKey(version: string | null) {
    const match = /^(\d+)\.(\d+)/.exec(version ?? '');
    if (!match)
        return true;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    return major > 15 || (major === 15 && minor >= 3);
}

/**
 * Whether this process should host the inspector for `next dev`.
 *
 * Purpose: Next loads `next.config` in more processes than the dev server — the `next` CLI supervisor (Next ≤ 15 reads
 * `distDir` there), the detached telemetry flush, type-generation helpers. Starting an inspector in those would race
 * the real one for the bootstrap module and keep stale options alive, so only the dev-server process
 * (`next/dist/server/…`, e.g. `start-server.js`) and processes outside Next's own scripts (custom
 * `next({ dev: true })` servers) qualify.
 *
 * Boundary: the entry script is resolved through symlinks first — npm / yarn start the CLI as the
 * `node_modules/.bin/next` symlink, which only reveals `next/dist/bin/next` once resolved.
 *
 * @param {string | undefined} [entryScript] Process entry script (`process.argv[1]`).
 * @returns {boolean} `true` when the inspector may start here.
 */
export function isInspectorHostProcess(entryScript: string | undefined = process.argv[1]) {
    let resolved = String(entryScript ?? '');
    try {
        resolved = fs.realpathSync(resolved);
    }
    catch {
        // not on disk (tests, virtual entries): classify the path as given
    }
    const entry = resolved.replace(/\\/g, '/');
    if (!/\/next\/dist\//.test(entry))
        return true;
    return /\/next\/dist\/server\//.test(entry);
}
