import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createOpenCodeAdapter, type OpenCodeDeps } from './opencode.js';

/** The bundled 2.x CLI path inside the default app location. */
const BUNDLED_CLI = '/Applications/OpenCode.app/Contents/Resources/opencode-cli';

/**
 * Fake macOS host with the OpenCode desktop installed at `/Applications/OpenCode.app` (or not).
 *
 * @param {{ version?: string, cli?: string[] }} host Desktop version (omit for no app) and the CLIs that answer `--version`.
 * @param {Partial<OpenCodeDeps>} [extra] Further overrides.
 * @returns {{ deps: Partial<OpenCodeDeps>, opened: string[], probed: string[] }} Overrides plus the recorded calls.
 */
function fakeHost(host: { version?: string, cli?: string[] }, extra: Partial<OpenCodeDeps> = {}) {
    const opened: string[] = [];
    const probed: string[] = [];
    const deps: Partial<OpenCodeDeps> = {
        platform: 'darwin',
        homedir: '/Users/me',
        exists: (file) => host.version !== undefined && file === '/Applications/OpenCode.app',
        readHead: (file) => (host.version !== undefined && file === '/Applications/OpenCode.app/Contents/Info.plist'
            ? `<plist><dict><key>CFBundleShortVersionString</key>\n<string>${host.version}</string></dict></plist>`
            : null),
        probe: async (command) => {
            probed.push(command);
            return (host.cli ?? []).includes(command);
        },
        open: async (_config, target) => {
            opened.push(target);
        },
        ...extra,
    };
    return { deps, opened, probed };
}

/**
 * Run `fn` against a throwaway project and a request whose intent is `intent`.
 *
 * @param {string} intent User intent. @param {(input: { projectRoot: string, request: any, context: any }) =>
 * Promise<void>} fn Test body.
 */
async function withRequest(intent: string, fn: (input: { projectRoot: string, request: any, context: any }) => Promise<void>) {
    // Realpath: macOS tmpdir is a /var symlink, and prompt paths are made relative against the real root.
    const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ide-byebye-opencode-')));
    const request = {
        id: 'r1',
        createdAt: '2026-10-03T07:30:00.000Z',
        agent: 'opencode',
        applyMode: 'prompt-only',
        pageUrl: 'http://localhost:5300/',
        projectRoot,
        intent,
        selection: { file: 'src/App.tsx', line: 42, column: 3 },
        source: { filePath: path.join(projectRoot, 'src', 'App.tsx'), selectedNodeRange: { startLine: 42, endLine: 42 } },
    };
    const context = { emit: () => {}, outputDir: path.join(projectRoot, '.intent-inspector'), projectRoot, prompt: '' };
    try {
        await fn({ projectRoot, request, context });
    }
    finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
    }
}

test('isAvailable: a 1.x desktop or any CLI is enough, including the CLI inside a 2.x app (FR-8, AC-7)', async () => {
    const available = async (host: { version?: string, cli?: string[] }) => (await createOpenCodeAdapter({}, fakeHost(host).deps).isAvailable()).available;
    assert.equal(await available({ version: '1.18.34' }), true);
    assert.equal(await available({ version: '2.0.6', cli: [BUNDLED_CLI] }), true);
    assert.equal(await available({ cli: ['opencode'] }), true);
    const none = await createOpenCodeAdapter({}, fakeHost({}).deps).isAvailable();
    assert.equal(none.available, false);
    assert.match(String(none.reason), /OpenCode not found.*opencode\.ai\/download/);
});

test('a 1.x desktop on macOS gets a prefilled new-session deeplink without probing any CLI (AC-5)', async () => {
    await withRequest('把间距改成 8px', async ({ projectRoot, request, context }) => {
        const host = fakeHost({ version: '1.18.34', cli: ['opencode'] });
        const result = await createOpenCodeAdapter({}, host.deps).send(request, context);
        assert.equal(result.ok, true, String(result.error));
        const url = new URL(host.opened[0]);
        assert.equal(url.protocol, 'opencode:');
        assert.equal(url.hostname, 'new-session');
        assert.equal(url.searchParams.get('directory'), projectRoot);
        assert.equal(url.searchParams.get('prompt'), '@src/App.tsx #42\n\n把间距改成 8px\n');
        assert.match(String(result.output), /prefilled in a new session/);
        assert.deepEqual(host.probed, []);
    });
});

test('2.0.6 with no opencode on PATH runs the bundled CLI in Terminal and submits (AC-6)', async () => {
    await withRequest('-leading dash stays the prompt', async ({ projectRoot, request, context }) => {
        const host = fakeHost({ version: '2.0.6', cli: [BUNDLED_CLI] });
        const result = await createOpenCodeAdapter({}, host.deps).send(request, context);
        assert.equal(result.ok, true, String(result.error));
        const launchPath = host.opened[0];
        assert.match(path.basename(launchPath), /^2026-10-03T07-30-00-r1\.opencode\.command$/);
        const promptPath = launchPath.replace(/\.command$/, '.prompt.txt');
        assert.equal(
            fs.readFileSync(launchPath, 'utf8').split('\n')[3],
            `exec '${BUNDLED_CLI}' '${projectRoot}' --prompt="$(cat '${promptPath}')"`,
        );
        assert.equal(fs.readFileSync(promptPath, 'utf8'), '@src/App.tsx #42\n\n-leading dash stays the prompt\n');
        assert.match(String(result.output), /in Terminal and submitted the prompt/);
        assert.deepEqual(host.probed, ['opencode', '/Users/me/.opencode/bin/opencode', BUNDLED_CLI]);
    });
});

test('launch app on Linux sends the deeplink without any version check (AC-11)', async () => {
    await withRequest('hi', async ({ request, context }) => {
        const host = fakeHost({}, { platform: 'linux', readHead: () => assert.fail('no plist read off macOS') });
        const result = await createOpenCodeAdapter({ launch: 'app' }, host.deps).send(request, context);
        assert.equal(result.ok, true, String(result.error));
        assert.match(host.opened[0], /^opencode:\/\/new-session\?directory=/);
        assert.deepEqual(host.probed, []);
    });
});

test('an app-route prompt longer than promptUrlLimit becomes a file pointer', async () => {
    await withRequest('long '.repeat(400), async ({ request, context }) => {
        const host = fakeHost({ version: '1.18.34' });
        const result = await createOpenCodeAdapter({ promptUrlLimit: 500 }, host.deps).send(request, context);
        assert.equal(result.ok, true, String(result.error));
        const prompt = new URL(host.opened[0]).searchParams.get('prompt') as string;
        assert.match(prompt, /^@src\/App\.tsx #42\n\.intent-inspector\/requests\/2026-10-03T07-30-00-r1\.md\n\nlong /);
        assert.ok(fs.existsSync(String(result.writtenPromptPath)));
        assert.match(String(result.output), /Full request context was written to/);
    });
});

test('launch terminal ignores a 1.x desktop; nothing installed fails with the reason', async () => {
    await withRequest('hi', async ({ request, context }) => {
        const terminal = fakeHost({ version: '1.18.34', cli: ['opencode'] });
        const result = await createOpenCodeAdapter({ launch: 'terminal' }, terminal.deps).send(request, context);
        assert.equal(result.ok, true, String(result.error));
        assert.match(terminal.opened[0], /\.opencode\.command$/);
        const none = await createOpenCodeAdapter({}, fakeHost({}).deps).send(request, context);
        assert.equal(none.ok, false);
        assert.match(String(none.error), /OpenCode not found/);
        assert.equal(none.events.at(-1)?.type, 'failed');
    });
});
