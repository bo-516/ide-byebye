import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildRegistry } from './agents/build.js';
import { shellSingleQuote } from './agents/grok-build-launcher.js';
import { createInspectorServer } from './inspector-server.js';

const TOKEN = 'session-test-token';
const THREAD = '12121212-1212-4121-8121-121212121212';
const GROK = '34343434-3434-4343-8343-343434343434';

function recorder(logFile) {
    const script = path.join(path.dirname(logFile), 'record-open.mjs');
    fs.writeFileSync(script, `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(logFile)}, (process.argv[2] ?? '') + '\\n');`);
    return { openCommand: process.execPath, openArgs: [script] };
}

function opened(logFile) {
    if (!fs.existsSync(logFile))
        return [];
    return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
}

function noLeak(value) {
    const text = JSON.stringify(value);
    assert.equal(Object.prototype.hasOwnProperty.call(value, 'cwd'), false);
    assert.equal(text.includes('"cwd"'), false);
    assert.equal(text.includes('"route"'), false);
    const walk = (node) => {
        if (typeof node === 'string') {
            assert.equal(node.startsWith('/'), false, node);
            assert.equal(/^[A-Za-z]:[\\/]/.test(node), false, node);
        }
        else if (Array.isArray(node))
            node.forEach(walk);
        else if (node && typeof node === 'object')
            Object.values(node).forEach(walk);
    };
    walk(value);
}

async function boot(root, registry) {
    return createInspectorServer({
        options: { defaultAgent: 'codex-app', applyMode: 'agent-edit' },
        token: TOKEN,
        registry,
        sessionStore: {},
        logger: { info() {}, warn() {}, error() {}, audit() {} },
        clientCode: '',
        projectRoot: root,
        outputDirAbs: path.join(root, '.intent-inspector'),
    });
}

