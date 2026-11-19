import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildRegistry } from './build.js';
import { createAntigravityAdapter, type AntigravityDeps } from './antigravity.js';
import {
    antigravityLauncherExtension,
    buildAntigravityFilePrompt,
    buildAntigravityLauncherFile,
    buildAntigravityLauncherScript,
    buildAntigravityPrompt,
    resolveAntigravityCommandCandidates,
    resolveAntigravityProjectRoot,
    shouldWriteAntigravityPromptFile,
} from './antigravity-launcher.js';

test('Antigravity is registered by default and can be turned off in config', () => {
    assert.equal(buildRegistry({}).has('antigravity'), true);
    assert.equal(buildRegistry({ antigravity: false }).has('antigravity'), false);
    assert.equal(buildRegistry({ antigravity: { enabled: false } }).has('antigravity'), false);
    const enabled = buildRegistry({ antigravity: { command: '/opt/agy', mode: 'plan' } });
    assert.equal(enabled.has('antigravity'), true);
    assert.equal(enabled.has('antigravity-ide'), true);
});

test('both Antigravity agents register by default in order after devin-cli', () => {
    const names = buildRegistry({}).names();
    const idx = names.indexOf('devin-cli');
    assert.deepEqual(names.slice(idx + 1, idx + 3), ['antigravity-ide', 'antigravity']);
});

