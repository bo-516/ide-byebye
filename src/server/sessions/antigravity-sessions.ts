import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { antigravityIdeWorkspaceId, antigravityIdeWorkspaceSlug } from '../agents/antigravity-ide-bridge-host.js';
import { buildPrompt } from '../prompt.js';
import { callLanguageServer, certPathForLanguageServer, discoverLanguageServers } from './antigravity-ls.js';
import { readSessionPicker } from './options.js';
import { buildProjectScope, matchSessionCwd, normalizeScopePath, sessionLocation, sessionProjectName } from './project-scope.js';
import { sessionErrorText, sessionTitle } from './types.js';

const WORKING_STATUSES = new Set([
    'CASCADE_RUN_STATUS_RUNNING',
    'CASCADE_RUN_STATUS_CANCELING',
    'CASCADE_RUN_STATUS_BUSY',
]);

/**
 * Map a trajectory summary's run state onto the shared status codes.
 *
 * Boundary: `killed` rows are omitted by the caller before this runs. Running, canceling, busy, or `notFullyIdle`
 * are `working` even when `waitingSteps` is also set. A non-empty `waitingSteps` is otherwise `waiting`.
 *
 * @param {Record<string, unknown>} summary One `CascadeTrajectorySummary`.
 * @returns {'working' | 'waiting' | 'idle'}
 */
function statusOf(summary) {
    if (WORKING_STATUSES.has(summary?.status) || summary?.notFullyIdle === true)
        return 'working';
    if (Array.isArray(summary?.waitingSteps) && summary.waitingSteps.length > 0)
        return 'waiting';
    return 'idle';
}

/**
 * Turn `file://` workspace URIs into a filesystem path.
 *
 * @param {unknown} uri `workspaceFolderAbsoluteUri` or a raw path.
 * @returns {string} Absolute path, or `''` when the URI cannot be parsed.
 */
function cwdFromWorkspace(uri) {
    if (typeof uri !== 'string' || !uri)
        return '';
    if (uri.startsWith('file:')) {
        try {
            return fileURLToPath(uri);
        }
        catch {
            return '';
        }
    }
    return uri;
}

/**
 * Directory strings whose Antigravity workspace encodings should be tried.
 *
 * Boundary: the IDE hashes the folder it was opened with, which can be the pre-realpath path (`/var` vs
 * `/private/var`). A missing directory still contributes `path.resolve`. Duplicate strings are dropped.
 *
 * @param {string | string[]} projectRoots Inspector root and its realpath, either or both.
 * @returns {string[]} Distinct directories.
 */
function workspaceRoots(projectRoots) {
    const roots = [];
    const push = (value) => {
        if (typeof value === 'string' && value && !roots.includes(value))
            roots.push(value);
    };
    for (const root of Array.isArray(projectRoots) ? projectRoots : [projectRoots]) {
        push(root);
        try {
            push(path.resolve(root));
        }
        catch {
            // Ignore a root path.resolve cannot handle.
        }
        try {
            push(fs.realpathSync.native(root));
        }
        catch {
            // Missing folder: the resolved string above is still hashed.
        }
    }
    return roots;
}

/**
 * Whether this language server's `--workspace_id` is the project we are serving.
 *
 * Boundary: a match is the raw path, its `file://` URL, `antigravityIdeWorkspaceId` (sha256 of that URL), or
 * `antigravityIdeWorkspaceSlug` (`file_` + underscores). A mismatch does not drop the row; it only loses the dedupe
 * tie-break, so the first server that returned the cascade is kept.
 *
 * @param {string} workspaceId Flag value from the language server.
 * @param {string | string[]} projectRoots Inspector project root, before and after realpath.
 * @returns {boolean} True when the flag points at this project.
 */
function workspaceMatches(workspaceId, projectRoots) {
    if (!workspaceId)
        return false;
    for (const root of workspaceRoots(projectRoots)) {
        if (workspaceId === root || workspaceId === pathToFileURL(root).href)
            return true;
        if (workspaceId === antigravityIdeWorkspaceId(root) || workspaceId === antigravityIdeWorkspaceSlug(root))
            return true;
    }
    if (String(workspaceId).startsWith('file:')) {
        try {
            const asPath = normalizeScopePath(fileURLToPath(workspaceId));
            return workspaceRoots(projectRoots).some((root) => normalizeScopePath(root) === asPath);
        }
        catch {
            return false;
        }
    }
    return false;
}

