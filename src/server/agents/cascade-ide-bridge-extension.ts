import type { CascadeIdeSpec } from './cascade-ide-spec.js';

/**
 * Source of the local VS Code extension that hands a prompt to the Cascade chat panel in
 * Devin Desktop / Windsurf.
 *
 * Boundary: this file emits plain JavaScript the IDE extension host loads (CommonJS — the host does not
 * run ESM). It is not imported by the inspector server. The extension only reads request files under the
 * bridge directory; the prompt arrives as a pre-encoded `SendActionToChatPanelRequest` JSON `argument`,
 * which is executed — never `eval`ed — via `vscode.commands.executeCommand`.
 */

/**
 * package.json written next to the emitted extension source.
 *
 * @param {CascadeIdeSpec} spec Product spec (display name only affects description text).
 * @returns {string} package.json contents.
 */
export function buildCascadeIdeBridgeExtensionPackage(spec: CascadeIdeSpec) {
    return `{
  "name": "${spec.extensionName}",
  "displayName": "ide-byebye ${spec.displayName} bridge",
  "publisher": "local",
  "version": "0.1.0",
  "description": "Places an ide-byebye prompt into the ${spec.displayName} Cascade input.",
  "engines": { "vscode": "^1.80.0" },
  "activationEvents": ["onStartupFinished"],
  "main": "./extension.js",
  "contributes": {}
}
`;
}

/**
 * Extension entry: watches the bridge request directory and executes `<prefix>.sendChatActionMessage`
 * with the request's `argument`.
 *
 * Boundary: `vscode.Cascade.openPanel()` is used when present so the main chat client exists before the
 * action is routed; the toggle-style `openCascade` command is never called (it can close an open panel).
 *
 * @param {CascadeIdeSpec} spec Product spec (bridge directory + command ids).
 * @returns {string} extension.js source.
 */
export function buildCascadeIdeBridgeExtensionSource(spec: CascadeIdeSpec) {
    const commands = JSON.stringify(spec.commandIds);
    return `"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");

const ROOT = path.join(os.homedir(), "${spec.dataDirName}", "${spec.bridgeDirName}");
const REQUESTS = path.join(ROOT, "requests");
const ACKS = path.join(ROOT, "acks");
const WINDOWS = path.join(ROOT, "windows");
const COMMANDS = ${commands};
const MAX_AGE_MS = 120000;

function samePath(left, right) {
  const a = path.resolve(String(left || ""));
  const b = path.resolve(String(right || ""));
  if (process.platform === "darwin" || process.platform === "win32")
    return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

function workspaceMatches(target) {
  const folders = vscode.workspace.workspaceFolders || [];
  return folders.some((folder) => samePath(folder.uri.fsPath, target));
}

function writeHeartbeat() {
  fs.mkdirSync(WINDOWS, { recursive: true });
  const folders = (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath);
  fs.writeFileSync(path.join(WINDOWS, process.pid + ".json"), JSON.stringify({
    pid: process.pid,
    folders,
    at: Date.now(),
  }));
}

function ack(id, ok, error) {
  fs.mkdirSync(ACKS, { recursive: true });
  const body = { id, ok: ok === true };
  if (error)
    body.error = String(error).slice(0, 500);
  fs.writeFileSync(path.join(ACKS, id + ".json"), JSON.stringify(body));
}

async function ensureChatPanel() {
  try {
    const cascade = vscode.Cascade;
    if (!cascade || typeof cascade.openPanel !== "function")
      return;
    if (typeof cascade.getFocusState === "function") {
      const state = await cascade.getFocusState();
      if (state && state.isVisible === true)
        return;
    }
    await cascade.openPanel();
  }
  catch {
  }
}

async function place(request) {
  await ensureChatPanel();
  let lastErr;
  for (const command of COMMANDS) {
    try {
      await vscode.commands.executeCommand(command, request.argument);
      return;
    }
    catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("chat action command is not available");
}

function scan() {
  writeHeartbeat();
  let names = [];
  try {
    names = fs.readdirSync(REQUESTS);
  }
  catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith(".json"))
      continue;
    const file = path.join(REQUESTS, name);
    let request;
    try {
      request = JSON.parse(fs.readFileSync(file, "utf8"));
    }
    catch {
      continue;
    }
    if (!request || typeof request.id !== "string" || typeof request.argument !== "string")
      continue;
    if (!/^[A-Za-z0-9-]{8,80}$/.test(request.id))
      continue;
    if (!workspaceMatches(request.workspacePath))
      continue;
    if (Date.now() - Number(request.createdAt) > MAX_AGE_MS) {
      ack(request.id, false, "prompt request expired");
      fs.rmSync(file, { force: true });
      continue;
    }
    const processing = file + ".processing";
    try {
      fs.renameSync(file, processing);
    }
    catch {
      continue;
    }
    place(request).then(() => {
      ack(request.id, true);
      fs.rmSync(processing, { force: true });
    }, (err) => {
      ack(request.id, false, err instanceof Error ? err.message : String(err));
      fs.rmSync(processing, { force: true });
    });
  }
}

function activate(context) {
  fs.mkdirSync(REQUESTS, { recursive: true });
  const timer = setInterval(scan, 400);
  const watcher = fs.watch(REQUESTS, () => scan());
  context.subscriptions.push(
    { dispose: () => clearInterval(timer) },
    { dispose: () => watcher.close() },
    vscode.workspace.onDidChangeWorkspaceFolders(() => scan()),
  );
  scan();
}

function deactivate() {
  fs.rmSync(path.join(WINDOWS, process.pid + ".json"), { force: true });
}

module.exports = { activate, deactivate };
`;
}
