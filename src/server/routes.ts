import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ENDPOINTS, ROUTE_PREFIX } from '../shared/constants.js';
import { isLocalHostHeader, isLocalRequest, isSameOriginPageRequest, readToken, tokenMatches } from './security.js';
import { buildIntentRequest, resolveSelection } from './pipeline.js';
import type { IntentPayload } from './pipeline.js';
import { buildPrompt, buildPromptReferenceLines } from './prompt.js';
import { saveScreenshotPayloads, saveRecordingPayloads } from './screenshot.js';
import { cleanupInspectorArtifacts } from './output-cleanup.js';
import { resolveVendorEsmPath } from './vendor.js';
import { gateSendTarget, handleSessionsGet } from './routes-sessions.js';
import { pathname, readJsonBody, readOrigin, sendJson, setTokenCorsHeaders } from './routes-http.js';
import type { InspectorRouteDeps } from './routes-types.js';

export type { InspectorRouteDeps } from './routes-types.js';

/**
 * Builds the bundler-agnostic connect-style request handler that serves every inspector route.
 *
 * Boundary: the returned `(req, res, next)` handler is transport-neutral — it reads only Node `http` primitives, so it
 * can be mounted on a standalone `http.Server` (the default), a Vite/webpack/rspack dev server, or any connect stack.
 * Routes are served only under `ROUTE_PREFIX`; non-matching requests fall through to `next()`. API routes require the
 * per-process token, and cross-origin calls are accepted only when that token is present so pages opened through a
 * business dev domain can still reach the local `ip:port` inspector server. Passing incomplete `deps` (missing
 * `clientCode`, `registry`, `projectRoot`, `outputDirAbs`, …) makes the matching route fail at request time rather than
 * at setup. Note this no longer takes a `server`; the caller mounts the handler.
 *
 * @param {InspectorRouteDeps} deps Inspector route dependencies. A missing `session` skips the Angular handoff.
 * @returns {(req: IncomingMessage, res: ServerResponse, next: () => void) => void} Connect-style inspector request handler.
 */
