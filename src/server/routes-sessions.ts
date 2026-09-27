import { sessionErrorText, SESSION_ID_PATTERNS, toPublicSession } from './sessions/types.js';

/** Agents whose unrecognized-format warning has already been logged in this process. */
const warnedFormats = new Set();

/**
 * Write a JSON inspector response.
 *
 * Boundary: duplicates the helper in `routes.ts` so this module does not import the router (that import would cycle).
 * Bodies are catalog or error objects; callers must already have stripped absolute paths.
 *
 * @param {import('node:http').ServerResponse} res Response.
 * @param {number} status HTTP status.
 * @param {Record<string, unknown>} body JSON body.
 * @returns {void}
 */
function sendJson(res, status, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
}

/**
 * Read the `agent` query parameter.
 *
 * Boundary: this is the only page-controlled input on `GET /sessions`. It is used as a registry key, never as a path.
 *
 * @param {import('node:http').IncomingMessage} req Request.
 * @returns {string} Agent name, or `''` when missing or the URL is malformed.
 */
function agentQuery(req) {
    try {
        return new URL(req.url ?? '', 'http://localhost').searchParams.get('agent') ?? '';
    }
    catch {
        return '';
    }
}

/**
 * Error body for a refused target. `requestId` is empty because the intent request is not built when this fires.
 *
 * @param {string} agent Agent name from the payload, if any.
 * @param {string} code Session error code.
 * @returns {Record<string, unknown>} JSON body.
 */
function targetError(agent, code) {
    return {
        ok: false,
        agent,
        requestId: '',
        code,
        error: sessionErrorText(code),
    };
}

/**
 * Serve `GET /sessions`.
 *
 * Boundary: the dev-token guard has already run. Unknown agents and agents with sessions disabled return
 * `sessions-unsupported` without reading a home directory. The JSON is {@link toPublicSession} rows only — no cwd,
 * route, pid, or token. A page-supplied `limit` is ignored; the server config decides the cap. There is no list
 * cache: every call reads the agent store.
 *
 * @param {import('node:http').IncomingMessage} req Request.
 * @param {import('node:http').ServerResponse} res Response.
 * @param {{ registry: { has: Function, sessionCapable: Function, get: Function }, projectRoot: string, logger?: { warn?: Function, error?: Function } }} deps Route dependencies.
 * @returns {Promise<void>}
 */
export async function handleSessionsGet(req, res, deps) {
    const agent = agentQuery(req);
    if (!deps.registry.has(agent) || !deps.registry.sessionCapable(agent)) {
        sendJson(res, 200, targetError(agent, 'sessions-unsupported'));
        return;
    }
    try {
        const listed = await deps.registry.get(agent).listSessions({
            projectRoot: deps.projectRoot,
            fresh: true,
        });
        const body: Record<string, unknown> = {
            ok: true,
            agent,
            delivery: listed?.delivery,
            sessions: (listed?.sessions ?? []).map(toPublicSession),
            fetchedAt: new Date().toISOString(),
        };
        if (listed?.notice) {
            body.notice = listed.notice;
            if (listed.notice === 'unsupported-format' && !warnedFormats.has(agent)) {
                warnedFormats.add(agent);
                deps.logger?.warn?.(`Session catalog for ${agent} uses an unrecognized on-disk format`);
            }
        }
        sendJson(res, 200, body);
    }
    catch {
        deps.logger?.error?.('session list failed');
        sendJson(res, 200, targetError(agent, 'sessions-unsupported'));
    }
}

/**
 * Revalidate `targetSessionId` before any adapter opens an app or writes a launcher.
 *
 * Boundary: a missing or blank id returns `blocked: false` so the existing new-session path is unchanged. Otherwise
 * the id must match that agent's UUID pattern and must appear in a fresh list as `targetable`. Failures are
 * `target-invalid`, `target-missing`, `target-busy`, or `sessions-unsupported`. The id is never passed to `fs`.
 * `cwd-missing` is reported as `target-missing` (the session cannot be used). Live / unknown rows are `target-busy`.
 *
 * @param {Record<string, unknown>} payload Send body from the page.
 * @param {{ registry: { has: Function, sessionCapable: Function, get: Function }, projectRoot: string, logger?: { error?: Function } }} deps Route dependencies.
 * @returns {Promise<{ blocked: boolean, session: Record<string, unknown> | null, body?: Record<string, unknown> }>}
 */
export async function gateSendTarget(payload, deps) {
    const id = payload?.targetSessionId;
    if (id == null || id === '')
        return { blocked: false, session: null };
    const agent = payload?.agent;
    if (!deps.registry.has(agent) || !deps.registry.sessionCapable(agent) || typeof deps.registry.get(agent).listSessions !== 'function') {
        return { blocked: true, session: null, body: targetError(agent, 'sessions-unsupported') };
    }
    const pattern = SESSION_ID_PATTERNS[agent];
    if (typeof id !== 'string' || !pattern || !pattern.test(id))
        return { blocked: true, session: null, body: targetError(agent, 'target-invalid') };
    let listed;
    try {
        listed = await deps.registry.get(agent).listSessions({
            projectRoot: deps.projectRoot,
            fresh: true,
        });
    }
    catch {
        deps.logger?.error?.('session revalidation failed');
        return { blocked: true, session: null, body: targetError(agent, 'sessions-unsupported') };
    }
    const wanted = id.toLowerCase();
    const found = (listed?.sessions ?? []).find((session) => String(session?.id ?? '').toLowerCase() === wanted);
    if (!found)
        return { blocked: true, session: null, body: targetError(agent, 'target-missing') };
    if (!found.targetable) {
        const code = found.reason === 'cwd-missing' ? 'target-missing' : 'target-busy';
        return { blocked: true, session: null, body: targetError(agent, code) };
    }
    return { blocked: false, session: found };
}
