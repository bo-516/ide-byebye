import fs from 'node:fs';
import path from 'node:path';
import { createUnplugin } from 'unplugin';
import { codeInspectorPlugin } from 'code-inspector-plugin';
import { CLIENT_CONFIG_GLOBAL } from './src/shared/constants.js';
import {
    PLUGIN_NAME,
    codeInspectorDefaults,
    createInspectorRuntime,
    injectHtmlSnippet,
    setupWebpackLikeCompiler,
} from './src/server/plugin-runtime.js';

export { codeInspectorDefaults, PLUGIN_NAME } from './src/server/plugin-runtime.js';

/**
 * The shared, bundler-agnostic factory passed to `createUnplugin`.
 *
 * Purpose: one inspector instance per plugin usage. Bundler-specific surface is limited to HTML injection + when to
 * start the loopback server. Vite uses `transformIndexHtml`; webpack/rspack rewrite emitted `.html` assets; rsbuild
 * uses `modifyHTMLTags`; farm uses `transformHtml`; esbuild starts the server and rewrites HTML files listed via
 * `options.htmlFiles` (or any `*.html` next to `outdir`/`outfile` after the build).
 *
 * Boundary: `meta.framework` selects the code-inspector `bundler` for compiler-based adapters. The Vite / farm / esbuild
 * entry helpers register code-inspector themselves because those ecosystems need a separate plugin instance. When
 * `options.enabled` is false nothing is started or injected.
 *
 * @param {Record<string, unknown>} options Raw plugin options from the host bundler config.
 * @param {{ framework?: string }} meta unplugin meta (`vite` / `webpack` / `rspack` / `rsbuild` / `farm` / `esbuild` / …).
 * @returns {import('unplugin').UnpluginOptions} unplugin definition with per-framework hooks.
 */
function inspectorFactory(options = {}, meta = {}) {
    const runtime = createInspectorRuntime(options);

    function setupCompiler(compiler) {
        const bundler = meta.framework === 'rspack' ? 'rspack' : 'webpack';
        setupWebpackLikeCompiler(compiler, runtime, bundler);
    }

    return {
        name: PLUGIN_NAME,
        vite: {
            apply: 'serve',
            enforce: 'pre',
            configResolved(config) {
                if (runtime.enabled) {
                    runtime.initPaths(config.root);
                }
            },
            transformIndexHtml: {
                order: 'post',
                async handler(html) {
                    if (!runtime.enabled) {
                        return html;
                    }
                    return { html, tags: await runtime.injectionTags() };
                },
            },
        },
        webpack: setupCompiler,
        rspack: setupCompiler,
        /**
         * rsbuild (rspack-based). Registers code-inspector on the rspack chain and injects bootstrap tags into the
         * generated HTML. Dev-only: rsbuild's production builds skip the inject when `NODE_ENV=production`.
         */
        rsbuild: {
            name: PLUGIN_NAME,
            setup(api) {
                if (!runtime.enabled) {
                    return;
                }
                api.modifyRspackConfig((config) => {
                    const plugins = config.plugins || (config.plugins = []);
                    try {
                        plugins.push(codeInspectorPlugin({
                            bundler: 'rspack',
                            ...codeInspectorDefaults(options),
                        }));
                    }
                    catch (err) {
                        // peer missing — surface later via missing data-insp-path
                        void err;
                    }
                    return config;
                });
                api.onBeforeStartDevServer(async () => {
                    const root = api.context?.rootPath || process.cwd();
                    runtime.initPaths(root);
                    await runtime.ensureServer();
                });
                api.modifyHTMLTags(async ({ headTags, bodyTags }) => {
                    if (process.env.NODE_ENV === 'production') {
                        return { headTags, bodyTags };
                    }
                    runtime.initPaths(api.context?.rootPath || process.cwd());
                    const tags = await runtime.injectionTags();
                    const converted = tags.map((t) => ({
                        tag: t.tag,
                        attrs: t.attrs || {},
                        children: t.children || '',
                    }));
                    return { headTags: [...converted, ...headTags], bodyTags };
                });
            },
        },
        /**
         * Farm. code-inspector reuses its Vite adapter for Farm (no dedicated `bundler: 'farm'`); we only handle HTML
         * injection + server lifecycle here. The {@link farm} export registers code-inspector alongside this plugin.
         */
        farm: {
            name: PLUGIN_NAME,
            priority: 1000,
            configResolved: {
                executor({ config }) {
                    if (runtime.enabled) {
                        runtime.initPaths(config?.root || process.cwd());
                    }
                },
            },
            transformHtml: {
                order: 100,
                async executor({ htmlResource }) {
                    if (!runtime.enabled || !htmlResource) {
                        return htmlResource;
                    }
                    const html = typeof htmlResource === 'string'
                        ? htmlResource
                        : (htmlResource.html || htmlResource.code || '');
                    if (!html) {
                        return htmlResource;
                    }
                    const snippet = await runtime.injectionHtml();
                    const next = injectHtmlSnippet(html, snippet);
                    if (typeof htmlResource === 'string') {
                        return next;
                    }
                    if ('html' in htmlResource) {
                        return { ...htmlResource, html: next };
                    }
                    if ('code' in htmlResource) {
                        return { ...htmlResource, code: next };
                    }
                    return htmlResource;
                },
            },
        },
        /**
         * esbuild. Starts the inspector server and rewrites HTML files after each build.
         *
         * HTML targets resolve as:
         * 1. `options.htmlFiles` — explicit absolute/relative paths (preferred for custom serve scripts)
         * 2. otherwise any `*.html` already present in `outdir` / next to `outfile`
         *
         * For pure API usage without HTML on disk, call the returned plugin's companion helpers via {@link esbuild}.
         */
        esbuild: {
            async setup(build) {
                if (!runtime.enabled) {
                    return;
                }
                const absWorkingDir = build.initialOptions.absWorkingDir || process.cwd();
                runtime.initPaths(absWorkingDir);

                build.onStart(async () => {
                    await runtime.ensureServer();
                });

                build.onEnd(async () => {
                    const snippet = await runtime.injectionHtml();
                    const targets = resolveEsbuildHtmlTargets(options, build.initialOptions, absWorkingDir);
                    for (const file of targets) {
                        try {
                            const original = fs.readFileSync(file, 'utf8');
                            if (original.includes(CLIENT_BOOTSTRAP_MARKER)) {
                                continue;
                            }
                            fs.writeFileSync(file, injectHtmlSnippet(original, snippet), 'utf8');
                        }
                        catch {
                            // missing / unreadable HTML is non-fatal for the JS build
                        }
                    }
                });
            },
        },
    };
}

