import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildRegistry } from './build.js';
import { createWorkBuddyAppAdapter } from './workbuddy-app.js';
import { createWorkBuddyCliAdapter } from './workbuddy-cli.js';
import {
    buildWorkBuddyAppDeepLink,
    resolveWorkBuddyCliCommandCandidates,
    resolveWorkBuddyScheme,
    workBuddyAppCandidates,
    workBuddyCliLauncherArgs,
} from './workbuddy-route.js';

function sampleRequest(intent = 'Align the primary button') {
    return {
        id: 'req-wb-1',
        createdAt: '2026-11-19T07:00:00.000Z',
        projectRoot: '/repo',
        pageUrl: 'http://localhost:5173/',
        intent,
        agent: 'workbuddy-app',
        applyMode: 'prompt-only',
        selection: { file: '/repo/src/App.tsx', line: 10, column: 2 },
        source: { filePath: '/repo/src/App.tsx', startLine: 8, endLine: 16 },
    };
}

test('WorkBuddy app and CLI register by default and can be disabled individually', () => {
    const defaults = buildRegistry({});
    assert.equal(defaults.has('workbuddy-app'), true);
    assert.equal(defaults.has('workbuddy-cli'), true);
    assert.equal(buildRegistry({ workbuddyApp: false }).has('workbuddy-app'), false);
    assert.equal(buildRegistry({ workbuddyCli: { enabled: false } }).has('workbuddy-cli'), false);
});

test('workBuddyAppCandidates and resolveWorkBuddyScheme handle WorkBuddy AI and legacy WorkBuddy bundles', () => {
    assert.deepEqual(workBuddyAppCandidates({}, { platform: 'darwin', homedir: '/Users/me' }), [
        '/Applications/WorkBuddy AI.app',
        '/Users/me/Applications/WorkBuddy AI.app',
        '/Applications/WorkBuddy.app',
        '/Users/me/Applications/WorkBuddy.app',
    ]);
    assert.equal(resolveWorkBuddyScheme({}, '/Applications/WorkBuddy AI.app'), 'workbuddy-ai');
    assert.equal(resolveWorkBuddyScheme({}, '/Applications/WorkBuddy.app'), 'workbuddy');
    assert.equal(resolveWorkBuddyScheme({ scheme: 'custom-wb:' }, '/Applications/WorkBuddy.app'), 'custom-wb');
    assert.throws(() => resolveWorkBuddyScheme({ scheme: 'bad scheme' }), /Invalid WorkBuddy URL scheme/);
});

test('buildWorkBuddyAppDeepLink encodes task start parameters and omits invalid enum values', () => {
    const url = new URL(buildWorkBuddyAppDeepLink({
        scheme: 'workbuddy-ai',
        prompt: 'Fix header spacing',
        cwd: '/Users/me/my repo',
        welcomeMode: 'invalid',
        permissionMode: 'fullAccess',
        model: 'hunyuan-t1',
    }));
    assert.equal(url.protocol, 'workbuddy-ai:');
    assert.equal(url.host, 'task');
    assert.equal(url.searchParams.get('action'), 'start');
    assert.equal(url.searchParams.get('prompt'), 'Fix header spacing');
    assert.equal(url.searchParams.get('cwd'), '/Users/me/my repo');
    assert.equal(url.searchParams.get('welcomeMode'), 'code');
    assert.equal(url.searchParams.get('permissionMode'), 'fullAccess');
    assert.equal(url.searchParams.get('model'), 'hunyuan-t1');
});

test('createWorkBuddyAppAdapter prefills via workbuddy-ai:// and overflows oversized prompts to a file pointer', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-app-'));
    try {
        const opened: string[] = [];
        const unavailable = createWorkBuddyAppAdapter({}, {
            platform: 'darwin',
            homedir: '/Users/me',
            exists: () => false,
            open: async (_cfg, target) => { opened.push(target); },
        });
        assert.equal((await unavailable.isAvailable()).available, false);

        const adapter = createWorkBuddyAppAdapter({}, {
            platform: 'darwin',
            homedir: '/Users/me',
            exists: (file) => file === '/Applications/WorkBuddy AI.app',
            open: async (_cfg, target) => { opened.push(target); },
        });
        assert.equal((await adapter.isAvailable()).available, true);

        const shortRes = await adapter.send(sampleRequest(), {
            emit: () => {},
            outputDir: path.join(tmp, '.intent-inspector'),
            projectRoot: tmp,
            prompt: 'ignored\n',
        });
        assert.equal(shortRes.ok, true);
        assert.equal(shortRes.writtenPromptPath, undefined);
        assert.match(opened[0], /^workbuddy-ai:\/\/task\?action=start&prompt=/);

        const longRes = await adapter.send(sampleRequest('x'.repeat(9000)), {
            emit: () => {},
            outputDir: path.join(tmp, '.intent-inspector'),
            projectRoot: tmp,
            prompt: 'ignored\n',
        });
        assert.equal(longRes.ok, true);
        assert.ok(longRes.writtenPromptPath && fs.existsSync(longRes.writtenPromptPath));
        const parsed = new URL(opened[1]);
        assert.ok((parsed.searchParams.get('prompt') ?? '').length <= 8000);
    }
    finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('WorkBuddy CLI resolves bundled codebuddy binary and writes POSIX / Windows launchers', async () => {
    const candidates = resolveWorkBuddyCliCommandCandidates({}, {
        platform: 'darwin',
        homedir: '/Users/me',
        appPath: '/Applications/WorkBuddy AI.app',
    });
    assert.deepEqual(candidates, [
        'codebuddy',
        '/Users/me/.local/bin/codebuddy',
        '/Users/me/.codebuddy/bin/codebuddy',
        '/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy',
    ]);
    assert.deepEqual(workBuddyCliLauncherArgs({ permissionMode: 'plan', model: 'sonnet' }), [
        { flag: '--permission-mode' },
        { value: 'plan' },
        { flag: '--model' },
        { value: 'sonnet' },
        { endOfOptions: true },
        { prompt: true },
    ]);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-cli-'));
    try {
        const opened: string[] = [];
        const bundled = '/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy';
        const adapter = createWorkBuddyCliAdapter({ permissionMode: 'plan' }, {
            platform: 'darwin',
            homedir: '/Users/me',
            exists: (file) => file === '/Applications/WorkBuddy AI.app',
            probe: async (cmd) => cmd === bundled,
            open: async (_cfg, target) => { opened.push(target); },
        });
        assert.equal((await adapter.isAvailable()).available, true);
        const res = await adapter.send(sampleRequest(), {
            emit: () => {},
            outputDir: path.join(tmp, '.intent-inspector'),
            projectRoot: tmp,
            prompt: 'ignored\n',
        });
        assert.equal(res.ok, true);
        assert.match(opened[0], /\.workbuddy\.command$/);
        const script = fs.readFileSync(opened[0], 'utf8');
        assert.match(script, /exec '\/Applications\/WorkBuddy AI\.app\/Contents\/Resources\/app\.asar\.unpacked\/cli\/bin\/codebuddy' --permission-mode 'plan' -- "\$\(cat /);
    }
    finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