test('resolveAntigravityCommandCandidates prefers command, then the user install', () => {
    assert.deepEqual(resolveAntigravityCommandCandidates({ command: '/opt/agy' }), ['/opt/agy']);
    assert.deepEqual(
        resolveAntigravityCommandCandidates({}, { platform: 'darwin', homedir: '/Users/me' }),
        ['agy', path.join('/Users/me', '.local', 'bin', 'agy')],
    );
    assert.deepEqual(
        resolveAntigravityCommandCandidates({}, { platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' } }),
        ['agy', path.join('C:\\Users\\me\\AppData\\Local', 'agy', 'bin', 'agy.exe')],
    );
    assert.equal(resolveAntigravityCommandCandidates({}, { platform: 'linux', homedir: os.homedir() })[0], 'agy');
});

test('resolveAntigravityProjectRoot uses the override, else the bundler root', () => {
    assert.equal(
        resolveAntigravityProjectRoot({ projectRoot: 'fixtures/app' }, { projectRoot: '/tmp/vite-root' }),
        path.resolve('fixtures/app'),
    );
    assert.equal(resolveAntigravityProjectRoot({}, { projectRoot: '/tmp/vite-root' }), '/tmp/vite-root');
});

test('shouldWriteAntigravityPromptFile honors file mode and the argv budget', () => {
    assert.equal(shouldWriteAntigravityPromptFile({ promptMode: 'file' }, 'short'), true);
    assert.equal(shouldWriteAntigravityPromptFile({ promptMode: 'auto' }, 'short'), false);
    assert.equal(shouldWriteAntigravityPromptFile({ promptArgLimit: 4 }, 'hello'), true);
    assert.equal(shouldWriteAntigravityPromptFile({}, 'x'.repeat(12001)), true);
});

test('buildAntigravityPrompt keeps source refs relative to the CLI cwd', () => {
    const prompt = buildAntigravityPrompt({
        projectRoot: '/tmp/repo/apps/web',
        intent: 'Tighten the button',
        selection: { line: 4 },
        source: { filePath: '/tmp/repo/apps/web/src/App.tsx' },
    }, { projectRoot: '/tmp/repo' });
    assert.match(prompt, /@apps\/web\/src\/App\.tsx/);
    assert.match(prompt, /Tighten the button/);
});

test('buildAntigravityFilePrompt points at the handoff without inlining the full request', () => {
    const prompt = buildAntigravityFilePrompt({
        projectRoot: '/tmp/repo',
        intent: 'Look here',
    }, '/tmp/repo/.intent-inspector/requests/a.md', {});
    assert.match(prompt, /\.intent-inspector\/requests\/a\.md/);
    assert.match(prompt, /Look here/);
});

test('buildAntigravityLauncherScript quotes paths and reads the prompt from disk', () => {
    const script = buildAntigravityLauncherScript({
        command: '/opt/agy',
        cwd: "/tmp/it's",
        promptPath: '/tmp/prompt.txt',
        mode: 'plan',
    });
    assert.match(script, /cd '\/tmp\/it'\\''s'/);
    assert.match(script, /exec '\/opt\/agy' --mode 'plan' --prompt-interactive "\$\(cat '\/tmp\/prompt\.txt'\)"/);
    const withoutMode = buildAntigravityLauncherScript({
        command: 'agy',
        cwd: '/tmp/proj',
        promptPath: '/tmp/proj/p.txt',
    });
    assert.doesNotMatch(withoutMode, /--mode/);
    assert.match(withoutMode, /exec 'agy' --prompt-interactive/);
});

test('buildAntigravityLauncherFile encodes the Windows launcher', () => {
    assert.equal(antigravityLauncherExtension('darwin'), '.command');
    const script = buildAntigravityLauncherFile({
        command: 'agy.exe',
        cwd: 'C:\\repo',
        promptPath: 'C:\\repo\\prompt.txt',
        mode: 'accept-edits',
    }, 'win32');
    const encoded = script.split('EncodedCommand ')[1].trim();
    const program = Buffer.from(encoded, 'base64').toString('utf16le');
    assert.match(program, /--mode 'accept-edits' --prompt-interactive \$prompt/);
    assert.match(program, /Get-Content -LiteralPath 'C:\\repo\\prompt\.txt'/);
});

/** `send` arguments of the adapter under test. */
type SendArgs = Parameters<ReturnType<typeof createAntigravityAdapter>['send']>;

/**
 * Run `fn` against a throwaway project and a request whose intent is `intent`.
 *
 * @param {string} intent User intent.
 * @param {(input: { projectRoot: string, request: SendArgs[0], context: SendArgs[1] }) => Promise<void>} fn Test body.
 */
async function withRequest(intent: string, fn: (input: { projectRoot: string, request: SendArgs[0], context: SendArgs[1] }) => Promise<void>) {
    // Realpath: macOS tmpdir is a /var symlink, and prompt paths are made relative against the real root.
    const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ide-byebye-antigravity-')));
    const request = {
        id: 'r1',
        createdAt: '2026-11-19T04:00:00.000Z',
        projectRoot,
        intent,
        selection: { line: 145 },
        source: { filePath: path.join(projectRoot, 'src', 'views', 'CreatorProfile.vue'), selectedNodeRange: { startLine: 145, endLine: 224 } },
    };
    const context = { emit: () => {}, outputDir: path.join(projectRoot, '.intent-inspector'), projectRoot, prompt: '' };
    try {
        await fn({ projectRoot, request, context });
    }
    finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
    }
}

/**
 * Fake host with the desktop app installed and the given project resolved.
 *
 * @param {{ id: string, name: string } | null} project Antigravity project for the project root.
 * @returns {{ deps: Partial<AntigravityDeps>, opened: string[] }} Overrides plus the opened targets.
 */
function desktopHost(project: { id: string, name: string } | null) {
    const opened: string[] = [];
    const deps: Partial<AntigravityDeps> = {
        findApp: () => '/Applications/Antigravity.app',
        findProject: () => (project ? { ...project, folders: [] } : null),
        open: async (_config, target) => {
            opened.push(target);
        },
    };
    return { deps, opened };
}

test('the desktop route opens the prompt link in the matching project', async () => {
    await withRequest('Make the card wider', async ({ request, context }) => {
        const host = desktopHost({ id: 'ce4ea324-94f2-4abf-b32f-aeb9b3a908c7', name: 'novel' });
        const result = await createAntigravityAdapter({}, host.deps).send(request, context);
        assert.equal(result.ok, true, String(result.error));
        assert.equal(host.opened.length, 1);
        const url = new URL(host.opened[0]);
        assert.equal(`${url.protocol}//${url.hostname}`, 'antigravity://open');
        assert.equal(url.searchParams.get('project'), 'ce4ea324-94f2-4abf-b32f-aeb9b3a908c7');
        assert.match(url.searchParams.get('prompt') as string, /^@src\/views\/CreatorProfile\.vue #145-224\n/);
        assert.match(url.searchParams.get('prompt') as string, /Make the card wider/);
        assert.equal(result.writtenPromptPath, undefined);
        assert.match(String(result.output), /in the novel project/);
    });
});

test('without a matching project the link keeps the current project and says so', async () => {
    await withRequest('hi', async ({ projectRoot, request, context }) => {
        const host = desktopHost(null);
        const result = await createAntigravityAdapter({}, host.deps).send(request, context);
        assert.equal(result.ok, true, String(result.error));
        assert.equal(new URL(host.opened[0]).searchParams.has('project'), false);
        assert.match(String(result.output), new RegExp(`No Antigravity project contains ${projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    });
});

test('a link longer than promptUrlLimit becomes a file pointer, and promptMode file always does', async () => {
    await withRequest('long '.repeat(400), async ({ request, context }) => {
        const host = desktopHost(null);
        const result = await createAntigravityAdapter({ promptUrlLimit: 600 }, host.deps).send(request, context);
        assert.equal(result.ok, true, String(result.error));
        assert.ok(host.opened[0].length <= 600);
        const prompt = new URL(host.opened[0]).searchParams.get('prompt') as string;
        assert.match(prompt, /\.intent-inspector\/requests\/2026-11-19T04-00-00-r1\.md/);
        assert.ok(fs.existsSync(String(result.writtenPromptPath)));
        assert.match(String(result.output), /Full request context was written to/);
    });
    await withRequest('short', async ({ request, context }) => {
        const host = desktopHost(null);
        const result = await createAntigravityAdapter({ promptMode: 'file' }, host.deps).send(request, context);
        assert.equal(result.ok, true, String(result.error));
        assert.ok(fs.existsSync(String(result.writtenPromptPath)));
    });
});

test('an opener failure is reported as a failed send', async () => {
    await withRequest('hi', async ({ request, context }) => {
        const host = desktopHost(null);
        const result = await createAntigravityAdapter({}, {
            ...host.deps,
            open: async () => {
                throw new Error('No application knows how to open antigravity://');
            },
        }).send(request, context);
        assert.equal(result.ok, false);
        assert.match(String(result.error), /No application knows/);
        assert.equal(result.events.at(-1)?.type, 'failed');
    });
});
