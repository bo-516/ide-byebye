import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildRegistry } from './build.js';
import { createQoderAppAdapter } from './qoder-app.js';
import { createQoderCliAdapter } from './qoder-cli.js';
import {
    buildQoderAppDeepLink,
    collectQoderCliAttachments,
    qoderAppCandidates,
    qoderCliLauncherArgs,
    resolveQoderCliCommandCandidates,
} from './qoder-route.js';

function sampleRequest(projectRoot: string, intent = 'Tighten table row padding') {
    return {
        id: 'req-qoder-1',
        createdAt: '2026-11-19T07:20:00.000Z',
        projectRoot,
        pageUrl: 'http://localhost:5173/',
        intent,
        agent: 'qoder-app',
        applyMode: 'prompt-only',
        selection: { file: path.join(projectRoot, 'src/Table.tsx'), line: 18, column: 2 },
        source: { filePath: path.join(projectRoot, 'src/Table.tsx'), startLine: 12, endLine: 25 },
        screenshots: [
            { scope: 'selection', filePath: path.join(projectRoot, '.intent-inspector/screenshots/shot.webp') },
            { scope: 'selection', filePath: '/etc/passwd' },
        ],
    };
}

test('Qoder app and CLI register by default and can be turned off', () => {
    const defaults = buildRegistry({});
    assert.equal(defaults.has('qoder-app'), true);
    assert.equal(defaults.has('qoder-cli'), true);
    assert.equal(buildRegistry({ qoderApp: false }).has('qoder-app'), false);
    assert.equal(buildRegistry({ qoderCli: { enabled: false } }).has('qoder-cli'), false);
});

test('qoderAppCandidates and buildQoderAppDeepLink follow official Qoder /chat deeplink spec', () => {
    assert.deepEqual(qoderAppCandidates({}, { platform: 'darwin', homedir: '/Users/me' }), [
        '/Applications/Qoder.app',
        '/Users/me/Applications/Qoder.app',
    ]);
    assert.equal(
        buildQoderAppDeepLink({ prompt: 'Refactor this', mode: 'agent', isNewChat: true }),
        'qoder://aicoding.aicoding-deeplink/chat?text=Refactor+this&mode=agent&isNewChat=true',
    );
});

test('createQoderAppAdapter prefills Qoder via deeplink and overflows long prompts to disk', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qoder-app-'));
    try {
        const opened: string[] = [];
        const adapter = createQoderAppAdapter({ mode: 'agent' }, {
            platform: 'darwin',
            homedir: '/Users/me',
            env: {},
            exists: (file) => file === '/Applications/Qoder.app',
            probe: async () => false,
            open: async (_cfg, target) => { opened.push(target); },
        });
        assert.equal((await adapter.isAvailable()).available, true);

        const res = await adapter.send(sampleRequest(tmp), {
            emit: () => {},
            outputDir: path.join(tmp, '.intent-inspector'),
            projectRoot: tmp,
            prompt: 'ignored\n',
        });
        assert.equal(res.ok, true);
        assert.match(opened[0], /^qoder:\/\/aicoding\.aicoding-deeplink\/chat\?text=.*&mode=agent$/);

        const overflow = await adapter.send(sampleRequest(tmp, 'z'.repeat(9000)), {
            emit: () => {},
            outputDir: path.join(tmp, '.intent-inspector'),
            projectRoot: tmp,
            prompt: 'ignored\n',
        });
        assert.equal(overflow.ok, true);
        assert.ok(overflow.writtenPromptPath && fs.existsSync(overflow.writtenPromptPath));
    }
    finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('Qoder CLI probes qodercli, filters attachments inside roots, and uses --prompt-interactive=', async () => {
    assert.deepEqual(
        resolveQoderCliCommandCandidates({}, {
            platform: 'darwin',
            homedir: '/Users/me',
            env: { QODERCLI_PATH: '/opt/qodercli' },
        }),
        ['/opt/qodercli', 'qodercli', '/Users/me/.local/bin/qodercli', '/Users/me/.qoder/bin/qodercli'],
    );
    assert.deepEqual(qoderCliLauncherArgs({ permissionMode: 'plan', model: 'performance', attachments: ['/repo/a.webp'] }), [
        { flag: '--permission-mode' },
        { value: 'plan' },
        { flag: '--model' },
        { value: 'performance' },
        { flag: '--attachment' },
        { value: '/repo/a.webp' },
        { prompt: true, prefix: '--prompt-interactive=' },
    ]);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qoder-cli-'));
    try {
        const req = sampleRequest(tmp);
        const inside = collectQoderCliAttachments(req, [tmp]);
        assert.deepEqual(inside, [path.join(tmp, '.intent-inspector/screenshots/shot.webp')]);

        const opened: string[] = [];
        const adapter = createQoderCliAdapter({ permissionMode: 'plan' }, {
            platform: 'darwin',
            homedir: '/Users/me',
            env: {},
            probe: async (cmd) => cmd === 'qodercli',
            open: async (_cfg, target) => { opened.push(target); },
        });
        assert.equal(adapter.imageInput, 'attachment');
        assert.equal(createQoderCliAdapter({ attachImages: false }).imageInput, 'path');
        assert.equal((await adapter.isAvailable()).available, true);

        const res = await adapter.send(req, {
            emit: () => {},
            outputDir: path.join(tmp, '.intent-inspector'),
            projectRoot: tmp,
            prompt: 'ignored\n',
        });
        assert.equal(res.ok, true);
        assert.match(opened[0], /\.qoder\.command$/);
        const script = fs.readFileSync(opened[0], 'utf8');
        assert.match(script, /exec 'qodercli' --permission-mode 'plan' --attachment '.*\.webp' --prompt-interactive="\$\(cat /);
        assert.equal(script.includes('/etc/passwd'), false);
    }
    finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
