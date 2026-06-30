import crypto from 'node:crypto';
import path from 'node:path';
import { createUnplugin } from 'unplugin';
import { codeInspectorPlugin } from 'code-inspector-plugin';
import { CLIENT_CONFIG_GLOBAL, ENDPOINTS, ROUTE_PREFIX } from './src/shared/constants.js';
import { resolveOptions } from './src/server/config.js';
import { buildRegistry } from './src/server/agents/build.js';
import { SessionStore } from './src/server/session-store.js';
import { createLogger } from './src/server/logger.js';
import { createInspectorServer } from './src/server/inspector-server.js';
import { cleanupNonScreenshotArtifacts } from './src/server/output-cleanup.js';
import { loadClientCode } from './src/server/client-code.js';

const PLUGIN_NAME = 'code-intent-inspector';

/**
 * Build the zero-config option set forwarded to `code-inspector-plugin`.
 *
 * Purpose: `code-inspector-plugin` injects the `data-insp-path` attribute we read back to resolve a clicked element to
 * its source. The user used to wire it by hand (`bundler`, `pathType`, `hotKeys`, `behavior`); we now register it for
 * them with safe defaults so the plugin starts with no config. The defaults disable code-inspector's own jump-to-source
 * / copy hotkeys so they never clash with our ⌘/ctrl-click gesture, and emit absolute source paths.
 *
 * Boundary: `bundler` is intentionally NOT set here — each adapter fills it from the bundler it runs under, so callers
 * never pass it. Everything is overridable through `options.codeInspector`; passing `behavior` there is shallow-merged
 * over the defaults so a caller can flip one flag without losing the others.
 *
 * @param {Record<string, unknown>} options Raw plugin options; only `options.codeInspector` is consulted.
 * @returns {Record<string, unknown>} Options for `codeInspectorPlugin`, minus `bundler`.
 */
export function codeInspectorDefaults(options = {}) {
    const user = (options && typeof options.codeInspector === 'object' && options.codeInspector) || {};
    const { behavior: userBehavior, ...restUser } = user;
    return {
        pathType: 'absolute',
        hotKeys: false,
        ...restUser,
        behavior: { locate: false, copy: false, defaultAction: 'target', ...(userBehavior || {}) },
    };
}

/**
 * Creates the browser-facing inspector configuration injected into the page.
 *
 * Boundary: the token is per dev-server process and must be carried into every inspector request. `apiOrigin` is always
 * absolute and points at the standalone inspector server so browser fetches never inherit the app's business domain; an
 * explicit `resolved.apiOrigin` override wins over the live server origin. If the origin is wrong, the picker UI can
 * load but route resolution and agent sending fail.
 *
 * @param {ReturnType<typeof resolveOptions>} resolved Resolved plugin options.
 * @param {ReturnType<typeof buildRegistry>} registry Enabled agent registry.
 * @param {string} token Per-process dev token.
 * @param {string} origin Absolute origin of the standalone inspector server (e.g. `http://127.0.0.1:51234`).
 * @returns {Record<string, unknown>} Browser client config injected into the served HTML.
 */
function makeClientConfig(resolved, registry, token, origin) {
    const names = registry.names();
    const defaultAgent = registry.has(resolved.defaultAgent)
        ? resolved.defaultAgent
        : (names[0] ?? 'clipboard');
    return {
        token,
        routePrefix: ROUTE_PREFIX,
        locale: resolved.locale,
        hotkey: resolved.hotkey,
        clickModifier: resolved.clickModifier,
        defaultAgent,
        applyMode: resolved.applyMode,
        apiOrigin: resolved.apiOrigin || origin,
        recording: resolved.recording,
        enabledAgents: names,
        maxDomSnippetLength: resolved.maxDomSnippetLength,
    };
}

