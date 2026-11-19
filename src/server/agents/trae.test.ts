import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildRegistry } from './build.js';
import { createTraeAppAdapter } from './trae-app.js';
import { createTraeCliAdapter } from './trae-cli.js';
import {
    buildTraeAppDeepLink,
    resolveTraeCliCommandCandidates,
    TRAE_URI_QUERY_LIMIT,
    traeAppCandidates,
    traeCliLauncherArgs,
} from './trae-route.js';

function sampleRequest(intent = 'Make this card collapsible') {
    return {
        id: 'req-trae-1',
        createdAt: '2026-11-19T07:10:00.000Z',
        projectRoot: '/repo',
        pageUrl: 'http://localhost:5173/',
        intent,
        agent: 'trae-app',
        applyMode: 'prompt-only',
        selection: { file: '/repo/src/Card.tsx', line: 14, column: 4 },
        source: { filePath: '/repo/src/Card.tsx', startLine: 10, endLine: 22 },
    };
}

test('TRAE app and CLI register by default and can be turned off', () => {
    const defaults = buildRegistry({});
    assert.equal(defaults.has('trae-app'), true);
    assert.equal(defaults.has('trae-cli'), true);
    assert.equal(buildRegistry({ traeApp: false }).has('trae-app'), false);
    assert.equal(buildRegistry({ traeCli: { enabled: false } }).has('trae-cli'), false);
});

test('traeAppCandidates maps global Trae to trae:// and Trae CN to trae-cn://', () => {
    const all = traeAppCandidates({}, { platform: 'darwin', homedir: '/Users/me' });
    assert.deepEqual(all, [
        { appPath: '/Applications/Trae.app', scheme: 'trae' },
        { appPath: '/Users/me/Applications/Trae.app', scheme: 'trae' },
        { appPath: '/Applications/Trae CN.app', scheme: 'trae-cn' },
        { appPath: '/Users/me/Applications/Trae CN.app', scheme: 'trae-cn' },
    ]);
    const cnOnly = traeAppCandidates({ edition: 'cn' }, { platform: 'darwin', homedir: '/Users/me' });
    assert.equal(cnOnly.every((entry) => entry.scheme === 'trae-cn'), true);
    assert.equal(
        buildTraeAppDeepLink({ scheme: 'trae-cn', prompt: 'hello world' }),
        'trae-cn://trae.ai-ide/side-chat?query=hello+world',
    );
});

test('createTraeAppAdapter uses trae-cn:// for Trae CN and switches prompts over 2000 chars to a file pointer', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trae-app-'));
    try {
        const opened: string[] = [];
        const adapter = createTraeAppAdapter({}, {
            platform: 'darwin',
            homedir: '/Users/me',
            exists: (file) => file === '/Applications/Trae CN.app',
            probe: async () => false,
            open: async (_cfg, target) => { opened.push(target); },
        });
        assert.equal((await adapter.isAvailable()).available, true);

        const shortRes = await adapter.send(sampleRequest('Short edit'), {
            emit: () => {},
            outputDir: path.join(tmp, '.intent-inspector'),
            projectRoot: tmp,
            prompt: 'ignored\n',
        });
        assert.equal(shortRes.ok, true);
        assert.equal(shortRes.writtenPromptPath, undefined);
        assert.match(opened[0], /^trae-cn:\/\/trae\.ai-ide\/side-chat\?query=/);

        const longRes = await adapter.send(sampleRequest('y'.repeat(2500)), {
            emit: () => {},
            outputDir: path.join(tmp, '.intent-inspector'),
            projectRoot: tmp,
            prompt: 'ignored\n',
        });
        assert.equal(longRes.ok, true);
        assert.ok(longRes.writtenPromptPath && fs.existsSync(longRes.writtenPromptPath));
        const query = new URL(opened[1]).searchParams.get('query') ?? '';
        assert.ok(query.length <= TRAE_URI_QUERY_LIMIT);
    }
    finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('TRAE CLI resolves install_v2.sh paths and writes --cd launcher scripts', async () => {
    assert.deepEqual(
        resolveTraeCliCommandCandidates({}, { platform: 'darwin', homedir: '/Users/me', env: {} }),
        ['traecli', '/Users/me/.local/bin/traecli', '/Users/me/.local/share/traecli/current/traex'],
    );
    assert.deepEqual(traeCliLauncherArgs('/repo', { permissionMode: 'auto' }), [
        { flag: '--cd' },
        { value: '/repo' },
        { flag: '--permission-mode' },
        { value: 'auto' },
        { endOfOptions: true },
        { prompt: true },
    ]);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trae-cli-'));
    try {
        const opened: string[] = [];
        const adapter = createTraeCliAdapter({ permissionMode: 'auto' }, {
            platform: 'darwin',
            homedir: '/Users/me',
            env: {},
            probe: async (cmd) => cmd === '/Users/me/.local/bin/traecli',
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
        assert.match(opened[0], /\.trae\.command$/);
        const script = fs.readFileSync(opened[0], 'utf8');
        assert.match(script, /exec '\/Users\/me\/\.local\/bin\/traecli' --cd '.*' --permission-mode 'auto' -- "\$\(cat /);
    }
    finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
