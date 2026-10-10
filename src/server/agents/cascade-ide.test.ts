import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    buildCascadeIdeBridgeExtensionPackage,
    buildCascadeIdeBridgeExtensionSource,
} from './cascade-ide-bridge-extension.js';
import {
    cascadeIdeBridgeExtensionDir,
    cascadeIdeBridgePaths,
    installCascadeIdeBridge,
    readCascadeIdeBridgeAck,
    writeCascadeIdeBridgeRequest,
} from './cascade-ide-bridge.js';
import {
    buildCascadeIdeLauncherFile,
    buildCascadeIdeLauncherScript,
    cascadeIdeMissingMessage,
    resolveCascadeIdeCommandCandidates,
} from './cascade-ide-cli.js';
import {
    cascadeIdeHostPredicates,
    chooseCascadeIdeExtensionHost,
} from './cascade-ide-bridge-host.js';
import {
    buildChatActionJson,
    buildInsertMessageArgument,
    buildSubmitMessageArgument,
    encodeCascadeInputRequest,
    encodeCascadeTextItem,
} from './cascade-ide-proto.js';
import { DEVIN_IDE_SPEC, WINDSURF_IDE_SPEC } from './cascade-ide-spec.js';
import { antigravityIdeWorkspaceId } from './antigravity-ide-bridge-host.js';

test('encodeCascadeTextItem emits field-1 length-delimited text', () => {
    // { text: "hi" } => tag 0x0A, len 2, 'h','i'
    assert.deepEqual([...encodeCascadeTextItem('hi')], [0x0a, 0x02, 0x68, 0x69]);
});

test('encodeCascadeInputRequest wraps each text as an items element', () => {
    // items[0] = { text: "ab" } => 0x0A 0x04 (0x0A 0x02 'a' 'b')
    const encoded = encodeCascadeInputRequest(['ab', 'cd']);
    assert.deepEqual([...encoded], [
        0x0a, 0x04, 0x0a, 0x02, 0x61, 0x62,
        0x0a, 0x04, 0x0a, 0x02, 0x63, 0x64,
    ]);
    assert.deepEqual([...encodeCascadeInputRequest([''])], []);
});

test('buildChatActionJson emits SendActionToChatPanelRequest JSON with base64 payload', () => {
    const json = JSON.parse(buildChatActionJson('addCascadeInput', [new Uint8Array([1, 2, 3])]));
    assert.equal(json.actionType, 'addCascadeInput');
    assert.deepEqual(json.payload, [Buffer.from([1, 2, 3]).toString('base64')]);
});

test('buildInsertMessageArgument embeds the prompt as a text item', () => {
    const json = JSON.parse(buildInsertMessageArgument('fix the button'));
    assert.equal(json.actionType, 'addCascadeInput');
    const inner = Buffer.from(json.payload[0], 'base64');
    // AddCascadeInputRequest{ items: [{ text }] } — the message bytes appear verbatim inside the wire body.
    assert.ok(inner.includes(Buffer.from('fix the button')));
    const submit = JSON.parse(buildSubmitMessageArgument('go'));
    assert.equal(submit.actionType, 'sendCascadeInputNewConversation');
});

test('resolveCascadeIdeCommandCandidates prefers config.command then PATH name then app bundle', () => {
    assert.deepEqual(resolveCascadeIdeCommandCandidates(DEVIN_IDE_SPEC, { command: '/opt/devin-desktop' }), ['/opt/devin-desktop']);
    assert.deepEqual(resolveCascadeIdeCommandCandidates(DEVIN_IDE_SPEC, {}, { platform: 'darwin' }), [
        'devin-desktop',
        '/Applications/Devin.app/Contents/Resources/app/bin/devin-desktop',
    ]);
    assert.deepEqual(resolveCascadeIdeCommandCandidates(WINDSURF_IDE_SPEC, {}, { platform: 'darwin' }), [
        'windsurf',
        '/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf',
    ]);
    assert.deepEqual(
        resolveCascadeIdeCommandCandidates(WINDSURF_IDE_SPEC, {}, { platform: 'win32', env: { LOCALAPPDATA: 'C:\\App' } }),
        ['windsurf', path.join('C:\\App', 'Programs\\Windsurf\\bin\\windsurf.cmd')],
    );
});

test('buildCascadeIdeLauncherScript opens the folder without the prompt in argv', () => {
    const script = buildCascadeIdeLauncherScript({ command: 'devin-desktop', cwd: '/tmp/proj' });
    assert.match(script, /^#!\/bin\/bash\n/);
    assert.match(script, /'devin-desktop' '\/tmp\/proj'\n/);
    const flagged = buildCascadeIdeLauncherScript({ command: 'windsurf', cwd: '/tmp/proj', newWindow: true });
    assert.match(flagged, /--new-window/);
    const file = buildCascadeIdeLauncherFile({ command: 'windsurf', cwd: '/tmp/proj', reuseWindow: true }, 'win32');
    assert.match(file, /^@echo off/);
});

test('cascadeIdeMissingMessage names the probed binary and the install hint', () => {
    assert.match(cascadeIdeMissingMessage(DEVIN_IDE_SPEC), /"devin-desktop" not found/);
    assert.match(cascadeIdeMissingMessage(DEVIN_IDE_SPEC), /Devin Desktop/);
    assert.match(cascadeIdeMissingMessage(WINDSURF_IDE_SPEC), /"windsurf" not found/);
});

test('bridge paths stay under the product data dir; extension dir carries the version suffix', () => {
    const paths = cascadeIdeBridgePaths(DEVIN_IDE_SPEC, '/home/u');
    assert.equal(paths.root, path.join('/home/u', '.devin', 'ide-byebye-bridge'));
    assert.equal(paths.requests, path.join(paths.root, 'requests'));
    assert.equal(
        cascadeIdeBridgeExtensionDir(DEVIN_IDE_SPEC, '/home/u'),
        path.join('/home/u', '.devin', 'extensions', 'local.ide-byebye-cascade-bridge-0.1.0'),
    );
    assert.equal(
        cascadeIdeBridgePaths(WINDSURF_IDE_SPEC, '/home/u').root,
        path.join('/home/u', '.windsurf', 'ide-byebye-bridge'),
    );
});

test('installCascadeIdeBridge writes extension files; a rewrite with no changes reports updated=false', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-bridge-'));
    const first = installCascadeIdeBridge(DEVIN_IDE_SPEC, home);
    assert.equal(first.updated, true);
    const source = fs.readFileSync(path.join(first.dir, 'extension.js'), 'utf8');
    assert.match(source, /devin\.sendChatActionMessage/);
    assert.match(source, /\.devin/);
    const second = installCascadeIdeBridge(DEVIN_IDE_SPEC, home);
    assert.equal(second.updated, false);
});