/**
 * The shared, bundler-agnostic factory passed to `createUnplugin`.
 *
 * Purpose: one inspector instance per plugin usage. It owns the per-process token, the agent registry, the standalone
 * inspector HTTP server (started lazily and reused across rebuilds), and the two `<script>` tags injected into the page
 * (the client config global + the module that loads `client.js` from the inspector origin). Bundler-specific surface is
 * tiny: Vite injects through `transformIndexHtml`, webpack/rspack inject emitted `.html` assets through
 * `compiler.hooks.emit`.
 *
 * Boundary: `meta.framework` selects the `bundler` value forwarded to `code-inspector-plugin` for the compiler-based
 * adapters; the Vite adapter registers code-inspector separately in {@link vite}. The inspector server binds loopback
 * only and is created once — subsequent `ensureServer` calls just refresh its handler deps. When `options.enabled` is
 * false no server starts and nothing is injected.
 *
 * @param {Record<string, unknown>} options Raw plugin options from the host bundler config.
 * @param {{ framework?: string }} meta unplugin meta; `framework` is one of `vite`/`webpack`/`rspack`/`rollup`/`esbuild`.
 * @returns {import('unplugin').UnpluginOptions} unplugin definition with Vite + webpack/rspack hooks.
 */
function inspectorFactory(options = {}, meta = {}) {
    const resolved = resolveOptions(options);
    const token = crypto.randomUUID();
    const ctx = {
        projectRoot: process.cwd(),
        outputDirAbs: path.resolve(process.cwd(), resolved.outputDir),
        logger: null,
        registry: buildRegistry(resolved.agents),
        sessionStore: null,
        clientCode: null,
        serverPromise: null,
    };

    /** (Re)initialize project-root-derived paths/objects once the real root is known (Vite config.root / compiler.context). */
    function initPaths(rootDir) {
        ctx.projectRoot = rootDir || process.cwd();
        ctx.outputDirAbs = path.resolve(ctx.projectRoot, resolved.outputDir);
        ctx.logger = createLogger(ctx.outputDirAbs);
        ctx.sessionStore = new SessionStore(ctx.outputDirAbs);
    }

    /** Lazily load (and cache) the browser bundle; a missing bundle degrades to a no-op warning instead of crashing. */
    function loadClient() {
        if (ctx.clientCode != null) {
            return ctx.clientCode;
        }
        try {
            ctx.clientCode = loadClientCode({ pluginName: PLUGIN_NAME });
        }
        catch (err) {
            ctx.logger?.warn?.(err instanceof Error ? err.message : String(err));
            ctx.clientCode = `console.warn(${JSON.stringify('[code-intent-inspector] client bundle missing; expected dist/client.js or an embedded single-file bundle.')});`;
        }
        return ctx.clientCode;
    }

    /** Snapshot of the dependencies the standalone server's request handler needs. */
    function serverDeps() {
        if (!ctx.logger) {
            initPaths(ctx.projectRoot);
        }
        return {
            options: resolved,
            token,
            registry: ctx.registry,
            sessionStore: ctx.sessionStore,
            logger: ctx.logger,
            clientCode: loadClient(),
            projectRoot: ctx.projectRoot,
            outputDirAbs: ctx.outputDirAbs,
        };
    }

    /** Start the inspector server once; later calls refresh its handler deps (HMR / config reload) and reuse the port. */
    async function ensureServer() {
        if (!ctx.serverPromise) {
            ctx.serverPromise = createInspectorServer(serverDeps());
            const info = await ctx.serverPromise;
            ctx.logger?.info?.(`enabled. inspector server ${info.origin} routes under ${ROUTE_PREFIX} ` +
                `hotkey=${resolved.hotkey} clickModifier=${resolved.clickModifier} agents=[${ctx.registry.names().join(', ')}]`);
            return info;
        }
        const info = await ctx.serverPromise;
        info.updateDeps(serverDeps());
        return info;
    }

    /** The two head tags (Vite tag-descriptor form): the config global + the module script that loads client.js. */
    async function injectionTags() {
        const { origin } = await ensureServer();
        const clientConfig = makeClientConfig(resolved, ctx.registry, token, origin);
        return [
            {
                tag: 'script',
                injectTo: 'head',
                children: `window.${CLIENT_CONFIG_GLOBAL}=${JSON.stringify(clientConfig)};`,
            },
            {
                tag: 'script',
                injectTo: 'head',
                attrs: {
                    type: 'module',
                    src: `${origin}${ENDPOINTS.client}?token=${token}`,
                },
            },
        ];
    }

    /** Same injection rendered as a raw HTML string, for bundlers that rewrite emitted `.html` assets (webpack/rspack). */
    async function injectionHtml() {
        const [configTag, scriptTag] = await injectionTags();
        return `<script>${configTag.children}</script>` +
            `<script type="module" src="${scriptTag.attrs.src}"></script>`;
    }

    /**
     * webpack/rspack adapter: register code-inspector for `data-insp-path`, then inject our bootstrap into every emitted
     * HTML asset's `<head>`. No dev-server middleware is touched — the browser reaches the standalone inspector server.
     */
    function setupCompiler(compiler) {
        if (!resolved.enabled) {
            return;
        }
        // Dev-only, mirroring the Vite adapter's `apply: 'serve'`: never inject the inspector or start its loopback
        // server in a production build.
        if (compiler?.options?.mode === 'production') {
            return;
        }
        initPaths(compiler?.context || process.cwd());
        cleanupNonScreenshotArtifacts(ctx.outputDirAbs, ctx.projectRoot);
        const bundler = meta.framework === 'rspack' ? 'rspack' : 'webpack';
        try {
            codeInspectorPlugin({ bundler, ...codeInspectorDefaults(options) }).apply(compiler);
        }
        catch (err) {
            ctx.logger?.warn?.(`code-inspector (${bundler}) not applied: ${err instanceof Error ? err.message : String(err)}`);
        }
        // Inject through processAssets (not the deprecated `emit` hook) at the REPORT stage so every emitted asset —
        // including HtmlWebpackPlugin's generated HTML — already exists, and `updateAsset` mutates it the webpack-5 way.
        // `compiler.webpack` is the webpack namespace (rspack exposes the same shape, with `compiler.rspack` as fallback).
        const wp = compiler.webpack || compiler.rspack;
        compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
            compilation.hooks.processAssets.tapPromise({
                name: PLUGIN_NAME,
                stage: wp.Compilation.PROCESS_ASSETS_STAGE_REPORT,
            }, async (assets) => {
                const snippet = await injectionHtml();
                for (const name of Object.keys(assets)) {
                    if (!/\.html$/.test(name)) {
                        continue;
                    }
                    const original = assets[name].source().toString();
                    const injected = original.includes('</head>')
                        ? original.replace('</head>', `${snippet}</head>`)
                        : snippet + original;
                    compilation.updateAsset(name, new wp.sources.RawSource(injected));
                }
            });
        });
    }

    return {
        name: PLUGIN_NAME,
        vite: {
            apply: 'serve',
            enforce: 'pre',
            configResolved(config) {
                if (resolved.enabled) {
                    initPaths(config.root);
                    cleanupNonScreenshotArtifacts(ctx.outputDirAbs, ctx.projectRoot);
                }
            },
            transformIndexHtml: {
                order: 'post',
                async handler(html) {
                    if (!resolved.enabled) {
                        return html;
                    }
                    return { html, tags: await injectionTags() };
                },
            },
        },
        webpack: setupCompiler,
        rspack: setupCompiler,
    };
}

