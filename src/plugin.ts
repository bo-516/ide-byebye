import fs from 'node:fs';
import { createUnplugin } from 'unplugin';
import { codeInspectorPlugin } from 'code-inspector-plugin';
import {
    PLUGIN_NAME,
    codeInspectorDefaults,
    createInspectorRuntime,
} from './server/plugin-runtime.js';
import {
    CLIENT_BOOTSTRAP_MARKER,
    injectHtmlSnippet,
    resolveEsbuildHtmlTargets,
    setupWebpackLikeCompiler,
} from './server/html-injection.js';
import { isViteClientModule } from './server/vite-client.js';
import { resolvePackageRoot } from './server/workspace-root.js';
import { nextTurbopackRules } from './server/next/with-next.js';
import type { IdeByebyeOptions, PluginInstance, VitePlugin } from './types.js';

export { codeInspectorDefaults, PLUGIN_NAME } from './server/plugin-runtime.js';


/**
 * The shared, bundler-agnostic factory passed to `createUnplugin`.
 *
 * Purpose: one inspector instance per plugin usage. Bundler-specific surface is limited to HTML injection + when to
 * start the loopback server. Vite uses `transformIndexHtml` and, for SSR frameworks whose HTML never reaches that hook
 * (Nuxt, SvelteKit, SolidStart, Astro, …), appends an idempotent JS bootstrap to `/@vite/client`; webpack/rspack
 * rewrite emitted `.html` assets; rsbuild uses `modifyHTMLTags`; farm uses `transformHtml`; esbuild starts the server
 * and rewrites HTML files listed via `options.htmlFiles` (or any `*.html` next to `outdir`/`outfile` after the build).
 *
 * Boundary: `meta.framework` selects the code-inspector `bundler` for compiler-based adapters. The Vite / farm / esbuild
 * entry helpers register code-inspector themselves because those ecosystems need a separate plugin instance. When
 * `options.enabled` is false nothing is started or injected.
 *
 * @param {Record<string, unknown>} options Raw plugin options from the host bundler config.
 * @param {{ framework?: string }} meta unplugin meta (`vite` / `webpack` / `rspack` / `rsbuild` / `farm` / `esbuild` / …).
 * @returns {import('unplugin').UnpluginOptions} unplugin definition with per-framework hooks.
 */
function inspectorFactory(options: IdeByebyeOptions = {}, meta: any = {}) {
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
                    // The package owning Vite's root, not the root itself (Nuxt 4 sets `root` to its `app/` dir).
                    runtime.initPaths(resolvePackageRoot(config.root));
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
            /**
             * Append the JS bootstrap to Vite's browser client. SPAs already got the HTML tags above (the statement
             * then no-ops on the matching token); SSR frameworks render their own HTML and rely on this path.
             */
            async transform(code, id) {
                if (!runtime.enabled || !isViteClientModule(id)) {
                    return null;
                }
                return `${code}\n${await runtime.bootstrapStatement()}\n`;
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

/** The raw unplugin instance; exposes `.vite`/`.webpack`/`.rspack`/`.rsbuild`/`.farm`/`.esbuild`/… entry points. */
const unplugin = createUnplugin(inspectorFactory as any);

/**
 * Vite entry. Returns an array so `code-inspector-plugin` (which must run as its own Vite plugin to inject
 * `data-insp-path` before the framework transform) is registered alongside our inspector with zero config.
 *
 * Return type is {@link VitePlugin}`[]` (not `object[]`) so nested placement in Vite's `plugins`
 * typechecks as `PluginOption` without an `as PluginOption` cast:
 * `plugins: [ideByebye({ recording: false }), vue()]`.
 *
 * @param options Plugin options.
 * @returns `[codeInspectorPlugin, inspectorVitePlugin]` — nestable as one `PluginOption`.
 */
export function vite(options: IdeByebyeOptions = {}): VitePlugin[] {
    return [
        codeInspectorPlugin({ bundler: 'vite', ...codeInspectorDefaults(options) }),
        unplugin.vite(options),
    ] as VitePlugin[];
}

/**
 * webpack entry. Registers code-inspector (`bundler: 'webpack'`) and injects the bootstrap into emitted HTML.
 *
 * @param {Record<string, unknown>} [options] Plugin options.
 * @returns {object} webpack plugin instance.
 */
export function webpack(options: IdeByebyeOptions = {}): PluginInstance {
    return unplugin.webpack(options);
}

/**
 * rspack entry. Same contract as {@link webpack}; rspack reuses code-inspector's webpack adapter.
 *
 * @param {Record<string, unknown>} [options] Plugin options.
 * @returns {object} rspack plugin instance.
 */
export function rspack(options: IdeByebyeOptions = {}): PluginInstance {
    return unplugin.rspack(options);
}

/**
 * rsbuild entry. Registers code-inspector on the underlying rspack chain and injects bootstrap tags via
 * `modifyHTMLTags`. Zero-config: `plugins: [inspector()]`.
 *
 * @param {Record<string, unknown>} [options] Plugin options.
 * @returns {object} rsbuild plugin instance.
 */
export function rsbuild(options: IdeByebyeOptions = {}): PluginInstance {
    return unplugin.rsbuild(options);
}

/**
 * Farm entry. Registers code-inspector through its Vite-compatible adapter (Farm has no dedicated code-inspector
 * bundler id) and injects the bootstrap through Farm's `transformHtml` hook.
 *
 * @param {Record<string, unknown>} [options] Plugin options.
 * @returns {object[]} `[codeInspectorPlugin, inspectorFarmPlugin]`.
 */
export function farm(options: IdeByebyeOptions = {}): PluginInstance[] {
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
export function esbuild(options: IdeByebyeOptions = {}): PluginInstance[] {
    return [
        codeInspectorPlugin({ bundler: 'esbuild', ...codeInspectorDefaults(options) }),
        unplugin.esbuild(options),
    ];
}

/**
 * Turbopack rules for Next.js (`turbopack.rules` on Next ≥ 15.3, `experimental.turbo.rules` before).
 *
 * Returns code-inspector's `data-insp-path` rules plus the ide-byebye entry loader, and (in `next dev`) starts the
 * inspector server and writes the bootstrap module the loader mounts into root layouts / `_app` — so this export alone
 * is now zero-config. Prefer {@link https://github.com/bo-516/ide-byebye#nextjs `ide-byebye/next`}, which also wires
 * `next dev --webpack` and picks the right config key for the installed Next version.
 *
 * Boundary: returns `{}` outside development so production builds are untouched.
 *
 * @param {Record<string, unknown>} [options] Plugin options.
 * @returns {object} Turbopack rules object.
 */
export function turbopack(options: IdeByebyeOptions = {}): PluginInstance {
    return nextTurbopackRules(options);
}

/**
 * Mako entry (Umi). Returns the Mako plugin from code-inspector. Same bootstrap caveat as {@link turbopack}: Mako
 * injects `data-insp-path`, but the inspector client still needs an HTML entry that loads our loopback bootstrap.
 *
 * @param {Record<string, unknown>} [options] Plugin options.
 * @returns {object} Mako plugin instance.
 */
export function mako(options: IdeByebyeOptions = {}): PluginInstance {
    return codeInspectorPlugin({ bundler: 'mako', ...codeInspectorDefaults(options) });
}

/**
 * Back-compatible default: the Vite entry. Existing configs that do `plugins: [codeIntentInspectorPlugin(options)]`
 * keep working and get code-inspector wired for free.
 */
export const codeIntentInspectorPlugin: typeof vite = vite;