/**
 * ISO timestamp from a summary's `lastModifiedTime`.
 *
 * Boundary: ISO strings pass through. Numeric seconds or milliseconds are converted. Anything else becomes the
 * current time so the row still sorts instead of dropping out.
 *
 * @param {unknown} value Summary timestamp.
 * @returns {string} ISO 8601.
 */
function updatedAtFrom(value) {
    if (typeof value === 'string' && Number.isFinite(Date.parse(value)))
        return new Date(value).toISOString();
    if (typeof value === 'number' && Number.isFinite(value)) {
        const ms = value > 1_000_000_000_000 ? value : value * 1000;
        return new Date(ms).toISOString();
    }
    if (value && typeof value === 'object' && Number.isFinite(Number(value.seconds)))
        return new Date(Number(value.seconds) * 1000).toISOString();
    return new Date().toISOString();
}

/**
 * Body of `SendUserCascadeMessage`.
 *
 * Boundary: a working session queues with `MESSAGE_DELIVERY_STRATEGY_WHEN_IDLE`. An idle or waiting session omits
 * `deliveryStrategy` so the IDE runs it immediately. `metadata` and `api_key` are never added — if the server
 * rejects that, the caller returns `ls-requires-credentials` instead of reading a credential file.
 *
 * @param {{ id: string, status?: string }} session Target session.
 * @param {string} prompt Prompt text. v1 sends text only; screenshot paths may already be inside it.
 * @returns {Record<string, unknown>} JSON body.
 */
export function buildCascadeSendBody(session, prompt) {
    const body: Record<string, unknown> = {
        cascadeId: session.id,
        items: [{ text: String(prompt ?? '') }],
    };
    if (session.status === 'working')
        body.deliveryStrategy = 'MESSAGE_DELIVERY_STRATEGY_WHEN_IDLE';
    return body;
}

/**
 * Default cert loader. Reads the IDE bundled CA and nothing else.
 *
 * @param {{ exe: string }} ls Language server descriptor.
 * @param {string} [platform] Path platform.
 * @returns {Promise<Buffer>} PEM contents.
 */
function readBundledCert(ls, platform = process.platform) {
    return fs.promises.readFile(certPathForLanguageServer(ls.exe, platform));
}

/**
 * List Antigravity IDE conversations from every same-user IDE language server.
 *
 * Boundary: no language server yields `{ notice: "ide-not-running" }` and an empty list. Rows with `killed` are
 * omitted. The same cascade id keeps the server whose `--workspace_id` matches the project, else the first server
 * that returned it. CSRF tokens stay on `servers` and are not copied onto session rows. `io.exchange` replaces the
 * network in tests.
 *
 * @param {{ projectRoot: string, config?: Record<string, unknown>, io?: Record<string, unknown> }} input
 * @returns {Promise<{ sessions: Array<Record<string, unknown>>, servers: Array<Record<string, unknown>>, delivery: 'submit', notice?: string }>}
 */
export async function listAntigravitySessions(input) {
    const io = input.io ?? {};
    const delivery = 'submit';
    const picker = readSessionPicker(input.config ?? {});
    const servers = await discoverLanguageServers(io) as any[];
    if (!servers.length)
        return { sessions: [], servers: [], delivery, notice: 'ide-not-running' };
    // `io` is the language-server transport, not a filesystem. Scope checks use the real disk.
    const scope = buildProjectScope(input.projectRoot);
    const byId = new Map();
    const readCert = io.readCert ?? ((ls) => readBundledCert(ls, io.platform));
    for (const ls of servers) {
        let response;
        try {
            response = await callLanguageServer(ls, 'GetAllCascadeTrajectories', { excludeSubtrajectories: true }, {
                readCert,
                exchange: io.exchange,
            });
        }
        catch {
            continue;
        }
        const summaries = ((response as any)?.trajectorySummaries ?? {}) as Record<string, any>;
        for (const [id, summary] of Object.entries(summaries)) {
            if (!summary || summary.killed === true)
                continue;
            const existing = byId.get(id);
            const projectRoots = [input.projectRoot, scope.projectRoot];
            const incomingMatches = workspaceMatches(ls.workspaceId, projectRoots);
            const existingMatches = existing ? workspaceMatches(existing.ls.workspaceId, projectRoots) : false;
            if (!existing || (incomingMatches && !existingMatches))
                byId.set(id, { id, summary, ls });
        }
    }
    const sessions = [];
    for (const entry of byId.values()) {
        const summary = entry.summary;
        const cwdRaw = cwdFromWorkspace(summary.workspaces?.[0]?.workspaceFolderAbsoluteUri);
        if (!cwdRaw || !matchSessionCwd(cwdRaw, scope))
            continue;
        const cwd = normalizeScopePath(cwdRaw);
        sessions.push({
            id: entry.id,
            title: sessionTitle(summary.summary ?? ''),
            cwd,
            projectName: sessionProjectName(cwd, scope.platform),
            location: sessionLocation(cwd, scope.projectRoot, scope.platform),
            status: statusOf(summary),
            live: true,
            targetable: true,
            updatedAt: updatedAtFrom(summary.lastModifiedTime),
            route: { languageServerPort: entry.ls.port, languageServerPid: entry.ls.pid },
        });
    }
    sessions.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return { sessions: sessions.slice(0, picker.limit), servers, delivery };
}

