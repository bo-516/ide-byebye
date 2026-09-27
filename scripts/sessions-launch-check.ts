import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRegistry } from '../src/server/agents/build.js';
import { createInspectorServer } from '../src/server/inspector-server.js';

/**
 * Boot the real inspector twice-read / twice-send against a fixture Codex home.
 *
 * Usage: `node --import tsx scripts/sessions-launch-check.ts <log-path>`
 * The log is the two GET bodies and two POST results. A boot failure is written and rethrown.
 */
const logPath = process.argv[2];
if (!logPath) {
    console.error('pass a log path');
    process.exit(1);
}

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'launch-repo-'));
const project = path.join(repo, 'packages', 'app');
const thread = '12121212-1212-4121-8121-121212121212';
const lines = [];
function record(label, value) {
    lines.push(`## ${label}`);
    lines.push(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

try {
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.git'));
    fs.mkdirSync(path.join(project, '.intent-inspector'), { recursive: true });
    const source = path.join(project, 'src', 'App.jsx');
    fs.writeFileSync(source, 'export function App() {\n  return <button>Hi</button>;\n}\n');
    const codexHome = path.join(repo, 'codex-home');
    const rollDir = path.join(codexHome, 'sessions', '2026', '09', '27');
    fs.mkdirSync(rollDir, { recursive: true });
    fs.writeFileSync(path.join(codexHome, 'session_index.jsonl'), `${JSON.stringify({
        id: thread,
        thread_name: 'Buttons',
        updated_at: '2099-09-27T00:00:00.000Z',
    })}\n`);
    fs.writeFileSync(path.join(rollDir, `rollout-x-${thread}.jsonl`), `${JSON.stringify({
        payload: { id: thread, cwd: repo, thread_source: 'user' },
    })}\n`);
    const opened = path.join(repo, 'opened.log');
    const script = path.join(repo, 'record-open.mjs');
    fs.writeFileSync(script, `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(opened)}, (process.argv[2] ?? '') + '\\n');`);
    const registry = buildRegistry({
        codexApp: {
            sessions: { home: codexHome },
            openCommand: process.execPath,
            openArgs: [script],
        },
        claudeApp: false,
        cursorApp: false,
        grokBuild: false,
    });
    const srv = await createInspectorServer({
        options: { defaultAgent: 'codex-app', applyMode: 'agent-edit' },
        token: 'launch-token',
        registry,
        sessionStore: {},
        logger: { info() {}, warn() {}, error() {}, audit() {} },
        clientCode: '',
        projectRoot: project,
        outputDirAbs: path.join(project, '.intent-inspector'),
    });
    try {
        const selection = { inspPath: `${source}:2:3` };
        for (const pass of [1, 2]) {
            const body = await (await fetch(`${srv.origin}/__intent-inspector/sessions?agent=codex-app&token=launch-token`)).json();
            record(`GET ${pass}`, body);
            if (!body.sessions?.length)
                throw new Error('fixture session list was empty');
        }
        for (const pass of [1, 2]) {
            const body = await (await fetch(`${srv.origin}/__intent-inspector/send?token=launch-token`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    agent: 'codex-app',
                    targetSessionId: thread,
                    intent: 'launch check',
                    selection,
                }),
            })).json();
            record(`POST ${pass}`, body);
            if (body.ok !== true)
                throw new Error(`send failed: ${JSON.stringify(body)}`);
        }
        const urls = fs.readFileSync(opened, 'utf8').split('\n').filter(Boolean);
        record('opened', urls);
        if (urls.length < 2 || urls.some((url) => !url.startsWith('codex://threads/')))
            throw new Error(`expected two thread deeplinks, got ${urls.join(' | ')}`);
    }
    finally {
        await srv.close();
    }
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, `${lines.join('\n')}\n`);
}
catch (err) {
    const text = err instanceof Error ? err.stack ?? err.message : String(err);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, `${lines.join('\n')}\n\nFAILED\n${text}\n`);
    throw err;
}