test('writeCascadeIdeBridgeRequest stores the pre-encoded argument and readCascadeIdeBridgeAck reads it back', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cascade-req-'));
    const file = writeCascadeIdeBridgeRequest(DEVIN_IDE_SPEC, {
        id: 'request-1234',
        workspacePath: '/repo',
        argument: buildInsertMessageArgument('hello'),
        home,
    });
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(body.id, 'request-1234');
    assert.equal(body.workspacePath, path.resolve('/repo'));
    assert.equal(JSON.parse(body.argument).actionType, 'addCascadeInput');
    assert.equal(readCascadeIdeBridgeAck(DEVIN_IDE_SPEC, 'request-1234', home), null);
    fs.mkdirSync(cascadeIdeBridgePaths(DEVIN_IDE_SPEC, home).acks, { recursive: true });
    fs.writeFileSync(path.join(cascadeIdeBridgePaths(DEVIN_IDE_SPEC, home).acks, 'request-1234.json'), JSON.stringify({ id: 'request-1234', ok: true }));
    assert.deepEqual(readCascadeIdeBridgeAck(DEVIN_IDE_SPEC, 'request-1234', home), { id: 'request-1234', ok: true });
});

test('bridge extension source embeds the spec bridge root and command probe order', () => {
    const devin = buildCascadeIdeBridgeExtensionSource(DEVIN_IDE_SPEC);
    assert.match(devin, /"\.devin", "ide-byebye-bridge"/);
    assert.match(devin, /\["devin\.sendChatActionMessage","windsurf\.sendChatActionMessage"\]/);
    assert.match(devin, /vscode\.Cascade/);
    const windsurf = buildCascadeIdeBridgeExtensionSource(WINDSURF_IDE_SPEC);
    assert.match(windsurf, /"\.windsurf", "ide-byebye-bridge"/);
    assert.match(windsurf, /\["windsurf\.sendChatActionMessage","devin\.sendChatActionMessage"\]/);
    const pkg = JSON.parse(buildCascadeIdeBridgeExtensionPackage(DEVIN_IDE_SPEC));
    assert.equal(pkg.name, 'ide-byebye-cascade-bridge');
    assert.match(pkg.description, /Devin/);
});

test('cascadeIdeHostPredicates split the products by extensions_dir and helper name', () => {
    const devin = cascadeIdeHostPredicates(DEVIN_IDE_SPEC);
    const windsurf = cascadeIdeHostPredicates(WINDSURF_IDE_SPEC);
    const devinLs = '/Applications/Devin.app/x/bin/language_server_macos_arm --extension_server_port 53417 --workspace_id abc --extensions_dir /u/.devin/extensions';
    const windsurfLs = '/Applications/Windsurf.app/x/bin/language_server_macos_arm --extension_server_port 1 --workspace_id abc --extensions_dir /u/.windsurf/extensions';
    assert.equal(devin.isLanguageServer(devinLs), true);
    assert.equal(devin.isLanguageServer(windsurfLs), false);
    assert.equal(windsurf.isLanguageServer(windsurfLs), true);
    assert.equal(windsurf.isLanguageServer(devinLs), false);
    assert.equal(devin.isExtensionHost('/x/Devin Helper (Plugin) --type=utility --utility-sub-type=node.mojom.NodeService'), true);
    assert.equal(devin.isExtensionHost('/x/Devin Helper --type=renderer'), false);
    assert.equal(devin.isExtensionHost('/x/Windsurf Helper (Plugin) --utility-sub-type=node.mojom.NodeService'), false);
});

test('chooseCascadeIdeExtensionHost matches workspace_id to the listener pid of its extension port', () => {
    const folder = '/repo/app';
    const id = antigravityIdeWorkspaceId(folder);
    const processes = [
        { pid: 10, command: `/x/bin/language_server_arm --workspace_id ${id} --extension_server_port 53417 --extensions_dir /u/.devin/extensions` },
        { pid: 11, command: '/x/Devin Helper (Plugin) --utility-sub-type=node.mojom.NodeService' },
        { pid: 12, command: '/x/other' },
    ];
    const host = chooseCascadeIdeExtensionHost(DEVIN_IDE_SPEC, {
        processes,
        workspacePath: folder,
        listenerPidsByPort: new Map([[53417, [12, 11]]]),
    });
    assert.equal(host, 11);
    const none = chooseCascadeIdeExtensionHost(DEVIN_IDE_SPEC, {
        processes,
        workspacePath: '/other/folder',
        listenerPidsByPort: new Map([[53417, [11]]]),
    });
    assert.equal(none, null);
});