/**
 * Deliver a prompt into one IDE conversation.
 *
 * Boundary: the transport is `io.exchange` in tests and loopback HTTPS otherwise. A working session sends
 * `deliveryStrategy`. After a successful send, `SmartFocusConversation` is best-effort. TLS and credential failures
 * are returned as codes and do not fall back to reading the IDE credential database. The CSRF token is read from
 * the language-server descriptor already in memory.
 *
 * @param {{ session: Record<string, unknown>, prompt: string, servers: Array<Record<string, unknown>>, io?: Record<string, unknown> }} input
 * @returns {Promise<{ ok: boolean, code?: string, error?: string }>} Delivery result. `ok: true` means the RPC was accepted.
 */
export async function sendToAntigravityConversation(input) {
    const session = input.session;
    const servers = input.servers ?? [];
    const port = session?.route?.languageServerPort;
    const ls = servers.find((server) => server.port === port) ?? servers[0];
    if (!ls)
        return { ok: false, code: 'ls-unreachable', error: sessionErrorText('ls-unreachable') };
    const io = input.io ?? {};
    const readCert = io.readCert ?? ((server) => readBundledCert(server, io.platform));
    const transport = { readCert, exchange: io.exchange };
    try {
        await callLanguageServer(ls, 'SendUserCascadeMessage', buildCascadeSendBody(session, input.prompt), transport);
    }
    catch (err) {
        const code = err?.code === 'ls-tls' || err?.code === 'ls-requires-credentials' ? err.code : 'ls-unreachable';
        return { ok: false, code, error: sessionErrorText(code) };
    }
    try {
        await callLanguageServer(ls, 'SmartFocusConversation', { cascadeId: session.id }, transport);
    }
    catch {
        // Focusing the IDE is best-effort; the message was already accepted.
    }
    return { ok: true };
}

/**
 * Adapter-owned list/send pair. Holds discovered servers (and their CSRF tokens) in the closure.
 *
 * Boundary: tokens never leave this closure. `list` refreshes the cache; `send` uses it and, if the port is gone,
 * lists once more. Disabled when `experimentalSessions` is not exactly `true`.
 *
 * @param {Record<string, unknown>} config Antigravity IDE adapter config.
 * @returns {{ enabled: boolean, list: Function, send: Function }}
 */
export function createAntigravitySessionBridge(config: any = {}) {
    let servers: any[] = [];
    const enabled = config.experimentalSessions === true;
    return {
        enabled,
        async list(projectRoot) {
            if (!enabled)
                return { sessions: [], delivery: 'submit', notice: 'ide-not-running' };
            const listed = await listAntigravitySessions({ projectRoot, config, io: config.sessionIo });
            servers = listed.servers;
            return { sessions: listed.sessions, delivery: listed.delivery, notice: listed.notice };
        },
        async send(request, context) {
            if (!enabled) {
                return {
                    ok: false,
                    agent: 'antigravity-ide',
                    requestId: request.id,
                    code: 'sessions-unsupported',
                    error: sessionErrorText('sessions-unsupported'),
                    events: [],
                };
            }
            const session = context.targetSession;
            if (!servers.length)
                await this.list(context.projectRoot);
            const prompt = buildPrompt({ ...request, projectRoot: session.cwd });
            const result = await sendToAntigravityConversation({
                session,
                prompt,
                servers,
                io: config.sessionIo,
            });
            if (!result.ok) {
                return {
                    ok: false,
                    agent: 'antigravity-ide',
                    requestId: request.id,
                    code: result.code,
                    error: result.error,
                    events: [{ type: 'failed', text: result.error }],
                };
            }
            return {
                ok: true,
                agent: 'antigravity-ide',
                requestId: request.id,
                targetSessionId: session.id,
                events: [{ type: 'completed', text: 'Sent the prompt to the Antigravity IDE session' }],
                output: 'Sent the prompt to the Antigravity IDE session.',
            };
        },
    };
}