/** Marker so esbuild rewrites stay idempotent across rebuilds. */
const CLIENT_BOOTSTRAP_MARKER = `window.${CLIENT_CONFIG_GLOBAL}`;

/**
 * Resolve which HTML files the esbuild adapter should rewrite after a build.
 *
 * @param {Record<string, unknown>} options Plugin options; may include `htmlFiles: string[]`.
 * @param {Record<string, unknown>} initialOptions esbuild `BuildOptions`.
 * @param {string} absWorkingDir Absolute working directory for relative paths.
 * @returns {string[]} Absolute HTML file paths (may be empty).
 */
function resolveEsbuildHtmlTargets(options, initialOptions, absWorkingDir) {
    const listed = Array.isArray(options.htmlFiles) ? options.htmlFiles : [];
    if (listed.length > 0) {
        return listed.map((f) => path.isAbsolute(f) ? f : path.resolve(absWorkingDir, f));
    }
    const outdir = initialOptions.outdir
        ? (path.isAbsolute(initialOptions.outdir)
            ? initialOptions.outdir
            : path.resolve(absWorkingDir, initialOptions.outdir))
        : null;
    if (outdir && fs.existsSync(outdir)) {
        return fs.readdirSync(outdir)
            .filter((name) => name.endsWith('.html'))
            .map((name) => path.join(outdir, name));
    }
    if (initialOptions.outfile) {
        const out = path.isAbsolute(initialOptions.outfile)
            ? initialOptions.outfile
            : path.resolve(absWorkingDir, initialOptions.outfile);
        const sibling = path.join(path.dirname(out), 'index.html');
        return fs.existsSync(sibling) ? [sibling] : [];
    }
    return [];
}

/** The raw unplugin instance; exposes `.vite`/`.webpack`/`.rspack`/`.rsbuild`/`.farm`/`.esbuild`/… entry points. */
const unplugin = createUnplugin(inspectorFactory);

/**
 * Vite entry. Returns an array so `code-inspector-plugin` (which must run as its own Vite plugin to inject
 * `data-insp-path` before the framework transform) is registered alongside our inspector with zero config.
 *
 * @param {Record<string, unknown>} [options] Plugin options.
 * @returns {import('vite').Plugin[]} `[codeInspectorPlugin, inspectorVitePlugin]`.
 */
