import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { antigravityIdeWorkspaceId, antigravityIdeWorkspaceSlug } from '../agents/antigravity-ide-bridge-host.js';
import {
    buildLanguageServerRequest,
    certPathForLanguageServer,
    parseProcessTable,
    parseWindowsProcessJson,
} from './antigravity-ls.js';
import { buildCascadeSendBody, listAntigravitySessions, sendToAntigravityConversation } from './antigravity-sessions.js';

const EXE = '/Applications/Antigravity IDE.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm';
const TOKEN = 'csrf-test-token';

/**
 * One `ps` row for a language-server process.
 *
 * @param pid Process id.
 * @param uid Owner uid. Discovery keeps only the test uid.
 * @param extra Argument tail after the executable. A missing flag drops the row at parse time.
 * @returns A padded ps line.
 */
function line(pid: number, uid: number, extra: string) {
    return `  ${pid} ${uid} ${EXE} ${extra}`;
}

const PS = [
    line(10, 501, `--https_server_port 4311 --csrf_token ${TOKEN} --app_data_dir antigravity-ide --workspace_id file:///tmp/proj`),
    line(11, 501, '--https_server_port 9 --csrf_token hub-token --app_data_dir antigravity --subclient_type hub'),
    line(12, 999, `--https_server_port 8 --csrf_token other --app_data_dir antigravity-ide`),
    'not a process line',
].join('\n');

test('discovery drops hub processes and other uids', () => {
    const servers = parseProcessTable(PS, 501);
    assert.equal(servers.length, 1);
    assert.equal(servers[0].port, 4311);
    assert.equal(servers[0].csrfToken, TOKEN);
    assert.equal(servers[0].pid, 10);
    const windows = parseWindowsProcessJson(JSON.stringify({
        ProcessId: 20,
        CommandLine: `${EXE} --https_server_port 77 --csrf_token ${TOKEN} --app_data_dir antigravity-ide`,
    }));
    assert.equal(windows.length, 1);
    assert.equal(windows[0].port, 77);
});

test('request builder pins the CA, sends the CSRF header, and never disables verification', () => {
    const request = buildLanguageServerRequest(
        { port: 4311, csrfToken: TOKEN },
        'GetAllCascadeTrajectories',
        { excludeSubtrajectories: true },
        'CERTDATA',
    );
    assert.equal(request.options.host, '127.0.0.1');
    assert.equal(request.options.servername, 'localhost');
    assert.equal(request.options.ca, 'CERTDATA');
    // Strict inference of the builder omits rejectUnauthorized; the check is that verification stays on.
    assert.equal((request.options as { rejectUnauthorized?: boolean }).rejectUnauthorized, undefined);
    assert.equal(request.options.headers['Connect-Protocol-Version'], '1');
    assert.equal(request.options.headers['X-Codeium-Csrf-Token'], TOKEN);
    assert.equal(request.options.path, '/exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories');
    assert.deepEqual(JSON.parse(request.body), { excludeSubtrajectories: true });
    assert.equal(request.timeoutMs, 2000);
    assert.equal(
        certPathForLanguageServer(EXE),
        '/Applications/Antigravity IDE.app/Contents/Resources/app/extensions/antigravity/dist/languageServer/cert.pem',
    );
    assert.equal(
        certPathForLanguageServer('C:\\Programs\\Antigravity IDE\\resources\\app\\extensions\\antigravity\\bin\\language_server_windows.exe', 'win32').endsWith('cert.pem'),
        true,
    );
});