/** The raw unplugin instance; exposes `.vite`/`.webpack`/`.rspack`/… framework entry points. */
const unplugin = createUnplugin(inspectorFactory);

/**
 * Vite entry. Returns an array so `code-inspector-plugin` (which must run as its own Vite plugin to inject
 * `data-insp-path` before the framework transform) is registered alongside our inspector with zero config.
 *
 * Boundary: `bundler` is fixed to `'vite'`; the caller passes neither `bundler` nor the code-inspector config. Nesting
 * a plugin array inside Vite's `plugins` is supported and flattened by Vite.
 *
 * @param {Record<string, unknown>} [options] Plugin options (agents, clickModifier, recording, codeInspector overrides…).
 * @returns {import('vite').Plugin[]} `[codeInspectorPlugin, inspectorVitePlugin]`.
 */
export function vite(options = {}) {
    return [
        codeInspectorPlugin({ bundler: 'vite', ...codeInspectorDefaults(options) }),
        unplugin.vite(options),
    ];
}

/**
 * webpack entry. The returned plugin registers code-inspector (bundler `'webpack'`) and injects the bootstrap itself, so
 * the caller adds only this one plugin and passes no `bundler`.
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
 * Back-compatible default: the Vite entry. Existing configs that do `plugins: [codeIntentInspectorPlugin(options)]`
 * keep working and now get code-inspector wired for free, so the hand-written `codeInspectorPlugin({...})` can be
 * removed from the host Vite config.
 */
export const codeIntentInspectorPlugin = vite;