export function vite(options = {}) {
    return [
        codeInspectorPlugin({ bundler: 'vite', ...codeInspectorDefaults(options) }),
        unplugin.vite(options),
    ];
}

/**
 * webpack entry. Registers code-inspector (`bundler: 'webpack'`) and injects the bootstrap into emitted HTML.
 *
 * @param {Record<string, unknown>} [options] Plugin options.
 * @returns {object} webpack plugin instance.
 */
export function webpack(options = {}) {
    return unplugin.webpack(options);
}

/**
 * rspack entry. Same contract as {@link webpack}; rspack reuses code-inspector's webpack adapter.
 *
 * @param {Record<string, unknown>} [options] Plugin options.
 * @returns {object} rspack plugin instance.
 */
export function rspack(options = {}) {
    return unplugin.rspack(options);
}

/**
 * rsbuild entry. Registers code-inspector on the underlying rspack chain and injects bootstrap tags via
 * `modifyHTMLTags`. Zero-config: `plugins: [inspector()]`.
 *
 * @param {Record<string, unknown>} [options] Plugin options.
 * @returns {object} rsbuild plugin instance.
 */
export function rsbuild(options = {}) {
    return unplugin.rsbuild(options);
}

/**
 * Farm entry. Registers code-inspector through its Vite-compatible adapter (Farm has no dedicated code-inspector
 * bundler id) and injects the bootstrap through Farm's `transformHtml` hook.
 *
 * @param {Record<string, unknown>} [options] Plugin options.
 * @returns {object[]} `[codeInspectorPlugin, inspectorFarmPlugin]`.
 */
export function farm(options = {}) {
    return [
        // Farm consumes the Vite code-inspector transform pipeline.
        codeInspectorPlugin({ bundler: 'vite', ...codeInspectorDefaults(options) }),
        unplugin.farm(options),
    ];
}

/**
 * esbuild entry. Registers code-inspector's esbuild transform + our loopback server / HTML rewrite.
 *
 * Pass `htmlFiles: ['./index.html']` when the HTML is not emitted into `outdir` (typical for a custom static server
 * that reads a source HTML and serves the esbuild bundle). After `context.rebuild()` / `build()`, those files are
 * rewritten in place with the bootstrap snippet (idempotent).
 *
 * @param {Record<string, unknown>} [options] Plugin options; may include `htmlFiles: string[]`.
 * @returns {object[]} `[codeInspectorEsbuildPlugin, inspectorEsbuildPlugin]`.
 */
export function esbuild(options = {}) {
    return [
        codeInspectorPlugin({ bundler: 'esbuild', ...codeInspectorDefaults(options) }),
        unplugin.esbuild(options),
    ];
}

/**
 * Turbopack entry for Next.js. Returns the rules object code-inspector expects under `experimental.turbo.rules`
 * (Next &lt; 15.3) or `turbopack.rules` (Next ≥ 15.3).
 *
 * Boundary: Turbopack has no HTML-rewrite hook we can attach to, so the inspector **bootstrap must be mounted by the
 * app** (e.g. a small client component that loads the loopback client, or a custom `_document`/layout script). This
 * export only wires `data-insp-path` injection. Prefer Vite/webpack/rspack/rsbuild for the zero-config experience.
 *
 * @param {Record<string, unknown>} [options] Plugin options (forwarded to code-inspector defaults).
 * @returns {object} Turbopack rules object from `codeInspectorPlugin({ bundler: 'turbopack' })`.
 */
export function turbopack(options = {}) {
    return codeInspectorPlugin({ bundler: 'turbopack', ...codeInspectorDefaults(options) });
}

/**
 * Mako entry (Umi). Returns the Mako plugin from code-inspector. Same bootstrap caveat as {@link turbopack}: Mako
 * injects `data-insp-path`, but the inspector client still needs an HTML entry that loads our loopback bootstrap.
 *
 * @param {Record<string, unknown>} [options] Plugin options.
 * @returns {object} Mako plugin instance.
 */
export function mako(options = {}) {
    return codeInspectorPlugin({ bundler: 'mako', ...codeInspectorDefaults(options) });
}

/**
 * Back-compatible default: the Vite entry. Existing configs that do `plugins: [codeIntentInspectorPlugin(options)]`
 * keep working and get code-inspector wired for free.
 */
export const codeIntentInspectorPlugin = vite;
