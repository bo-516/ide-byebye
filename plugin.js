import crypto from 'node:crypto';
import path from 'node:path';
import { CLIENT_CONFIG_GLOBAL, ENDPOINTS, ROUTE_PREFIX, TOKEN_HEADER } from './shared/constants.js';
import { resolveOptions } from './server/config.js';
import { buildRegistry } from './server/agents/build.js';
import { SessionStore } from './server/session-store.js';
import { createLogger } from './server/logger.js';
import { registerIntentInspectorRoutes } from './server/routes.js';
import { cleanupNonScreenshotArtifacts } from './server/output-cleanup.js';
import { loadClientCode } from './server/client-code.js';
const PLUGIN_NAME = 'vite-plugin-code-intent-inspector';
const INSPECTOR_DEV_SERVER_CORS = {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', TOKEN_HEADER],
};

/**
 * Resolves the browser-reachable loopback origin for inspector API calls.
 *
 * Boundary: this intentionally avoids request `Host` headers, because a custom business dev domain would make the
 * browser call that domain for `__intent-inspector` routes. If Vite has moved to a fallback port, the live HTTP server
 * address wins; if it is unavailable, the configured port is used. A missing server falls back to the conventional Vite
 * port, which may be wrong until the dev server is available.
 *
 * @param {ReturnType<typeof resolveOptions>} resolved Resolved plugin options; `apiOrigin` overrides auto-detection.
 * @param {import('vite').ViteDevServer | null} server Current Vite dev server, when configured.
 * @returns {string} Absolute origin such as `http://127.0.0.1:8888`.
 */
function resolveInspectorApiOrigin(resolved, server) {
    if (resolved.apiOrigin) {
        return resolved.apiOrigin;
    }

    const address = server?.httpServer?.address();
    const livePort = address && typeof address === 'object' ? address.port : undefined;
    const configuredPort = server?.config?.server?.port;
    const port = livePort ?? configuredPort ?? 5173;
    const protocol = server?.config?.server?.https ? 'https' : 'http';

    return `${protocol}://127.0.0.1:${port}`;
}

/**
 * Joins an inspector origin and endpoint path.
 *
 * Boundary: `origin` must be an absolute origin without a trailing slash and `endpoint` must begin with `/`; malformed
 * values produce a browser URL that can point away from the local inspector server.
 *
 * @param {string} origin Absolute inspector API origin.
 * @param {string} endpoint Inspector endpoint path.
 * @returns {string} Absolute inspector endpoint URL.
 */
function resolveInspectorEndpointUrl(origin, endpoint) {
    return `${origin}${endpoint}`;
}

/**
 * Creates the Vite plugin that injects and serves the code-intent inspector.
 *
 * Boundary: this plugin only applies to `vite serve`. It injects a browser client configured with a local `apiOrigin`,
 * serves the browser runtime from either an embedded single-file bundle or `client.js`, and registers local inspector
 * routes; passing malformed options can disable agents, point the browser at the wrong origin, or prevent route
 * resolution from reaching the dev server.
 *
 * @param {Record<string, unknown>} options Partial inspector options supplied by local Vite config.
 * @returns {import('vite').Plugin} Vite plugin that injects the inspector client and API middleware.
 */
export function codeIntentInspectorPlugin(options = {}) {
    const resolved = resolveOptions(options);
    const token = crypto.randomUUID();
    let projectRoot = process.cwd();
    let outputDirAbs = path.resolve(projectRoot, resolved.outputDir);
    let logger = createLogger(outputDirAbs);
    let registry = buildRegistry(resolved.agents);
    let sessionStore = new SessionStore(outputDirAbs);
    let viteServer = null;
    let clientConfig = makeClientConfig(resolved, registry, token, viteServer);
    return {
        name: PLUGIN_NAME,
        apply: 'serve',
        enforce: 'pre',
        config() {
            return {
                server: {
                    cors: INSPECTOR_DEV_SERVER_CORS,
                },
            };
        },
        configResolved(config) {
            projectRoot = config.root;
            outputDirAbs = path.resolve(projectRoot, resolved.outputDir);
            logger = createLogger(outputDirAbs);
            registry = buildRegistry(resolved.agents);
            sessionStore = new SessionStore(outputDirAbs);
            clientConfig = makeClientConfig(resolved, registry, token, viteServer);
        },
        transformIndexHtml: {
            order: 'post',
            handler(html) {
                if (!resolved.enabled)
                    return html;
                clientConfig = makeClientConfig(resolved, registry, token, viteServer);
                return {
                    html,
                    tags: [
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
                                src: `${resolveInspectorEndpointUrl(clientConfig.apiOrigin, ENDPOINTS.client)}?token=${token}`,
                            },
                        },
                    ],
                };
            },
        },
        configureServer(server) {
            if (!resolved.enabled) {
                logger.info('disabled via options.enabled = false');
                return;
            }
            viteServer = server;
            clientConfig = makeClientConfig(resolved, registry, token, viteServer);
            cleanupNonScreenshotArtifacts(outputDirAbs, projectRoot);
            let clientCode;
            try {
                clientCode = loadClientCode({ pluginName: PLUGIN_NAME });
            }
            catch (err) {
                // Keep the API routes working even if the browser bundle is missing
                // (e.g. during tests before a build); the page just gets a no-op script.
                logger.warn(err instanceof Error ? err.message : String(err));
                clientCode = `console.warn(${JSON.stringify('[code-intent-inspector] client bundle missing; expected core/client.js, dist/client.js, or an embedded single-file bundle.')});`;
            }
            registerIntentInspectorRoutes({
                server,
                projectRoot,
                outputDirAbs,
                options: resolved,
                token,
                registry,
                sessionStore,
                logger,
                clientCode,
            });
            logger.info(`enabled. hotkey=${resolved.hotkey} defaultAgent=${clientConfig.defaultAgent} ` +
                `applyMode=${resolved.applyMode} agents=[${registry.names().join(', ')}]`);
        },
    };
}

/**
 * Creates the browser-facing inspector configuration.
 *
 * Boundary: the token is per dev-server process and must be carried into every inspector request. `apiOrigin` is always
 * absolute so browser fetches do not inherit the app's business domain; if the origin is wrong, the picker UI can load
 * but route resolution and agent sending will fail.
 *
 * @param {ReturnType<typeof resolveOptions>} resolved Resolved plugin options.
 * @param {ReturnType<typeof buildRegistry>} registry Enabled agent registry.
 * @param {string} token Per-process dev token.
 * @param {import('vite').ViteDevServer | null} server Current Vite dev server, when configured.
 * @returns {Record<string, unknown>} Browser client config injected into the served HTML.
 */
function makeClientConfig(resolved, registry, token, server) {
    const names = registry.names();
    const defaultAgent = registry.has(resolved.defaultAgent)
        ? resolved.defaultAgent
        : (names[0] ?? 'clipboard');
    return {
        token,
        routePrefix: ROUTE_PREFIX,
        hotkey: resolved.hotkey,
        clickModifier: resolved.clickModifier,
        defaultAgent,
        applyMode: resolved.applyMode,
        apiOrigin: resolveInspectorApiOrigin(resolved, server),
        codexDock: {
            enabled: resolved.codexDock.enabled,
            days: resolved.codexDock.days,
            models: resolved.codexDock.models,
        },
        enabledAgents: names,
        maxDomSnippetLength: resolved.maxDomSnippetLength,
    };
}
