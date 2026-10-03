import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createClaudeCliAdapter } from './claude-cli.js';
import { claudeCliHandlerPath, resolveClaudeCliCommand, type ClaudeCliDeps } from './claude-cli-host.js';

/** Where the fake macOS home keeps the handler link. */
const HANDLER = claudeCliHandlerPath({ platform: 'darwin', homedir: '/Users/me', env: {} }) as string;

/**
 * Fake host: macOS, `claude` at `~/.local/bin/claude`, every open recorded instead of run.
 *
 * @param {{ handler?: boolean, cli?: boolean }} found Whether the handler link resolves and the CLI answers `--version`.
 * @param {Partial<ClaudeCliDeps>} [extra] Further overrides.
 * @returns {{ deps: Partial<ClaudeCliDeps>, opened: string[], probed: string[] }} Overrides plus the recorded calls.
 */
function fakeHost(found: { handler?: boolean, cli?: boolean }, extra: Partial<ClaudeCliDeps> = {}) {
    const opened: string[] = [];
    const probed: string[] = [];
    const deps: Partial<ClaudeCliDeps> = {
        platform: 'darwin',
        homedir: '/Users/me',
        env: {},
        exists: (file) => file === HANDLER && found.handler === true,
        readlink: () => null,
        probe: async (command) => {
            probed.push(command);
            return found.cli === true && command === '/Users/me/.local/bin/claude';
        },
        registryHasHandler: async () => false,
        open: async (_config, target) => {
            opened.push(target);
        },
        ...extra,
    };
    return { deps, opened, probed };
}

/** `send` arguments of the adapter under test. */
type SendArgs = Parameters<ReturnType<typeof createClaudeCliAdapter>['send']>;

/**
 * Run `fn` against a throwaway project and a request whose intent is `intent`.
 *
 * @param {string} intent User intent.
 * @param {(input: { projectRoot: string, request: SendArgs[0], context: SendArgs[1] }) => Promise<void>} fn Test body.
 */
