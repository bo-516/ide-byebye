import http from 'node:http';
import { createInspectorRequestHandler } from './routes.js';

/**
 * Start a standalone loopback HTTP server that serves every inspector route.
 *
 * Purpose: this is the bundler-agnostic transport layer. Instead of mounting the inspector routes on the host
 * bundler's dev server (which only Vite exposes as connect middleware), each bundler adapter only injects a bootstrap
 * `<script>` carrying this server's absolute `origin`, and the browser talks to this server cross-origin. That keeps the
 * Vite / webpack / rspack adapters thin and identical at the transport level (the same pattern `code-inspector-plugin`
 * uses for its multi-bundler support).
 *
 * Boundary: binds to `127.0.0.1` on an ephemeral port (`listen(0)`) so it never collides with the app's dev server and
 * is unreachable off-loopback; the per-request token guard in {@link createInspectorRequestHandler} still gates the API
 * routes. The returned handler is rebuilt by `updateDeps` so a config/HMR reload swaps in fresh `clientCode`/registry
 * without restarting the listener. Callers own the lifecycle: `close()` must be awaited in tests, while the plugin lets
 * the host dev process keep the server alive.
 *
 * @param {Parameters<typeof createInspectorRequestHandler>[0]} deps Inspector route dependencies (options, token,
 * registry, sessionStore, logger, clientCode, projectRoot, outputDirAbs). Passing incomplete deps makes the matching
 * route fail at request time, not here.
 * @returns {Promise<{ server: import('node:http').Server, port: number, origin: string, updateDeps: (next: Parameters<typeof createInspectorRequestHandler>[0]) => void, close: () => Promise<void> }>} Resolves once the
 * socket is listening; `origin` is the absolute base URL (e.g. `http://127.0.0.1:51234`) to embed in the page.
 */
export function createInspectorServer(deps) {
    let handler = createInspectorRequestHandler(deps);
    const server = http.createServer((req, res) => {
        handler(req, res, () => {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end('Not found');
        });
    });

    return new Promise((resolve, reject) => {
        const onError = (err) => reject(err);
        server.once('error', onError);
        server.listen(0, '127.0.0.1', () => {
            server.removeListener('error', onError);
            const address = server.address();
            const port = address && typeof address === 'object' ? address.port : 0;
            resolve({
                server,
                port,
                origin: `http://127.0.0.1:${port}`,
                updateDeps(next) {
                    handler = createInspectorRequestHandler(next);
                },
                close() {
                    return new Promise((done) => server.close(() => done()));
                },
            });
        });
    });
}
