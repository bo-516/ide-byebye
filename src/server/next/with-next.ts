/**
 * Next.js integration: `withIdeByebye(nextConfig, options)` and the rules behind the `turbopack()` export.
 *
 * Purpose: one wrapper wires both bundlers Next can run in dev — Turbopack rules under `turbopack.rules` (Next ≥ 15.3)
 * or `experimental.turbo.rules`, and a wrapped `webpack()` hook (`next dev --webpack`, Next ≤ 15's default); see
 * `bundler-config.ts`. The entry loader mounts a generated bootstrap module into root layouts / `_app`, so no app code
 * is needed.
 *
 * Boundary: only the `next dev` server process is touched — object configs check `NODE_ENV === 'development'` (set by
 * `next dev`), function configs check Next's `phase`, and Next's helper processes that also load the config (CLI
 * supervisor, telemetry flush) are skipped via {@link isInspectorHostProcess}. Production builds and helpers get the
 * user's config back unchanged. The user's own rules and `webpack()` run first and are preserved.
 */

import path from 'node:path';
import type { NextIdeByebyeOptions } from '../../types.js';
import { buildTurbopackRules, mergeTurbopackRules, turbopackShape, wrapWebpack } from './bundler-config.js';
import { getNextInspector } from './next-inspector.js';
import { detectNextProjectDir, isInspectorHostProcess } from './next-project.js';

/** `PHASE_DEVELOPMENT_SERVER` from `next/constants`. */
const PHASE_DEVELOPMENT_SERVER = 'phase-development-server';

/**
 * Current stack with a generous frame limit, so the `next.config.*` frame is never cut off.
 *
 * @returns {string} Stack trace text.
 */
function captureStack() {
    const previous = Error.stackTraceLimit;
    Error.stackTraceLimit = 50;
    try {
        return new Error().stack ?? '';
    }
    finally {
        Error.stackTraceLimit = previous;
    }
}

/**
 * Next project root: `options.root`, else the directory of the `next.config.*` calling us, else `process.cwd()`.
 *
 * @param {{ root?: string }} options Plugin options.
 * @returns {string} Absolute project root.
 */
function resolveRoot(options) {
    return path.resolve(options.root ?? detectNextProjectDir(captureStack()) ?? process.cwd());
}

/**
 * Apply the full dev integration to a resolved Next config object.
 *
 * @param {Record<string, any>} nextConfig Resolved user config.
 * @param {Record<string, unknown>} options Plugin options.
 * @param {string} root Absolute project root.
 * @returns {Record<string, any>} Config with Turbopack rules and the wrapped webpack hook.
 */
function applyNextIntegration(nextConfig, options, root) {
    const config = nextConfig ?? {};
    const inspector = getNextInspector(root, options);
    const { stableKey, typedRules } = turbopackShape(root);
    const withRules = mergeTurbopackRules(config, buildTurbopackRules(options, inspector, { typedRules }), stableKey);
    return { ...withRules, webpack: wrapWebpack(config.webpack, options, inspector) };
}

/**
 * Wrap a Next.js config so `next dev` gets ⌘-click inspection with zero app code.
 *
 * @param {object | Function | Promise<object>} [nextConfig] The config you would export (object, `(phase, ctx) => …`
 *   function, or a promise); omitted = `{}`.
 * @param {NextIdeByebyeOptions} [options] ide-byebye options; `root` pins the Next project dir when auto-detection (the
 *   `next.config.*` location) is not what you want. `enabled: false` returns the config as-is.
 * @returns {object | Function | Promise<object>} Same shape as `nextConfig`, with the integration applied in dev only.
 */
export function withIdeByebye<T = Record<string, unknown>>(nextConfig: T = {} as T, options: NextIdeByebyeOptions = {}): T {
    const input: any = nextConfig;
    if (options.enabled === false)
        return nextConfig;
    const root = resolveRoot(options);
    const hostable = isInspectorHostProcess();
    if (typeof input === 'function') {
        return (async (phase, context) => {
            const resolved = await input(phase, context);
            return phase === PHASE_DEVELOPMENT_SERVER && hostable ? applyNextIntegration(resolved, options, root) : resolved;
        }) as T;
    }
    const isDev = process.env.NODE_ENV === 'development' && hostable;
    if (input && typeof input.then === 'function')
        return input.then((resolved) => (isDev ? applyNextIntegration(resolved, options, root) : resolved));
    return isDev ? applyNextIntegration(input, options, root) : nextConfig;
}

/**
 * Turbopack rules only (legacy `ide-byebye/turbopack` export): starts the inspector in `next dev` and returns the
 * rules to place under `turbopack.rules` / `experimental.turbo.rules`.
 *
 * @param {NextIdeByebyeOptions} [options] Plugin options (`root` as in {@link withIdeByebye}).
 * @returns {Record<string, unknown>} Rules object, `{}` outside development.
 */
export function nextTurbopackRules(options: NextIdeByebyeOptions = {}): Record<string, unknown> {
    if (options.enabled === false || process.env.NODE_ENV !== 'development' || !isInspectorHostProcess())
        return {};
    const root = resolveRoot(options);
    return buildTurbopackRules(options, getNextInspector(root, options), { typedRules: turbopackShape(root).typedRules });
}
