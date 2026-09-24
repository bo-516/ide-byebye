/**
 * Next.js bundler wiring: Turbopack rules and the `webpack()` hook that carry code-inspector plus the entry loader.
 *
 * Purpose: keep the per-bundler / per-Next-version shapes in one place so `with-next.ts` only decides *whether* to
 * integrate. Rules: code-inspector's `data-insp-path` rules with the entry loader prepended to the same rule (so it rides
 * in the same loader chain and runs after stamping); webpack: code-inspector's webpack plugin plus an entry-loader rule
 * for every dev compilation (server, edge, client) so SSR and hydration markup agree.
 *
 * Boundary: pure config construction — no server start, no fs writes (the inspector handle supplies file paths).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeInspectorPlugin } from 'code-inspector-plugin';
import { codeInspectorDefaults } from '../plugin-runtime.js';
import type { NextInspector } from './next-inspector.js';
import { detectNextVersion, nextMajor, usesStableTurbopackKey } from './next-project.js';

/** code-inspector's Next ≥ 16 rule glob; when present every JS-like file already runs our loader. */
const BROAD_CODE_GLOB = '**/*.{jsx,tsx,js,ts,mjs,mts}';

/** Extra rule for older Next, whose code-inspector glob skips plain `.js` shells, `_app.js` and pages. */
const ENTRY_JS_GLOB = '**/{app,pages}/**/*.{js,mjs}';

/**
 * Next 14's Turbopack parses webpack-loader output as plain ECMAScript unless the rule declares `as`, so TypeScript
 * modules fail after any loader runs (code-inspector's own rules included). Typed rules keep each extension's module
 * type; only JSX-capable extensions are listed because nothing else carries elements.
 */
const TYPED_RULE_GLOBS: Record<string, string> = {
    '**/*.tsx': '*.tsx',
    '**/*.jsx': '*.jsx',
};

/** Modules the webpack entry-loader rule applies to. */
const WEBPACK_ENTRY_TEST = /\.(?:jsx?|tsx?|mjs)$/;

/**
 * Absolute path of the compiled entry loader (resolved lazily so bundling this module has no side effects).
 *
 * @returns {string} Path to `entry-loader.js` next to this module.
 */
function entryLoaderPath() {
    return fileURLToPath(new URL('./entry-loader.js', import.meta.url));
}

/**
 * Build Turbopack rules: code-inspector's rules with the entry loader prepended (= runs last, after `data-insp-path`
 * is stamped), plus the older-Next `.js` entry rule when code-inspector did not already cover every JS file.
 *
 * Boundary: with `typedRules` (Next 14) the same loaders are re-emitted as one rule per JSX extension with a matching
 * `as`, see {@link TYPED_RULE_GLOBS}; `.js` modules need no `as` there.
 *
 * @param {Record<string, unknown>} options Plugin options (forwarded to code-inspector defaults).
 * @param {NextInspector} inspector Running inspector (provides the bootstrap module path).
 * @param {{ typedRules?: boolean }} [shape] Rule shape for the installed Next version.
 * @returns {Record<string, unknown>} Rules object for `turbopack.rules` / `experimental.turbo.rules`.
 */
export function buildTurbopackRules(options, inspector: NextInspector, { typedRules = false } = {}) {
    const entry = { loader: entryLoaderPath(), options: { bootstrapFile: inspector.bootstrapFile, projectDir: inspector.root } };
    const codeRules = codeInspectorPlugin({ bundler: 'turbopack', ...codeInspectorDefaults(options), dev: true }) || {};
    const rules: Record<string, unknown> = {};
    if (typedRules) {
        const codeLoaders = Object.values(codeRules).flatMap((rule: any) => (Array.isArray(rule) ? rule : rule?.loaders ?? []));
        for (const [glob, as] of Object.entries(TYPED_RULE_GLOBS))
            rules[glob] = { loaders: [entry, ...codeLoaders], as };
        rules[ENTRY_JS_GLOB] = { loaders: [entry, ...codeLoaders] };
        return rules;
    }
    for (const [glob, rule] of Object.entries(codeRules)) {
        rules[glob] = Array.isArray(rule)
            ? [entry, ...rule]
            : { ...(rule as object), loaders: [entry, ...((rule as any)?.loaders ?? [])] };
    }
    if (!Object.hasOwn(rules, BROAD_CODE_GLOB))
        rules[ENTRY_JS_GLOB] = { loaders: [entry] };
    return rules;
}

/**
 * Turbopack config placement for the Next version installed at `root`.
 *
 * @param {string} root Absolute project root.
 * @returns {{ stableKey: boolean, typedRules: boolean }} Config key choice and rule shape.
 */
export function turbopackShape(root: string) {
    const version = detectNextVersion(root);
    const major = nextMajor(version);
    return { stableKey: usesStableTurbopackKey(version), typedRules: major != null && major < 15 };
}

/**
 * Merge our rules under the right config key; user rules win on an identical glob (with a warning).
 *
 * @param {Record<string, any>} nextConfig User Next config.
 * @param {Record<string, unknown>} rules Rules from {@link buildTurbopackRules}.
 * @param {boolean} stableKey `true` → `turbopack.rules`, `false` → `experimental.turbo.rules`.
 * @returns {Record<string, any>} New config object (input not mutated).
 */
export function mergeTurbopackRules(nextConfig, rules, stableKey: boolean) {
    const holder = stableKey ? (nextConfig.turbopack ?? {}) : (nextConfig.experimental?.turbo ?? {});
    const userRules = holder.rules ?? {};
    for (const glob of Object.keys(userRules)) {
        if (Object.hasOwn(rules, glob))
            console.warn(`[code-intent-inspector] your turbopack rule "${glob}" replaces ide-byebye's; inspector may miss those files`);
    }
    const merged = { ...holder, rules: { ...rules, ...userRules } };
    if (stableKey)
        return { ...nextConfig, turbopack: merged };
    return { ...nextConfig, experimental: { ...(nextConfig.experimental ?? {}), turbo: merged } };
}

/**
 * Wrap the user's `webpack()` hook to add code-inspector and the entry loader in development compilations.
 *
 * @param {Function | undefined} userWebpack User hook (called first, result preserved).
 * @param {Record<string, unknown>} options Plugin options.
 * @param {NextInspector} inspector Running inspector.
 * @returns {Function} Next `webpack(config, context)` hook.
 */
export function wrapWebpack(userWebpack, options, inspector: NextInspector) {
    return function webpack(config, context) {
        const result = typeof userWebpack === 'function' ? userWebpack(config, context) : config;
        if (!context?.dev)
            return result;
        const projectDir = context.dir ? path.resolve(context.dir) : inspector.root;
        const bootstrapFile = inspector.bootstrapFileFor(projectDir);
        result.plugins = [...(result.plugins ?? []), codeInspectorPlugin({ bundler: 'webpack', ...codeInspectorDefaults(options), dev: true })];
        result.module = result.module ?? {};
        result.module.rules = [...(result.module.rules ?? []), {
            test: WEBPACK_ENTRY_TEST,
            exclude: /[\\/]node_modules[\\/]/,
            use: [{ loader: entryLoaderPath(), options: { bootstrapFile, projectDir } }],
        }];
        return result;
    };
}
