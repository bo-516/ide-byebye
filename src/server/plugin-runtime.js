import crypto from 'node:crypto';
import path from 'node:path';
import { codeInspectorPlugin } from 'code-inspector-plugin';
import { CLIENT_CONFIG_GLOBAL, ENDPOINTS, ROUTE_PREFIX } from '../shared/constants.js';
import { resolveOptions } from './config.js';
import { buildRegistry } from './agents/build.js';
import { SessionStore } from './session-store.js';
import { createLogger } from './logger.js';
import { createInspectorServer } from './inspector-server.js';
import { cleanupNonScreenshotArtifacts } from './output-cleanup.js';
import { loadClientCode } from './client-code.js';

export const PLUGIN_NAME = 'code-intent-inspector';

/**
 * Build the zero-config option set forwarded to `code-inspector-plugin`.
 *
 * Purpose: `code-inspector-plugin` injects the `data-insp-path` attribute we read back to resolve a clicked element to
 * its source. Safe defaults disable code-inspector's own jump-to-source / copy hotkeys so they never clash with our
 * ⌘/ctrl-click gesture, and emit absolute source paths.
 *
 * Boundary: `bundler` is intentionally NOT set here — each adapter fills it from the bundler it runs under. Everything
 * is overridable through `options.codeInspector`; passing `behavior` there is shallow-merged over the defaults.
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
 * @param {ReturnType<typeof resolveOptions>} resolved Resolved plugin options.
 * @param {ReturnType<typeof buildRegistry>} registry Enabled agent registry.
 * @param {string} token Per-process dev token.
 * @param {string} origin Absolute origin of the standalone inspector server.
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
 * Splice the bootstrap snippet into an HTML document's `<head>` (or prepend when no head exists).
 *
 * @param {string} html Original HTML.
 * @param {string} snippet Script tags to inject.
 * @returns {string} HTML with the inspector bootstrap injected.
 */
export function injectHtmlSnippet(html, snippet) {
    return html.includes('</head>')
        ? html.replace('</head>', `${snippet}</head>`)
        : snippet + html;
}

/**
 * Create one inspector runtime (token, registry, loopback server, HTML injection helpers).
 *
 * Purpose: every bundler adapter shares this runtime. It owns the per-process token, agent registry, and the standalone
 * inspector HTTP server (started lazily and reused across rebuilds). Bundler adapters only decide *when* to start it and
 * *how* to inject the two bootstrap tags into the page.
 *
 * Boundary: the server binds loopback only. When `options.enabled` is false no server starts and injection is a no-op.
 * Callers must pass a real project root into `initPaths` once they know it (Vite `config.root`, webpack `compiler.context`).
 *
 * @param {Record<string, unknown>} [options] Raw plugin options from the host bundler config.
 * @returns {{
 *   resolved: ReturnType<typeof resolveOptions>,
 *   enabled: boolean,
 *   initPaths: (rootDir?: string) => void,
 *   ensureServer: () => Promise<{ origin: string }>,
 *   injectionTags: () => Promise<Array<Record<string, unknown>>>,
 *   injectionHtml: () => Promise<string>,
 *   applyCodeInspector: (bundler: string, applyTarget: { apply?: Function, setup?: Function }) => void,
 *   registerCodeInspectorOnCompiler: (compiler: object, bundler: 'webpack' | 'rspack') => void,
 *   projectRoot: () => string,
 * }} Shared runtime used by every bundler adapter.
 */
export function createInspectorRuntime(options = {}) {
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

    function initPaths(rootDir) {
        ctx.projectRoot = rootDir || process.cwd();
        ctx.outputDirAbs = path.resolve(ctx.projectRoot, resolved.outputDir);
        ctx.logger = createLogger(ctx.outputDirAbs);
        ctx.sessionStore = new SessionStore(ctx.outputDirAbs);
    }

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

    /** Vite / rsbuild tag-descriptor form: config global + module script that loads client.js. */
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

    /** Raw HTML string form for webpack/rspack/farm/esbuild HTML rewrites. */
    async function injectionHtml() {
        const [configTag, scriptTag] = await injectionTags();
        return `<script>${configTag.children}</script>` +
            `<script type="module" src="${scriptTag.attrs.src}"></script>`;
    }

    /**
     * Apply code-inspector for a webpack-like compiler (`apply`) or an esbuild plugin (`setup`).
     * Failures are logged and swallowed so a missing peer never crashes the host bundler.
     */
    function registerCodeInspectorOnCompiler(compiler, bundler) {
        try {
            codeInspectorPlugin({ bundler, ...codeInspectorDefaults(options) }).apply(compiler);
        }
        catch (err) {
            ctx.logger?.warn?.(`code-inspector (${bundler}) not applied: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    return {
        resolved,
        get enabled() {
            return resolved.enabled !== false;
        },
        initPaths(rootDir) {
            initPaths(rootDir);
            cleanupNonScreenshotArtifacts(ctx.outputDirAbs, ctx.projectRoot);
        },
        ensureServer,
        injectionTags,
        injectionHtml,
        registerCodeInspectorOnCompiler,
        projectRoot() {
            return ctx.projectRoot;
        },
        /** Absolute path to the artifact dir — used by esbuild demos that rewrite HTML next to the build. */
        outputDirAbs() {
            return ctx.outputDirAbs;
        },
    };
}

/**
 * webpack/rspack-style HTML injection via `processAssets` at REPORT stage.
 *
 * Boundary: skips production mode so the inspector never ships. Mutates every emitted `.html` asset.
 *
 * @param {object} compiler webpack/rspack compiler.
 * @param {ReturnType<typeof createInspectorRuntime>} runtime Shared inspector runtime.
 * @param {'webpack' | 'rspack'} bundler Which code-inspector adapter to register.
 */
export function setupWebpackLikeCompiler(compiler, runtime, bundler) {
    if (!runtime.enabled) {
        return;
    }
    if (compiler?.options?.mode === 'production') {
        return;
    }
    runtime.initPaths(compiler?.context || process.cwd());
    runtime.registerCodeInspectorOnCompiler(compiler, bundler);

    const wp = compiler.webpack || compiler.rspack;
    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
        compilation.hooks.processAssets.tapPromise({
            name: PLUGIN_NAME,
            stage: wp.Compilation.PROCESS_ASSETS_STAGE_REPORT,
        }, async (assets) => {
            const snippet = await runtime.injectionHtml();
            for (const name of Object.keys(assets)) {
                if (!/\.html$/.test(name)) {
                    continue;
                }
                const original = assets[name].source().toString();
                compilation.updateAsset(name, new wp.sources.RawSource(injectHtmlSnippet(original, snippet)));
            }
        });
    });
}
