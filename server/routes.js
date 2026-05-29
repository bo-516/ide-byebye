import { ENDPOINTS, ROUTE_PREFIX, TOKEN_HEADER } from '../shared/constants.js';
import { isLocalRequest, readToken, tokenMatches } from './security.js';
import { buildCodexDockRequest, buildIntentRequest, resolveDockSelections, resolveSelection } from './pipeline.js';
import { buildPrompt, buildPromptReferenceLines } from './prompt.js';
import { saveScreenshotPayloads } from './screenshot.js';
import { cleanupNonScreenshotArtifacts } from './output-cleanup.js';
import { listProjectCodexSessions, parseCodexSessionMessages, parseCodexSessionMetrics, readLatestCodexSessionModel, resolveCodexProjectRoots } from './codex-sessions.js';
function sendJson(res, status, body) {
    const text = JSON.stringify(body);
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(text);
}

/**
 * Opens a POST-backed SSE response for long-running Codex turns.
 *
 * Boundary: this only sets headers and leaves token/origin validation to the caller. Calling it after writing JSON
 * headers would make the browser stream parser fail.
 *
 * @param {import('node:http').ServerResponse} res Response that will carry event-stream frames.
 * @returns {void}
 */
function startEventStream(res) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
}

/**
 * Writes one JSON payload as an SSE frame.
 *
 * Boundary: payloads must be JSON-serializable. Closed responses are ignored so disconnects do not throw while an agent
 * is still unwinding.
 *
 * @param {import('node:http').ServerResponse} res Open event-stream response.
 * @param {string} event Browser-visible SSE event name.
 * @param {unknown} data JSON-serializable event payload.
 * @returns {void}
 */
