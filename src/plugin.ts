import fs from 'node:fs';
import { createUnplugin } from 'unplugin';
import {
    PLUGIN_NAME,
    createInspectorRuntime,
} from './server/plugin-runtime.js';
import { createMakoStampPlugin, stampUnplugin } from './server/stamp/stamp-unplugin.js';
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

export { PLUGIN_NAME } from './server/plugin-runtime.js';


/**
 * The shared, bundler-agnostic factory passed to `createUnplugin`.
 *
 * Purpose: one inspector instance per plugin usage. Bundler-specific surface is limited to HTML injection + when to
 * start the loopback server. Vite uses `transformIndexHtml` and, for SSR frameworks whose HTML never reaches that hook
 * (Nuxt, SvelteKit, SolidStart, Astro, …), appends an idempotent JS bootstrap to `/@vite/client`; webpack/rspack
 * rewrite emitted `.html` assets; rsbuild uses `modifyHTMLTags`; farm uses `transformHtml`; esbuild starts the server
 * and rewrites HTML files listed via `options.htmlFiles` (or any `*.html` next to `outdir`/`outfile` after the build).
 *
 * Boundary: Vite / farm / esbuild entry helpers register the stamp plugin themselves because those ecosystems need a
 * separate plugin instance ahead of the framework transform. webpack / rspack register it from the compiler hook.
 * When `options.enabled` is false nothing is started or injected.
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
         * rsbuild (rspack-based). Registers the stamp transform on the rspack chain and injects bootstrap tags into the
         * generated HTML. Dev-only: production (`NODE_ENV=production`) skips both the stamp and the inject.
         */
        rsbuild: {
            name: PLUGIN_NAME,
            setup(api) {
                if (!runtime.enabled) {
                    return;
                }
                api.modifyRspackConfig((config) => {
                    if (process.env.NODE_ENV === 'production')
                        return config;
                    const plugins = config.plugins || (config.plugins = []);
                    plugins.push(stampUnplugin.rspack(options));
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
         * Farm. HTML injection and server lifecycle live here. The {@link farm} export registers the stamp plugin
         * alongside this one.
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
 * Vite entry. Returns an array so the stamp plugin (which must run before the framework transform to inject
 * `data-insp-path`) is registered alongside our inspector with zero config.
 *
 * Return type is {@link VitePlugin}`[]` (not `object[]`) so nested placement in Vite's `plugins`
 * typechecks as `PluginOption` without an `as PluginOption` cast:
 * `plugins: [ideByebye({ recording: false }), vue()]`.
 *
 * @param options Plugin options.
 * @returns `[stampPlugin, inspectorVitePlugin]` — nestable as one `PluginOption`.
 */
export function vite(options: IdeByebyeOptions = {}): VitePlugin[] {
    return [
        stampUnplugin.vite(options) as VitePlugin,
        unplugin.vite(options) as VitePlugin,
    ];
}

/**
 * webpack entry. Registers the stamp transform when `mode !== 'production'` and injects the bootstrap into emitted HTML.
 *
 * @param {Record<string, unknown>} [options] Plugin options.
 * @returns {object} webpack plugin instance.
 */
export function webpack(options: IdeByebyeOptions = {}): PluginInstance {
    return unplugin.webpack(options);
}

/**
 * rspack entry. Same contract as {@link webpack}.
 *
 * @param {Record<string, unknown>} [options] Plugin options.
 * @returns {object} rspack plugin instance.
 */
export function rspack(options: IdeByebyeOptions = {}): PluginInstance {
    return unplugin.rspack(options);
}

/**
 * rsbuild entry. Registers the stamp transform on the underlying rspack chain and injects bootstrap tags via
 * `modifyHTMLTags`. Zero-config: `plugins: [inspector()]`.
 *
 * @param {Record<string, unknown>} [options] Plugin options.
 * @returns {object} rsbuild plugin instance.
 */
export function rsbuild(options: IdeByebyeOptions = {}): PluginInstance {
    return unplugin.rsbuild(options);
}

/**
 * Farm entry. Registers the stamp transform and injects the bootstrap through Farm's `transformHtml` hook.
 *
 * @param {Record<string, unknown>} [options] Plugin options.
 * @returns {object[]} `[stampPlugin, inspectorFarmPlugin]`.
 */
export function farm(options: IdeByebyeOptions = {}): PluginInstance[] {
    return [
        stampUnplugin.farm(options),
        unplugin.farm(options),
    ];
}

/**
 * esbuild entry. Stamps JSX by default in dev (`NODE_ENV` other than `production`) and rewrites HTML with the bootstrap.
 *
 * Pass `htmlFiles: ['./index.html']` when the HTML is not emitted into `outdir` (typical for a custom static server
 * that reads a source HTML and serves the esbuild bundle). After `context.rebuild()` / `build()`, those files are
 * rewritten in place with the bootstrap snippet (idempotent).
 *
 * @param {Record<string, unknown>} [options] Plugin options; may include `htmlFiles: string[]`.
 * @returns {object[]} `[stampEsbuildPlugin, inspectorEsbuildPlugin]`.
 */
export function esbuild(options: IdeByebyeOptions = {}): PluginInstance[] {
    return [
        stampUnplugin.esbuild(options),
        unplugin.esbuild(options),
    ];
}

/**
 * Turbopack rules for Next.js (`turbopack.rules` on Next ≥ 15.3, `experimental.turbo.rules` before).
 *
 * Returns the built-in stamp loader plus the ide-byebye entry loader, and (in `next dev`) starts the
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
 * Mako entry (Umi). Returns the stamp plugin. Same bootstrap caveat as {@link turbopack}: Mako
 * injects `data-insp-path`, but the inspector client still needs an HTML entry that loads our loopback bootstrap.
 *
 * @param {Record<string, unknown>} [options] Plugin options.
 * @returns {object} Mako plugin `{ name, enforce: 'pre', transform }`.
 */
export function mako(options: IdeByebyeOptions = {}): PluginInstance {
    return createMakoStampPlugin(options);
}

/**
 * Back-compatible default: the Vite entry. Existing configs that do `plugins: [codeIntentInspectorPlugin(options)]`
 * keep working and get source stamping wired for free.
 */
export const codeIntentInspectorPlugin: typeof vite = vite;