async function send(origin, body) {
    const res = await fetch(`${origin}/__intent-inspector/send?token=${TOKEN}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    return res.json();
}

test('GET /sessions and POST /send enforce token, id, and delivery on the real handler', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'send-repo-'));
    const project = path.join(repo, 'packages', 'app');
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.git'));
    fs.mkdirSync(path.join(project, '.intent-inspector'), { recursive: true });
    const source = path.join(project, 'src', 'App.jsx');
    fs.writeFileSync(source, 'export function App() {\n  return <button>Hi</button>;\n}\n');
    const codexHome = path.join(repo, 'codex-home');
    const rollDir = path.join(codexHome, 'sessions', '2026', '09', '27');
    fs.mkdirSync(rollDir, { recursive: true });
    fs.writeFileSync(path.join(codexHome, 'session_index.jsonl'), JSON.stringify({
        id: THREAD,
        thread_name: 'Buttons',
        updated_at: '2099-09-27T00:00:00.000Z',
    }) + '\n');
    fs.writeFileSync(path.join(rollDir, `rollout-x-${THREAD}.jsonl`), JSON.stringify({
        payload: { id: THREAD, cwd: repo, thread_source: 'user' },
    }) + '\n');
    const grokHome = path.join(repo, 'grok-home');
    const sessionDir = path.join(grokHome, 'sessions', encodeURIComponent(repo), GROK);
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'summary.json'), JSON.stringify({
        generated_title: 'Closed grok',
        last_active_at: '2099-09-27T00:00:00.000Z',
    }));
    fs.writeFileSync(path.join(grokHome, 'active_sessions.json'), '[]');
    const logFile = path.join(repo, 'opened.log');
    const open = recorder(logFile);
    const registry = buildRegistry({
        codexApp: { sessions: { home: codexHome }, ...open },
        grokBuild: { sessions: { home: grokHome }, command: process.execPath, permissionMode: 'plan', ...open },
        claudeApp: false,
        cursorApp: false,
    });
    const srv = await boot(project, registry);
    const selection = { inspPath: `${source}:2:3` };
    try {
        const denied = await fetch(`${srv.origin}/__intent-inspector/sessions?agent=codex-app`);
        assert.equal(denied.status, 403);
        const singular = await fetch(`${srv.origin}/__intent-inspector/session?token=${TOKEN}`);
        assert.equal(singular.status, 404);

        const agents = await (await fetch(`${srv.origin}/__intent-inspector/agents?token=${TOKEN}`)).json();
        assert.equal(agents.agents.find((agent) => agent.name === 'codex-app').sessions, true);
        assert.equal(agents.agents.find((agent) => agent.name === 'grok-build').sessions, true);

        const first = await (await fetch(`${srv.origin}/__intent-inspector/sessions?agent=codex-app&token=${TOKEN}`)).json();
        const second = await (await fetch(`${srv.origin}/__intent-inspector/sessions?agent=codex-app&token=${TOKEN}`)).json();
        assert.equal(first.ok, true);
        assert.equal(first.delivery, 'prefill');
        assert.deepEqual(first.sessions.map((session) => session.id), [THREAD]);
        assert.equal(first.sessions[0].title, 'Buttons');
        assert.equal(first.sessions[0].status, 'idle');
        assert.deepEqual(second.sessions, first.sessions);
        noLeak(first);
        noLeak(second);

        const unsupported = await send(srv.origin, { agent: 'clipboard', targetSessionId: THREAD, intent: 'x', selection });
        assert.equal(unsupported.code, 'sessions-unsupported');
        const unknown = await send(srv.origin, { agent: 'nope', targetSessionId: THREAD, intent: 'x', selection });
        assert.equal(unknown.code, 'sessions-unsupported');
        const invalid = await send(srv.origin, { agent: 'codex-app', targetSessionId: '../passwd', intent: 'x', selection });
        assert.equal(invalid.code, 'target-invalid');
        const missing = await send(srv.origin, {
            agent: 'codex-app',
            targetSessionId: '99999999-9999-4999-8999-999999999999',
            intent: 'x',
            selection,
        });
        assert.equal(missing.code, 'target-missing');
        assert.deepEqual(opened(logFile), []);

        const codex = await send(srv.origin, {
            agent: 'codex-app',
            targetSessionId: THREAD,
            intent: 'make it primary',
            selection,
        });
        assert.equal(codex.ok, true);
        assert.equal(codex.targetSessionId, THREAD);
        noLeak(codex);
        const deeplink = opened(logFile).at(-1);
        const url = new URL(deeplink);
        assert.equal(url.protocol, 'codex:');
        assert.equal(`${url.host}${url.pathname}`, `threads/${THREAD}`);
        const prompt = url.searchParams.get('prompt');
        assert.match(prompt, /\]\(packages\/app\/src\/App\.jsx/);
        assert.equal(/\]\(\//.test(prompt), false);

        const fileRegistry = buildRegistry({
            codexApp: { sessions: { home: codexHome }, promptMode: 'file', ...open },
            claudeApp: false,
            cursorApp: false,
            grokBuild: false,
        });
        const fileSrv = await boot(project, fileRegistry);
        try {
            const filed = await send(fileSrv.origin, {
                agent: 'codex-app',
                targetSessionId: THREAD,
                intent: 'file mode',
                selection,
            });
            assert.equal(filed.ok, true);
            const requests = fs.readdirSync(path.join(project, '.intent-inspector', 'requests'));
            const handoffName = requests.find((name) => name.endsWith('.md'));
            assert.ok(handoffName);
            const handoff = fs.readFileSync(path.join(project, '.intent-inspector', 'requests', handoffName), 'utf8');
            const promptSection = handoff.split('## Prompt')[1]?.split('## Intent')[0] ?? '';
            assert.match(promptSection, /packages\/app\/src\/App\.jsx/);
            assert.equal(promptSection.includes('@src/App.jsx'), false);
            assert.equal(promptSection.includes('](src/App.jsx'), false);
        }
        finally {
            await fileSrv.close();
        }

        const grok = await send(srv.origin, {
            agent: 'grok-build',
            targetSessionId: GROK,
            intent: 'resume this',
            selection,
        });
        assert.equal(grok.ok, true);
        assert.equal(grok.targetSessionId, GROK);
        noLeak(grok);
        const launches = fs.readdirSync(path.join(project, '.intent-inspector', 'launches'));
        const launcher = launches.find((name) => name.endsWith('.command') || name.endsWith('.cmd'));
        const script = fs.readFileSync(path.join(project, '.intent-inspector', 'launches', launcher), 'utf8');
        const sessionCwd = fs.realpathSync(repo);
        assert.match(script, new RegExp(shellSingleQuote(sessionCwd).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.match(script, new RegExp(`--resume '${GROK}'`));
        const promptFile = launches.find((name) => name.endsWith('.prompt.txt'));
        const promptText = fs.readFileSync(path.join(project, '.intent-inspector', 'launches', promptFile), 'utf8');
        assert.match(promptText, /@packages\/app\/src\/App\.jsx/);

        fs.writeFileSync(path.join(grokHome, 'active_sessions.json'), JSON.stringify([{ session_id: GROK, pid: process.pid }]));
        const before = fs.readdirSync(path.join(project, '.intent-inspector', 'launches')).length;
        const busy = await send(srv.origin, {
            agent: 'grok-build',
            targetSessionId: GROK,
            intent: 'too late',
            selection,
        });
        assert.equal(busy.ok, false);
        assert.equal(busy.code, 'target-busy');
        assert.equal(fs.readdirSync(path.join(project, '.intent-inspector', 'launches')).length, before);
    }
    finally {
        await srv.close();
    }
});

test('/agents sessions flags follow sessions: false and experimentalSessions', async () => {
    const off = buildRegistry({
        codexApp: { sessions: false },
        grokBuild: { sessions: false },
        claudeApp: false,
        cursorApp: false,
        antigravityIde: true,
    });
    const listed = await off.listAvailable();
    assert.equal(listed.find((agent) => agent.name === 'codex-app').sessions, false);
    assert.equal(listed.find((agent) => agent.name === 'grok-build').sessions, false);
    assert.equal(listed.find((agent) => agent.name === 'antigravity-ide').sessions, false);
    const on = buildRegistry({
        claudeApp: false,
        cursorApp: false,
        grokBuild: false,
        antigravityIde: { experimentalSessions: true, command: process.execPath },
    });
    const enabled = await on.listAvailable();
    assert.equal(enabled.find((agent) => agent.name === 'antigravity-ide').sessions, true);
    assert.equal(enabled.find((agent) => agent.name === 'codex-app').sessions, true);
});