function writeEventStream(res, event, data) {
    if (res.writableEnded)
        return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data ?? {})}\n\n`);
}

/**
 * Creates the abort signal passed down into streaming agents.
 *
 * Boundary: the signal aborts only when the response closes before normal completion; non-stream callers can omit it.
 *
 * @param {import('node:http').ServerResponse} res Response whose premature close should abort the agent turn.
 * @returns {AbortSignal} Signal for agent SDK calls that support cancellation.
 */
function requestAbortSignal(res) {
    const controller = new AbortController();
    res.on('close', () => {
        if (!res.writableEnded)
            controller.abort();
    });
    return controller.signal;
}

function readJsonBody(req, limitBytes = 15_000_000) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > limitBytes) {
                reject(new Error('Request body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try {
                const text = Buffer.concat(chunks).toString('utf8');
                resolve(text ? JSON.parse(text) : {});
            }
            catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}
function pathname(req) {
    try {
        return new URL(req.url ?? '', 'http://localhost').pathname;
    }
    catch {
        return req.url ?? '';
    }
}
function searchParam(req, name) {
    try {
        return new URL(req.url ?? '', 'http://localhost').searchParams.get(name);
    }
    catch {
        return null;
    }
}

/**
 * Reads the request Origin header.
 *
 * Boundary: only a single string origin is accepted. Missing or malformed origin values return null and therefore do
 * not receive inspector CORS headers; callers must still perform token validation before trusting cross-origin access.
 *
 * @param {import('node:http').IncomingMessage} req Incoming dev-server request.
 * @returns {string | null} Request origin suitable for echoing into CORS headers, or null.
 */
function readOrigin(req) {
    const origin = req.headers.origin;
    return typeof origin === 'string' && origin ? origin : null;
}

/**
 * Appends `Origin` to the Vary response header without dropping existing values.
 *
 * Boundary: callers should use this only on inspector responses where CORS can vary by request origin. Passing a
 * response with a non-string Vary header leaves array handling to Node's normal header serialization.
 *
 * @param {import('node:http').ServerResponse} res Dev-server response.
 * @returns {void}
 */
function appendOriginVary(res) {
    const current = res.getHeader('Vary');
    if (!current) {
        res.setHeader('Vary', 'Origin');
        return;
    }

    const text = Array.isArray(current) ? current.join(', ') : String(current);
    if (!text.toLowerCase().split(',').map((value) => value.trim()).includes('origin')) {
        res.setHeader('Vary', `${text}, Origin`);
    }
}

/**
 * Adds CORS headers for token-authenticated inspector requests.
 *
 * Boundary: cross-origin inspector access is allowed only when the per-process token is present in the query or header.
 * Without this, pages opened through a custom business dev domain cannot call the local `ip:port/__intent-inspector`
 * server; with a wrong token, no CORS headers are emitted and the request is rejected by the route guard.
 *
 * @param {import('node:http').IncomingMessage} req Incoming dev-server request.
 * @param {import('node:http').ServerResponse} res Dev-server response.
 * @param {string} token Per-process dev token.
 * @returns {boolean} True when CORS headers were emitted for a valid token-bearing origin request.
 */
function setTokenCorsHeaders(req, res, token) {
    const origin = readOrigin(req);
    if (!origin || !tokenMatches(token, readToken(req))) {
        return false;
    }

    appendOriginVary(res);
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', `${TOKEN_HEADER}, Content-Type`);
    res.setHeader('Access-Control-Max-Age', '600');

    return true;
}

/**
 * Runs the shared Codex dock turn pipeline for both JSON and streaming routes.
 *
 * Boundary: `emit` receives progress events as they happen, while the returned result preserves the legacy final JSON
 * shape. Bad payloads or disabled agents throw/return exactly as the old route did.
 *
 * @param {{ payload: Record<string, unknown>, deps: Record<string, unknown>, options: Record<string, unknown>, registry: Record<string, unknown>, sessionStore: Record<string, unknown>, logger: Record<string, Function>, emit?: Function, signal?: AbortSignal }} args Turn execution dependencies.
 * @returns {Promise<Record<string, unknown>>} Final adapter result with legacy `events` fallback merged in.
 */
async function executeCodexDockTurn({ payload, deps, options, registry, sessionStore, logger, emit, signal }) {
    if (!registry.has('codex-sdk')) {
        throw new Error('Agent "codex-sdk" is not enabled');
    }
    cleanupNonScreenshotArtifacts(deps.outputDirAbs, deps.projectRoot);
    const resolved = resolveDockSelections(payload, deps.projectRoot, options);
    const request = buildCodexDockRequest(payload, resolved, deps.projectRoot, options);
    request.screenshots = saveScreenshotPayloads(payload.screenshots ?? (payload.screenshot ? [payload.screenshot] : undefined), request, deps.outputDirAbs);
    request.screenshot = request.screenshots?.[0];
    const prompt = buildPrompt(request);
    const events = [];
    const pushEvent = (event) => {
        events.push(event);
        emit?.(event);
    };
    const context = {
        projectRoot: deps.projectRoot,
        outputDir: deps.outputDirAbs,
        prompt,
        sessionStore,
        logger,
        signal,
        emit: pushEvent,
    };
    pushEvent({ type: 'prompt', text: prompt });
    logger.audit({
        kind: 'codex-turn',
        requestId: request.id,
        threadId: request.threadId,
        references: request.references.length,
        screenshots: request.screenshots?.length ?? 0,
    });
    const adapter = registry.get('codex-sdk');
    const availability = await adapter.isAvailable();
    if (!availability.available) {
        const reason = availability.reason ?? 'Codex SDK is currently unavailable';
        const event = { type: 'failed', text: reason };
        pushEvent(event);
        return {
            ok: false,
            agent: 'codex-sdk',
            requestId: request.id,
            events: [event],
            prompt,
            error: reason,
        };
    }
    const result = await adapter.send(request, context);
    return {
        ...result,
        prompt,
        events: result.events && result.events.length ? result.events : events,
    };
}

/**
 * Registers local code-intent inspector HTTP routes on a Vite dev server.
 *
 * Boundary: routes are served only under `ROUTE_PREFIX`. API routes require the per-process token; cross-origin calls
 * are accepted only when that token is present so pages opened through a business dev domain can still reach the local
 * `ip:port` inspector server. Passing incomplete deps can make client serving, source resolution, or agent dispatch
 * fail at request time.
 *
 * @param {{ server: import('vite').ViteDevServer, options: Record<string, unknown>, token: string, registry: Record<string, unknown>, sessionStore: Record<string, unknown>, logger: Record<string, Function>, clientCode: string, projectRoot: string, outputDirAbs: string }} deps Inspector route dependencies from the Vite plugin.
 * @returns {void} Mutates the Vite middleware stack by registering inspector handlers.
 */
export function registerIntentInspectorRoutes(deps) {
    const { server, options, token, registry, sessionStore, logger } = deps;
    const guard = (req, res) => {
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
    const handler = (req, res, next) => {
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
        // --- GET /codex/sessions -----------------------------------------------
        if (url === ENDPOINTS.codexSessions && req.method === 'GET') {
            if (!guard(req, res))
                return;
            if (!options.codexDock?.enabled) {
                sendJson(res, 200, { ok: false, sessions: [], error: 'Codex dock is disabled' });
                return;
            }
            const requestedDays = Number(searchParam(req, 'days') ?? options.codexDock.days ?? 15);
            const days = Number.isFinite(requestedDays) && requestedDays > 0
                ? Math.min(Math.floor(requestedDays), 90)
                : options.codexDock.days;
            const projectRoot = typeof options.codexDock.projectRoot === 'string' && options.codexDock.projectRoot.trim()
                ? options.codexDock.projectRoot.trim()
                : deps.projectRoot;
            const projectRoots = resolveCodexProjectRoots(projectRoot);
            Promise.all([
                listProjectCodexSessions({
                    projectRoot,
                    sessionsRoot: options.codexDock.sessionsRoot,
                    days,
                }),
                readLatestCodexSessionModel(options.codexDock.sessionsRoot),
            ])
                .then(([sessions, latestModel]) => sendJson(res, 200, {
                ok: true,
                sessions,
                projectRoots,
                defaultModel: latestModel?.model || '',
                defaultModelSessionId: latestModel?.id || '',
            }))
                .catch((err) => sendJson(res, 200, {
                ok: false,
                sessions: [],
                error: err instanceof Error ? err.message : String(err),
            }));
            return;
        }
        // --- GET /codex/session -----------------------------------------------
        if (url === ENDPOINTS.codexSession && req.method === 'GET') {
            if (!guard(req, res))
                return;
            if (!options.codexDock?.enabled) {
                sendJson(res, 200, { ok: false, session: null, messages: [], error: 'Codex dock is disabled' });
                return;
            }
            const threadId = searchParam(req, 'id');
            if (!threadId) {
                sendJson(res, 200, { ok: false, session: null, messages: [], error: 'Missing Codex session id' });
                return;
            }
            const requestedDays = Number(searchParam(req, 'days') ?? options.codexDock.days ?? 15);
            const days = Number.isFinite(requestedDays) && requestedDays > 0
                ? Math.min(Math.floor(requestedDays), 90)
                : options.codexDock.days;
            const projectRoot = typeof options.codexDock.projectRoot === 'string' && options.codexDock.projectRoot.trim()
                ? options.codexDock.projectRoot.trim()
                : deps.projectRoot;
            const projectRoots = resolveCodexProjectRoots(projectRoot);
            listProjectCodexSessions({
                projectRoot,
                sessionsRoot: options.codexDock.sessionsRoot,
                days,
            })
                .then(async (sessions) => {
                const session = sessions.find((item) => item.id === threadId);
                if (!session?.filePath) {
                    sendJson(res, 200, {
                        ok: false,
                        session: null,
                        messages: [],
                        error: 'Codex session was not found for this project',
                    });
                    return;
                }
                const [messages, metrics] = await Promise.all([
                    parseCodexSessionMessages(session.filePath, projectRoots),
                    parseCodexSessionMetrics(session.filePath, projectRoots),
                ]);
                if (!messages) {
                    sendJson(res, 200, {
                        ok: false,
                        session: null,
                        messages: [],
                        error: 'Codex session is outside this project',
                    });
                    return;
                }
                sendJson(res, 200, { ok: true, session, messages, metrics });
            })
                .catch((err) => sendJson(res, 200, {
                ok: false,
                session: null,
                messages: [],
                error: err instanceof Error ? err.message : String(err),
            }));
            return;
        }
        // --- POST /resolve ------------------------------------------------------
        if (url === ENDPOINTS.resolve && req.method === 'POST') {
            if (!guard(req, res))
                return;
            readJsonBody(req)
                .then((payload) => {
                try {
                    const resolved = resolveSelection(payload, deps.projectRoot, options);
                    const request = buildIntentRequest(payload, resolved, deps.projectRoot, options);
                    const response = {
                        ok: true,
                        selection: resolved.selection,
                        source: resolved.source,
                        reference: buildPromptReferenceLines(request)[0],
                        prompt: buildPrompt(request),
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
            readJsonBody(req)
                .then(async (payload) => {
                try {
                    if (!registry.has(payload.agent)) {
                        throw new Error(`Agent "${payload.agent}" is not enabled`);
                    }
                    cleanupNonScreenshotArtifacts(deps.outputDirAbs, deps.projectRoot);
                    const resolved = resolveSelection(payload, deps.projectRoot, options);
                    const request = buildIntentRequest(payload, resolved, deps.projectRoot, options);
                    request.screenshots = saveScreenshotPayloads(payload.screenshots ?? (payload.screenshot ? [payload.screenshot] : undefined), request, deps.outputDirAbs);
                    request.screenshot = request.screenshots?.[0];
                    const prompt = buildPrompt(request);
                    const events = [];
                    const context = {
                        projectRoot: deps.projectRoot,
                        outputDir: deps.outputDirAbs,
                        prompt,
                        sessionStore,
                        logger,
                        emit: (event) => events.push(event),
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
        // --- POST /codex/turn ---------------------------------------------------
        if (url === ENDPOINTS.codexTurn && req.method === 'POST') {
            if (!guard(req, res))
                return;
            if (!options.codexDock?.enabled) {
                sendJson(res, 200, { ok: false, agent: 'codex-sdk', requestId: '', error: 'Codex dock is disabled' });
                return;
            }
            const stream = searchParam(req, 'stream') === '1';
            if (stream) {
                startEventStream(res);
                const signal = requestAbortSignal(res);
                readJsonBody(req)
                    .then(async (payload) => {
                    try {
                        const result = await executeCodexDockTurn({
                            payload,
                            deps,
                            options,
                            registry,
                            sessionStore,
                            logger,
                            signal,
                            emit: (event) => writeEventStream(res, 'progress', event),
                        });
                        writeEventStream(res, 'result', result);
                        res.end();
                    }
                    catch (err) {
                        const error = err instanceof Error ? err.message : String(err);
                        logger.error('codex turn failed:', error);
                        const result = {
                            ok: false,
                            agent: 'codex-sdk',
                            requestId: '',
                            events: [{ type: 'failed', text: error }],
                            error,
                        };
                        writeEventStream(res, 'progress', result.events[0]);
                        writeEventStream(res, 'result', result);
                        res.end();
                    }
                })
                    .catch((err) => {
                    const error = err instanceof Error ? err.message : String(err);
                    const result = {
                        ok: false,
                        agent: 'codex-sdk',
                        requestId: '',
                        events: [{ type: 'failed', text: error }],
                        error,
                    };
                    writeEventStream(res, 'progress', result.events[0]);
                    writeEventStream(res, 'result', result);
                    res.end();
                });
                return;
            }
            readJsonBody(req)
                .then(async (payload) => {
                try {
                    const result = await executeCodexDockTurn({
                        payload,
                        deps,
                        options,
                        registry,
                        sessionStore,
                        logger,
                    });
                    sendJson(res, 200, result);
                }
                catch (err) {
                    const error = err instanceof Error ? err.message : String(err);
                    logger.error('codex turn failed:', error);
                    sendJson(res, 200, {
                        ok: false,
                        agent: 'codex-sdk',
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
    server.middlewares.use(handler);
    logger.info(`routes registered under ${ROUTE_PREFIX}`);
}