async function withRequest(intent: string, fn: (input: { projectRoot: string, request: SendArgs[0], context: SendArgs[1] }) => Promise<void>) {
    // Realpath: macOS tmpdir is a /var symlink, and prompt paths are made relative against the real root.
    const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ide-byebye-claude-cli-')));
    const request = {
        id: 'r1',
        createdAt: '2026-10-03T07:30:00.000Z',
        agent: 'claude-cli',
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

test('isAvailable: the handler or the CLI is enough; neither greys the row out (FR-4, AC-3)', async () => {
    for (const [handler, cli, available] of [[true, true, true], [true, false, true], [false, true, true], [false, false, false]]) {
        const result = await createClaudeCliAdapter({}, fakeHost({ handler, cli }).deps).isAvailable();
        assert.equal(result.available, available, `handler=${handler} cli=${cli}`);
        if (!available)
            assert.match(String(result.reason), /run "claude" once/);
    }
    // A forced route only counts its own requirement.
    assert.equal((await createClaudeCliAdapter({ launch: 'terminal' }, fakeHost({ handler: true }).deps).isAvailable()).available, false);
    assert.equal((await createClaudeCliAdapter({ launch: 'deeplink' }, fakeHost({ cli: true }).deps).isAvailable()).available, false);
});

test('a short prompt opens claude-cli:// with cwd and the prompt prefilled, without probing the CLI (AC-1)', async () => {
    await withRequest('把间距改成 8px & keep it +1', async ({ projectRoot, request, context }) => {
        const host = fakeHost({ handler: true, cli: true });
        const result = await createClaudeCliAdapter({}, host.deps).send(request, context);
        assert.equal(result.ok, true, String(result.error));
        assert.equal(host.opened.length, 1);
        const url = new URL(host.opened[0]);
        assert.equal(url.protocol, 'claude-cli:');
        assert.equal(url.searchParams.get('cwd'), projectRoot);
        assert.equal(url.searchParams.get('q'), '@src/App.tsx #42\n\n把间距改成 8px & keep it +1\n');
        assert.match(String(result.output), /prefilled/);
        assert.deepEqual(host.probed, []);
        assert.equal(fs.existsSync(path.join(projectRoot, '.intent-inspector')), false, 'the deeplink route writes no files');
    });
});

test('a 6000-character prompt goes to a Terminal launcher that submits it (AC-2)', async () => {
    await withRequest('x'.repeat(6000), async ({ request, context }) => {
        const host = fakeHost({ handler: true, cli: true });
        const result = await createClaudeCliAdapter({}, host.deps).send(request, context);
        assert.equal(result.ok, true, String(result.error));
        const launchPath = host.opened[0];
        assert.match(path.basename(launchPath), /^2026-10-03T07-30-00-r1\.claude\.command$/);
        const promptPath = launchPath.replace(/\.command$/, '.prompt.txt');
        assert.equal(fs.readFileSync(launchPath, 'utf8').split('\n')[3], `exec '/Users/me/.local/bin/claude' -- "$(cat '${promptPath}')"`);
        assert.match(fs.readFileSync(promptPath, 'utf8'), /^@src\/App\.tsx #42\n\nx{6000}\n$/);
        assert.match(String(result.output), /submitted/);
        assert.equal(result.writtenPromptPath, promptPath);
    });
});

test('launch deeplink sends a file pointer whose decoded q fits the handler (AC-4)', async () => {
    await withRequest('y'.repeat(6000), async ({ request, context }) => {
        const host = fakeHost({ handler: true, cli: true });
        const result = await createClaudeCliAdapter({ launch: 'deeplink' }, host.deps).send(request, context);
        assert.equal(result.ok, true, String(result.error));
        const query = new URL(host.opened[0]).searchParams.get('q') as string;
        assert.ok(query.length <= 5000, `q is ${query.length} characters`);
        assert.match(query, /^@src\/App\.tsx #42\n\.intent-inspector\/requests\/2026-10-03T07-30-00-r1\.md\n\ny+…\n$/);
        assert.ok(fs.existsSync(String(result.writtenPromptPath)));
        assert.match(String(result.output), /Full request context was written to/);
        assert.deepEqual(host.probed, []);
    });
});

test('promptMode file and permissionMode reach the Terminal launcher', async () => {
    await withRequest('short', async ({ request, context }) => {
        const host = fakeHost({ cli: true });
        const result = await createClaudeCliAdapter({ promptMode: 'file', permissionMode: 'plan' }, host.deps).send(request, context);
        assert.equal(result.ok, true, String(result.error));
        assert.match(fs.readFileSync(host.opened[0], 'utf8'), /--permission-mode 'plan' -- "\$\(cat /);
        assert.match(String(result.output), /submitted the prompt .*Full request context was written to .*requests/);
    });
});

test('a failing opener or a missing route returns ok: false with a failed event', async () => {
    await withRequest('hi', async ({ request, context }) => {
        const broken = fakeHost({ handler: true }, { open: async () => { throw new Error('open failed with exit code 1'); } });
        const result = await createClaudeCliAdapter({}, broken.deps).send(request, context);
        assert.equal(result.ok, false);
        assert.equal(result.error, 'open failed with exit code 1');
        assert.deepEqual(result.events.at(-1), { type: 'failed', text: 'open failed with exit code 1' });
        const none = await createClaudeCliAdapter({}, fakeHost({}).deps).send(request, context);
        assert.equal(none.ok, false);
        assert.match(String(none.error), /run "claude" once/);
    });
});

test('Windows checks the registry and writes a .cmd launcher', async () => {
    await withRequest('z'.repeat(6000), async ({ request, context }) => {
        const host = fakeHost({ cli: true }, { platform: 'win32', registryHasHandler: async () => true });
        assert.equal((await createClaudeCliAdapter({}, host.deps).isAvailable()).available, true);
        const result = await createClaudeCliAdapter({}, host.deps).send(request, context);
        assert.equal(result.ok, true, String(result.error));
        assert.match(host.opened[0], /\.claude\.cmd$/);
        assert.match(fs.readFileSync(host.opened[0], 'utf8'), /^@echo off\r\npowershell\.exe /);
    });
});

test('the CLI the macOS handler links to is the last candidate', async () => {
    const probed: string[] = [];
    const command = await resolveClaudeCliCommand({}, {
        ...(fakeHost({}).deps as ClaudeCliDeps),
        readlink: () => '/opt/homebrew/bin/claude',
        probe: async (candidate) => {
            probed.push(candidate);
            return candidate === '/opt/homebrew/bin/claude';
        },
    });
    assert.equal(command, '/opt/homebrew/bin/claude');
    assert.deepEqual(probed, ['claude', '/Users/me/.local/bin/claude', '/Users/me/.claude/local/claude', '/opt/homebrew/bin/claude']);
    assert.equal(claudeCliHandlerPath({ platform: 'linux', homedir: '/home/me', env: { XDG_DATA_HOME: '/data' } }), '/data/applications/claude-code-url-handler.desktop');
    assert.equal(claudeCliHandlerPath({ platform: 'win32', homedir: 'C:\\Users\\me', env: {} }), null);
});