test('list maps status, drops killed rows, and send bodies differ for working and idle', async () => {
    const calls: Array<{ options: { headers: Record<string, string> } }> = [];
    const summaries = {
        'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1': {
            summary: 'running one',
            status: 'CASCADE_RUN_STATUS_RUNNING',
            lastModifiedTime: '2026-09-27T00:00:00.000Z',
            workspaces: [{ workspaceFolderAbsoluteUri: 'file:///tmp/proj' }],
        },
        'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2': {
            summary: 'waiting one',
            waitingSteps: [{ id: 'step' }],
            lastModifiedTime: '2026-09-26T00:00:00.000Z',
            workspaces: [{ workspaceFolderAbsoluteUri: 'file:///tmp/proj' }],
        },
        'aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaa3': {
            summary: 'killed',
            killed: true,
            workspaces: [{ workspaceFolderAbsoluteUri: 'file:///tmp/proj' }],
        },
        'aaaaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaa4': {
            summary: 'other project',
            lastModifiedTime: '2026-09-25T00:00:00.000Z',
            workspaces: [{ workspaceFolderAbsoluteUri: 'file:///tmp/other' }],
        },
    };
    const io = {
        processText: PS,
        uid: 501,
        platform: 'darwin',
        readCert() {
            return 'CERTDATA';
        },
        async exchange(request: { options: { headers: Record<string, string> } }) {
            calls.push(request);
            return { status: 200, json: { trajectorySummaries: summaries } };
        },
    };
    const listed = await listAntigravitySessions({ projectRoot: '/tmp/proj', config: { experimentalSessions: true }, io });
    assert.equal(listed.notice, undefined);
    assert.deepEqual(listed.sessions.map((session) => session.id), [
        'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    ]);
    assert.equal(listed.sessions[0].status, 'working');
    assert.equal(listed.sessions[1].status, 'waiting');
    assert.equal(calls[0].options.headers['X-Codeium-Csrf-Token'], TOKEN);
    assert.equal(JSON.stringify(listed.sessions).includes(TOKEN), false);
    assert.equal(listed.sessions[0].route.languageServerPort, 4311);
    const workingBody = buildCascadeSendBody(listed.sessions[0], 'hello');
    const idleBody = buildCascadeSendBody({ ...listed.sessions[1], status: 'idle' }, 'hello');
    assert.equal(workingBody.deliveryStrategy, 'MESSAGE_DELIVERY_STRATEGY_WHEN_IDLE');
    assert.equal(idleBody.deliveryStrategy, undefined);
    assert.equal(workingBody.metadata, undefined);
    assert.equal(workingBody.api_key, undefined);
    assert.deepEqual(workingBody.items, [{ text: 'hello' }]);
    const sent: Array<{ deliveryStrategy?: string; metadata?: unknown; cascadeId?: string }> = [];
    const sendIo = {
        readCert() {
            return 'CERTDATA';
        },
        async exchange(request: { body: string; options: { path: string } }) {
            sent.push(JSON.parse(request.body));
            const method = request.options.path.split('/').pop();
            if (method === 'SendUserCascadeMessage')
                return { status: 200, json: {} };
            return { status: 200, json: {} };
        },
    };
    const ok = await sendToAntigravityConversation({
        session: listed.sessions[0],
        prompt: 'hello',
        servers: listed.servers,
        io: sendIo,
    });
    assert.equal(ok.ok, true);
    assert.equal(sent[0].deliveryStrategy, 'MESSAGE_DELIVERY_STRATEGY_WHEN_IDLE');
    assert.equal(sent[0].metadata, undefined);
    assert.equal(sent[1].cascadeId, listed.sessions[0].id);
    const denied = await sendToAntigravityConversation({
        session: { ...listed.sessions[1], status: 'idle' },
        prompt: 'hello',
        servers: listed.servers,
        io: {
            readCert() {
                return 'CERTDATA';
            },
            async exchange() {
                return { status: 401, json: { error: 'unauthenticated' } };
            },
        },
    });
    assert.equal(denied.code, 'ls-requires-credentials');
    const empty = await listAntigravitySessions({
        projectRoot: '/tmp/proj',
        io: { processText: '', uid: 501, platform: 'darwin' },
    });
    assert.deepEqual(empty.sessions, []);
    assert.equal(empty.notice, 'ide-not-running');
});

test('dedupe prefers the project hash or slug even when that language server is second', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ws-'));
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-other-'));
    const cascade = 'abababab-abab-4aba-8aba-abababababab';
    const summary = {
        summary: 'shared',
        lastModifiedTime: '2026-09-27T00:00:00.000Z',
        workspaces: [{ workspaceFolderAbsoluteUri: pathToFileURL(project).href }],
    };
    const list = async (secondId: string) => listAntigravitySessions({
        projectRoot: project,
        config: { experimentalSessions: true },
        io: {
            processText: [
                line(30, 501, `--https_server_port 3333 --csrf_token ${TOKEN} --app_data_dir antigravity-ide --workspace_id ${antigravityIdeWorkspaceId(other)}`),
                line(31, 501, `--https_server_port 1111 --csrf_token ${TOKEN} --app_data_dir antigravity-ide --workspace_id ${secondId}`),
            ].join('\n'),
            uid: 501,
            platform: 'darwin',
            readCert: () => 'CERTDATA',
            async exchange() {
                return { status: 200, json: { trajectorySummaries: { [cascade]: summary } } };
            },
        },
    });
    const byHash = await list(antigravityIdeWorkspaceId(project));
    assert.equal(byHash.sessions[0]?.route.languageServerPort, 1111);
    const bySlug = await list(antigravityIdeWorkspaceSlug(project));
    assert.equal(bySlug.sessions[0]?.route.languageServerPort, 1111);
});

test('a 200 catalog mentioning oauth is listed and a 200 send mentioning api_key is not a credential failure', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-oauth-'));
    const cascade = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
    const listed = await listAntigravitySessions({
        projectRoot: project,
        io: {
            processText: [
                line(1, 501, `--https_server_port 1111 --csrf_token ${TOKEN} --app_data_dir antigravity-ide --workspace_id ${antigravityIdeWorkspaceId(project)}`),
                line(2, 501, `--https_server_port 2222 --csrf_token ${TOKEN} --app_data_dir antigravity-ide --workspace_id ${antigravityIdeWorkspaceSlug(project)}`),
            ].join('\n'),
            uid: 501,
            platform: 'darwin',
            readCert: () => 'CERTDATA',
            async exchange() {
                return {
                    status: 200,
                    json: {
                        trajectorySummaries: {
                            [cascade]: {
                                summary: 'oauth login',
                                lastModifiedTime: '2026-09-27T00:00:00.000Z',
                                workspaces: [{ workspaceFolderAbsoluteUri: pathToFileURL(project).href }],
                            },
                        },
                    },
                };
            },
        },
    });
    assert.equal(listed.notice ?? null, null);
    assert.equal(listed.sessions.length, 1);
    assert.equal(listed.sessions[0].title, 'oauth login');
    const sent = await sendToAntigravityConversation({
        session: listed.sessions[0],
        prompt: 'hello',
        servers: listed.servers,
        io: {
            readCert: () => 'CERTDATA',
            async exchange() {
                return { status: 200, json: { echo: 'api_key is mentioned but this is not an auth error' } };
            },
        },
    });
    assert.equal(sent.ok, true);
    const denied = await sendToAntigravityConversation({
        session: listed.sessions[0],
        prompt: 'hello',
        servers: listed.servers,
        io: {
            readCert: () => 'CERTDATA',
            async exchange() {
                return { status: 200, json: { code: 'unauthenticated', message: 'missing api_key' } };
            },
        },
    });
    assert.equal(denied.code, 'ls-requires-credentials');
});

test('Antigravity session source does not reference credential stores or disable TLS', () => {
    const source = [
        fs.readFileSync(new URL('./antigravity-ls.ts', import.meta.url), 'utf8'),
        fs.readFileSync(new URL('./antigravity-sessions.ts', import.meta.url), 'utf8'),
        fs.readFileSync(new URL('../agents/antigravity-ide.ts', import.meta.url), 'utf8'),
    ].join('\n');
    assert.equal(source.includes('state.vscdb'), false);
    assert.equal(source.includes('oauthToken'), false);
    assert.equal(source.includes('rejectUnauthorized'), false);
});