export function createInspectorRequestHandler(deps: InspectorRouteDeps) {
    const { options, token, registry, sessionStore, logger } = deps;
    const guard = (req: IncomingMessage, res: ServerResponse) => {
        const hasValidToken = tokenMatches(token, readToken(req));
        const hasTokenCors = readOrigin(req) != null && hasValidToken;

        if (!hasValidToken) {
            sendJson(res, 403, { ok: false, error: 'Invalid or missing dev token' });
            return false;
        }

        if (!isLocalRequest(req) && !hasTokenCors) {
            sendJson(res, 403, { ok: false, error: 'Request origin is not local' });
            return false;
        }
        return true;
    };
    const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = pathname(req);
        if (!url.startsWith(ROUTE_PREFIX)) {
            next();
            return;
        }
        setTokenCorsHeaders(req, res, token);
        if (req.method === 'OPTIONS') {
            if (!tokenMatches(token, readToken(req))) {
                sendJson(res, 403, { ok: false, error: 'Invalid or missing dev token' });
                return;
            }
            res.statusCode = 204;
            res.end();
            return;
        }
        // --- GET /client.js -----------------------------------------------------
        if (url === ENDPOINTS.client && req.method === 'GET') {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(deps.clientCode);
            return;
        }
        // --- GET /vendor/:name --------------------------------------------------
        // Serves an optional browser library (rrweb record/replay) resolved from the
        // host project's node_modules, so the recording feature lazy-loads it by URL
        // instead of bloating the embedded single-file client. Served like client.js:
        // public, token only carried in the URL so cross-origin imports get CORS.
        if (url.startsWith(`${ENDPOINTS.vendor}/`) && req.method === 'GET') {
            const name = url.slice(ENDPOINTS.vendor.length + 1);
            try {
                const file = resolveVendorEsmPath(name, deps.projectRoot);
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
                res.setHeader('Cache-Control', 'public, max-age=3600');
                res.end(fs.readFileSync(file, 'utf8'));
            }
            catch (err) {
                sendJson(res, 404, { ok: false, error: err instanceof Error ? err.message : String(err) });
            }
            return;
        }
        // --- GET /ping ----------------------------------------------------------
        // Liveness for another process deciding whether this server still backs a generated bootstrap module.
        // Token-guarded and data-free: it confirms only that the holder of this token reached this server.
        if (url === ENDPOINTS.ping && req.method === 'GET') {
            if (!guard(req, res))
                return;
            sendJson(res, 200, { ok: true });
            return;
        }
        // --- GET /session -------------------------------------------------------
        // Angular CLI bootstrap only (`deps.session` exists only on runtimes created by `angularProxy`): the page asks
        // through the dev server's proxy for its config. It hands out the token, so it is limited to same-origin page
        // fetches on a local Host (DNS-rebinding defense) and served as non-executable JSON.
        if (url === ENDPOINTS.session && req.method === 'GET') {
            if (typeof deps.session !== 'function') {
                next();
                return;
            }
            if (!isLocalHostHeader(req) || !isSameOriginPageRequest(req)) {
                sendJson(res, 403, { ok: false, error: 'Session is only available to same-origin local pages' });
                return;
            }
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
            sendJson(res, 200, { ok: true, ...deps.session() });
            return;
        }
        // --- GET /sessions ------------------------------------------------------
        // Project session catalog. Must stay plural: GET /session is the Angular bootstrap handoff above.
        if (url === ENDPOINTS.sessions && req.method === 'GET') {
            if (!guard(req, res))
                return;
            handleSessionsGet(req, res, deps).catch(() => sendJson(res, 500, { ok: false, error: 'Session list failed' }));
            return;
        }
        // --- GET /agents --------------------------------------------------------
        if (url === ENDPOINTS.agents && req.method === 'GET') {
            if (!guard(req, res))
                return;
            registry
                .listAvailable()
                .then((agents) => {
                const response = {
                    agents,
                    defaultAgent: registry.has(options.defaultAgent)
                        ? options.defaultAgent
                        : (registry.names()[0] ?? 'clipboard'),
                };
                sendJson(res, 200, response);
            })
                .catch((err) => sendJson(res, 500, { error: String(err) }));
            return;
        }
        // --- POST /resolve ------------------------------------------------------
        if (url === ENDPOINTS.resolve && req.method === 'POST') {
            if (!guard(req, res))
                return;
            readJsonBody<IntentPayload>(req)
                .then((payload) => {
                try {
                    const resolved = resolveSelection(payload, deps.projectRoot, options);
                    const request = buildIntentRequest(payload, resolved, deps.projectRoot, options);
                    const pathOptions = {
                        pathStyle: options.pathStyle,
                        artifactPathStyle: options.artifactPathStyle,
                    };
                    const response = {
                        ok: true,
                        selection: resolved.selection,
                        source: resolved.source,
                        reference: buildPromptReferenceLines(request, pathOptions)[0],
                        prompt: buildPrompt(request, pathOptions),
                    };
                    sendJson(res, 200, response);
                }
                catch (err) {
                    sendJson(res, 200, {
                        ok: false,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            })
                .catch((err) => sendJson(res, 400, { ok: false, error: String(err) }));
            return;
        }
        // --- POST /send ---------------------------------------------------------
        if (url === ENDPOINTS.send && req.method === 'POST') {
            if (!guard(req, res))
                return;
            readJsonBody<IntentPayload>(req)
                .then(async (payload) => {
                try {
                    // A target is revalidated before screenshots, launchers, or app opens. No target keeps today's path.
                    const targetGate = await gateSendTarget(payload, deps);
                    if (targetGate.blocked) {
                        sendJson(res, 200, targetGate.body);
                        return;
                    }
                    if (!registry.has(payload.agent)) {
                        throw new Error(`Agent "${payload.agent}" is not enabled`);
                    }
                    // Age out old handoffs only. This send's file does not exist yet, and a recent one stays for the agent.
                    cleanupInspectorArtifacts(deps.outputDirAbs, deps.projectRoot);
                    const resolved = resolveSelection(payload, deps.projectRoot, options);
                    const request = buildIntentRequest(payload, resolved, deps.projectRoot, options);
                    request.screenshots = saveScreenshotPayloads(payload.screenshots ?? (payload.screenshot ? [payload.screenshot] : undefined), request, deps.outputDirAbs);
                    request.screenshot = request.screenshots?.[0];
                    request.recordings = saveRecordingPayloads(payload.recordings, request, deps.outputDirAbs);
                    const prompt = buildPrompt(request, {
                        pathStyle: options.pathStyle,
                        artifactPathStyle: options.artifactPathStyle,
                    });
                    const events: unknown[] = [];
                    const context = {
                        projectRoot: deps.projectRoot,
                        outputDir: deps.outputDirAbs,
                        prompt,
                        sessionStore,
                        logger,
                        emit: (event: unknown) => events.push(event),
                        ...(targetGate.session ? { targetSession: targetGate.session } : {}),
                    };
                    logger.audit({
                        kind: 'send',
                        requestId: request.id,
                        agent: request.agent,
                        applyMode: request.applyMode,
                        file: request.selection.file,
                        line: request.selection.line,
                    });
                    const adapter = registry.get(payload.agent);
                    const availability = await adapter.isAvailable();
                    if (!availability.available) {
                        const reason = availability.reason ?? `Agent "${payload.agent}" is currently unavailable`;
                        logger.audit({
                            kind: 'result',
                            requestId: request.id,
                            agent: request.agent,
                            ok: false,
                            error: reason,
                        });
                        sendJson(res, 200, {
                            ok: false,
                            agent: payload.agent,
                            requestId: request.id,
                            events: [{ type: 'failed', text: reason }],
                            error: reason,
                        });
                        return;
                    }
                    const result = await adapter.send(request, context);
                    // Merge any events the adapter emitted but didn't include.
                    const merged = {
                        ...result,
                        events: result.events && result.events.length ? result.events : events,
                    };
                    logger.audit({
                        kind: 'result',
                        requestId: request.id,
                        agent: result.agent,
                        ok: result.ok,
                        error: result.error,
                    });
                    sendJson(res, 200, merged);
                }
                catch (err) {
                    const error = err instanceof Error ? err.message : String(err);
                    logger.error('send failed:', error);
                    sendJson(res, 200, {
                        ok: false,
                        agent: payload?.agent,
                        requestId: '',
                        error,
                    });
                }
            })
                .catch((err) => sendJson(res, 400, { ok: false, error: String(err) }));
            return;
        }
        next();
    };
    return handler;
}
