import fs from 'node:fs';
import { buildPrompt } from '../prompt.js';
import { callLanguageServer, certPathForLanguageServer, discoverLanguageServers } from './antigravity-ls.js';
import type { LanguageServerProcess, LanguageServerRequest, LanguageServerResponse } from './antigravity-ls.js';
import { readSessionPicker } from './options.js';
import { buildProjectScope, matchSessionCwd, normalizeScopePath, sessionLocation, sessionProjectName } from './project-scope.js';
import { buildCascadeSendBody, statusOf, cwdFromWorkspace, updatedAtFrom, workspaceMatches } from './antigravity-trajectory.js';
import type { TrajectorySummary } from './antigravity-trajectory.js';
import { sessionErrorText, sessionTitle } from './types.js';

export { buildCascadeSendBody } from './antigravity-trajectory.js';

/**
 * Test double for discovery and the loopback RPC. Every field is optional; production passes `{}` or omits `io`.
 *
 * Boundary: `processText` skips the process spawn. `readCert` and `exchange` replace the cert read and HTTPS call.
 * `platform` is a plain string: callers pass `'darwin'` / `'win32'`, and the cert helper only compares it to `'win32'`.
 */
interface AntigravitySessionIo {
    processText?: string;
    uid?: number | null;
    platform?: string;
    readCert?(ls: { port: number; csrfToken: string; exe?: string }): Promise<string | Buffer> | string | Buffer;
    exchange?(request: LanguageServerRequest): Promise<LanguageServerResponse | null | undefined>;
}

/**
 * Cascade the send RPC addresses.
 *
 * Boundary: `route.languageServerPort` picks the discovered server. `cwd` is the thread folder used when the prompt
 * is rebuilt. `status` selects immediate delivery versus queue-when-idle. Other catalog fields are ignored here.
 */
interface AntigravityTargetSession {
    id: string;
    cwd?: string;
    status?: string;
    route?: { languageServerPort?: number };
}

/**
 * Discovered language server fields the send path reads.
 *
 * Boundary: `exe` is only for the bundled CA path. `csrfToken` stays on this object and is not copied to the result.
 */
interface AntigravityServerRef {
    port: number;
    csrfToken: string;
    exe: string;
}

/**
 * Default cert loader. Reads the IDE bundled CA and nothing else.
 *
 * @param {{ exe?: string }} ls Language server descriptor. `exe` is always present on discovered servers.
 * @param {string} [platform] Path platform.
 * @returns {Promise<Buffer>} PEM contents.
 */
function readBundledCert(ls: { exe?: string }, platform: string = process.platform) {
    // `exe` is a required field of every discovered server; the optional key only keeps the shared `ls` shape assignable.
    return fs.promises.readFile(certPathForLanguageServer(ls.exe!, platform));
}

/**
 * List Antigravity IDE conversations from every same-user IDE language server.
 *
 * Boundary: no language server yields `{ notice: "ide-not-running" }` and an empty list. Rows with `killed` are
 * omitted. The same cascade id keeps the server whose `--workspace_id` matches the project, else the first server
 * that returned it. CSRF tokens stay on `servers` and are not copied onto session rows. `io.exchange` replaces the
 * network in tests.
 *
 * @param {{ projectRoot: string, config?: { experimentalSessions?: unknown, sessions?: unknown }, io?: AntigravitySessionIo }} input
 *        `config` is only read by the picker (`sessions`). `experimentalSessions` is accepted so the adapter can pass
 *        its whole config object. `io` is the language-server transport, not a filesystem.
 * @returns {Promise<{ sessions: Array<Record<string, unknown>>, servers: LanguageServerProcess[], delivery: 'submit', notice?: string }>}
 */
export async function listAntigravitySessions(input: {
    projectRoot: string;
    config?: { experimentalSessions?: unknown; sessions?: unknown };
    io?: AntigravitySessionIo;
}) {
    const io = input.io ?? {};
    const delivery = 'submit';
    const picker = readSessionPicker(input.config ?? {});
    const servers = await discoverLanguageServers(io);
    if (!servers.length)
        return { sessions: [], servers: [], delivery, notice: 'ide-not-running' };
    // `io` is the language-server transport, not a filesystem. Scope checks use the real disk.
    const scope = buildProjectScope(input.projectRoot);
    const byId = new Map<string, { id: string; summary: TrajectorySummary; ls: LanguageServerProcess }>();
    const readCert = io.readCert ?? ((ls: { port: number; csrfToken: string; exe?: string }) => readBundledCert(ls, io.platform));
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
        const summaries = ((response as Record<string, unknown> | undefined)?.trajectorySummaries ?? {}) as Record<string, TrajectorySummary>;
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
 * @param {{ session: AntigravityTargetSession, prompt: string, servers?: AntigravityServerRef[], io?: AntigravitySessionIo }} input
 *        `servers` is the list from {@link listAntigravitySessions}. An empty list cannot be addressed.
 * @returns {Promise<{ ok: boolean, code?: string, error?: string }>} Delivery result. `ok: true` means the RPC was accepted.
 */
export async function sendToAntigravityConversation(input: {
    session: AntigravityTargetSession;
    prompt: string;
    servers?: AntigravityServerRef[];
    io?: AntigravitySessionIo;
}) {
    const session = input.session;
    const servers = input.servers ?? [];
    const port = session?.route?.languageServerPort;
    const ls = servers.find((server) => server.port === port) ?? servers[0];
    if (!ls)
        return { ok: false, code: 'ls-unreachable', error: sessionErrorText('ls-unreachable') };
    const io = input.io ?? {};
    const readCert = io.readCert ?? ((server: { port: number; csrfToken: string; exe?: string }) => readBundledCert(server, io.platform));
    const transport = { readCert, exchange: io.exchange };
    try {
        await callLanguageServer(ls, 'SendUserCascadeMessage', buildCascadeSendBody(session, input.prompt), transport);
    }
    catch (err) {
        // Strict catch is `unknown`, so `err.code` is not a property access. The casts are erased.
        const code = (err as { code?: string } | null)?.code === 'ls-tls'
            || (err as { code?: string } | null)?.code === 'ls-requires-credentials'
            ? (err as { code: string }).code
            : 'ls-unreachable';
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
 * @param {Record<string, unknown>} config Antigravity IDE adapter config. `experimentalSessions` must be exactly `true`.
 *        `sessionIo` is forwarded as the list/send transport.
 * @returns {{ enabled: boolean, list: (projectRoot: string) => Promise<{ sessions: unknown[], delivery: string, notice?: string }>, send: (request: { id: string }, context: { projectRoot: string, targetSession: AntigravityTargetSession }) => Promise<Record<string, unknown>> }}
 *          `list` refreshes the cached servers. `send` delivers into `context.targetSession`.
 */
export function createAntigravitySessionBridge(config: { experimentalSessions?: unknown; sessionIo?: AntigravitySessionIo; [key: string]: unknown } = {}) {
    let servers: AntigravityServerRef[] = [];
    const enabled = config.experimentalSessions === true;
    return {
        enabled,
        async list(projectRoot: string) {
            if (!enabled)
                return { sessions: [], delivery: 'submit', notice: 'ide-not-running' };
            const listed = await listAntigravitySessions({ projectRoot, config, io: config.sessionIo });
            servers = listed.servers;
            return { sessions: listed.sessions, delivery: listed.delivery, notice: listed.notice };
        },
        async send(request: { id: string }, context: { projectRoot: string; targetSession: AntigravityTargetSession }) {
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
