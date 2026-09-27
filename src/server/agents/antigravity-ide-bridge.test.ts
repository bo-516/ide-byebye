import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    antigravityIdeBridgeIsRunning,
    deliverAntigravityIdePrompt,
    installAntigravityIdeBridge,
    writeAntigravityIdeBridgeRequest,
} from './antigravity-ide-bridge.js';
import {
    antigravityIdeWorkspaceId,
    antigravityIdeWorkspaceSlug,
    chooseAntigravityIdeExtensionHost,
    parseProcessTable,
} from './antigravity-ide-bridge-host.js';
import { BRIDGE_EXTENSION_SOURCE } from './antigravity-ide-bridge-extension.js';

test('antigravityIdeWorkspaceId hashes the file URL', () => {
    assert.equal(
        antigravityIdeWorkspaceId('/Users/shaoboli/Desktop/code/mira-mono/novel/plugins/ai-inspector/demo'),
        '33484dad99d77253eece8344df21f46d9bf199c624b2eb3dd296662338f634f6',
    );
    assert.equal(
        antigravityIdeWorkspaceSlug('/Users/shaoboli/Documents/code-idea/agent-mock'),
        'file_Users_shaoboli_Documents_code_idea_agent_mock',
    );
});

test('chooseAntigravityIdeExtensionHost follows the language server for that folder', () => {
    const workspace = '/tmp/demo';
    const id = antigravityIdeWorkspaceId(workspace);
    const processes = parseProcessTable(`
  10 /Applications/Antigravity IDE.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm --app_data_dir antigravity-ide --workspace_id ${id} --extension_server_port 54323
  11 /Applications/Antigravity IDE.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm --app_data_dir antigravity-ide --subclient_type hub --workspace_id ${id} --extension_server_port 1
  20 /Applications/Antigravity IDE.app/Contents/Frameworks/Antigravity IDE Helper (Plugin).app/Contents/MacOS/Antigravity IDE Helper (Plugin) --type=utility --utility-sub-type=node.mojom.NodeService
  99 /usr/bin/node
`);
    assert.equal(chooseAntigravityIdeExtensionHost({
        processes,
        workspacePath: workspace,
        listenerPidsByPort: new Map([[54323, [20]], [1, [99]]]),
    }), 20);
    assert.equal(chooseAntigravityIdeExtensionHost({
        processes,
        workspacePath: '/tmp/other',
        listenerPidsByPort: new Map([[54323, [20]]]),
    }), null);
});

test('deliverAntigravityIdePrompt resolves when the bridge acks without restarting a host', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-bridge-'));
    const restarted = [];
    await deliverAntigravityIdePrompt({
        id: 'request-id-1',
        workspacePath: '/tmp/demo',
        message: 'fill the input',
        home,
        hooks: {
            listProcesses: () => [],
            listenerPids: () => [],
            restart: (pid) => {
                restarted.push(pid);
                return true;
            },
        },
        openWorkspace: async () => {
            const request = JSON.parse(fs.readFileSync(path.join(home, '.antigravity-ide', 'ide-byebye-bridge', 'requests', 'request-id-1.json'), 'utf8'));
            assert.equal(request.message, 'fill the input');
            fs.mkdirSync(path.join(home, '.antigravity-ide', 'ide-byebye-bridge', 'acks'), { recursive: true });
            fs.writeFileSync(path.join(home, '.antigravity-ide', 'ide-byebye-bridge', 'acks', 'request-id-1.json'), JSON.stringify({ id: 'request-id-1', ok: true }));
        },
    });
    assert.deepEqual(restarted, []);
    fs.rmSync(home, { recursive: true, force: true });
});

test('installAntigravityIdeBridge writes an extension that prefills and does not submit', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ext-'));
    const installed = installAntigravityIdeBridge(home);
    const source = fs.readFileSync(path.join(installed.dir, 'extension.js'), 'utf8');
    assert.equal(source, BRIDGE_EXTENSION_SOURCE);
    assert.match(source, /autoSend:\s*false/);
    assert.match(source, /sendToAgentPanel/);
    assert.equal(installAntigravityIdeBridge(home).updated, false);
    const windows = path.join(home, '.antigravity-ide', 'ide-byebye-bridge', 'windows');
    fs.mkdirSync(windows, { recursive: true });
    fs.writeFileSync(path.join(windows, '7.json'), JSON.stringify({
        pid: 7,
        folders: ['/tmp/demo'],
        at: Date.now(),
    }));
    writeAntigravityIdeBridgeRequest({
        id: 'request-id-2',
        workspacePath: '/tmp/demo',
        message: 'x',
        home,
    });
    assert.equal(antigravityIdeBridgeIsRunning('/tmp/demo', { home, pidAlive: () => true }), true);
    assert.equal(antigravityIdeBridgeIsRunning('/tmp/other', { home, pidAlive: () => true }), false);
    fs.rmSync(home, { recursive: true, force: true });
});
