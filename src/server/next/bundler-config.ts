/**
 * Next.js bundler wiring: Turbopack rules and the `webpack()` hook that carry the stamp loader plus the entry loader.
 *
 * Purpose: keep the per-bundler / per-Next-version shapes in one place so `with-next.ts` only decides *whether* to
 * integrate. Turbopack runs loaders right to left, so the array is `[entry, stamp]` (stamp first). webpack uses an
 * `enforce: 'pre'` stamp rule plus the entry rule so SSR and hydration markup agree.
 *
 * Boundary: pure config construction — no server start, no fs writes (the inspector handle supplies file paths).
 * Loader options are JSON. The version used for the glob is the Next install at `inspector.root`, not `process.cwd()`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeStampOptions } from '../stamp/stamp-options.js';
import type { NextInspector } from './next-inspector.js';
import { detectNextVersion, nextMajor, usesStableTurbopackKey } from './next-project.js';

/** Next ≥ 16 stamps every JS-like file, matching code-inspector 1.6.2's broad glob. */
const BROAD_CODE_GLOB = '**/*.{jsx,tsx,js,ts,mjs,mts}';

/**
 * Next before 16: JSX extensions plus App Router convention filenames.
 * Plain `.js` pages and `_app` are covered by {@link ENTRY_JS_GLOB}.
 */
const LEGACY_CODE_GLOB = '**/{*.jsx,*.tsx,layout.js,layout.ts,page.js,page.ts,loading.js,loading.ts,not-found.js,not-found.ts,error.js,error.ts,global-error.js,global-error.ts,template.js,template.ts,default.js,default.ts}';

/** Extra rule for older Next, whose convention glob skips plain `.js` shells, `_app.js` and pages. */
const ENTRY_JS_GLOB = '**/{app,pages}/**/*.{js,mjs}';

/**
 * Next 14's Turbopack parses webpack-loader output as plain ECMAScript unless the rule declares `as`, so TypeScript
 * modules fail after any loader runs. Typed rules keep each extension's module
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
 * Absolute path of the compiled stamp loader.
 *
 * @returns {string} Path to `stamp-loader.js`. The `.js` suffix matches the emitted file even when tests load the `.ts` source.
 */
function stampLoaderPath() {
    return fileURLToPath(new URL('../stamp/stamp-loader.js', import.meta.url));
}

/**
 * Build Turbopack rules: `[entry, stamp]` so the stamp loader runs first (Turbopack executes right to left)
 * and the entry loader then mounts the bootstrap.
 *
 * Boundary: with `typedRules` (Next 14) one rule per JSX extension carries a matching `as`. Next ≥ 16 uses the
 * broad glob. Older Next uses the convention glob plus {@link ENTRY_JS_GLOB}.
 *
 * @param {Record<string, unknown>} options Plugin options, serialized into the stamp loader.
 * @param {NextInspector} inspector Running inspector (provides the bootstrap module path and project root).
 * @param {{ typedRules?: boolean }} [shape] Rule shape for the installed Next version.
 * @returns {Record<string, unknown>} Rules object for `turbopack.rules` / `experimental.turbo.rules`.
 */
export function buildTurbopackRules(options, inspector: NextInspector, { typedRules = false } = {}) {
    const entry = { loader: entryLoaderPath(), options: { bootstrapFile: inspector.bootstrapFile, projectDir: inspector.root } };
    const stamp = { loader: stampLoaderPath(), options: serializeStampOptions(options) };
    const chain = [entry, stamp];
    if (typedRules) {
        const rules: Record<string, unknown> = {};
        for (const [glob, as] of Object.entries(TYPED_RULE_GLOBS))
            rules[glob] = { loaders: chain, as };
        rules[ENTRY_JS_GLOB] = { loaders: chain };
        return rules;
    }
    const major = nextMajor(detectNextVersion(inspector.root));
    const glob = major != null && major >= 16 ? BROAD_CODE_GLOB : LEGACY_CODE_GLOB;
    const rules: Record<string, unknown> = { [glob]: { loaders: chain } };
    if (glob !== BROAD_CODE_GLOB)
        rules[ENTRY_JS_GLOB] = { loaders: chain };
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

/** Files the Next webpack stamp rule hands to the stamp loader. `enforce: 'pre'` runs it before other loaders. */
const WEBPACK_STAMP_TEST = /\.(?:jsx|tsx|js|ts|mjs|mts|vue|svelte|html)$/;

/**
 * Wrap the user's `webpack()` hook to add the stamp loader and the entry loader in development compilations.
 *
 * Boundary: does not assign `config.cache.version`. The stamp rule is `enforce: 'pre'`; the entry rule is a normal
 * rule so it runs after stamping.
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
        result.module = result.module ?? {};
        result.module.rules = [...(result.module.rules ?? []), {
            enforce: 'pre',
            test: WEBPACK_STAMP_TEST,
            use: [{ loader: stampLoaderPath(), options: serializeStampOptions(options) }],
        }, {
            test: WEBPACK_ENTRY_TEST,
            exclude: /[\\/]node_modules[\\/]/,
            use: [{ loader: entryLoaderPath(), options: { bootstrapFile, projectDir } }],
        }];
        return result;
    };
}
