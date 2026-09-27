/**
 * Source of the local VS Code extension that places a prompt in the Antigravity IDE agent input.
 *
 * Boundary: this file is plain JavaScript the IDE extension host loads. It is not imported by the
 * inspector server. `autoSend` must stay false — the default of `sendToAgentPanel` submits the message.
 * The extension only reads request files under the bridge directory and never evaluates the prompt.
 */

/** package.json written next to {@link BRIDGE_EXTENSION_SOURCE}. */
export const BRIDGE_EXTENSION_PACKAGE = `{
  "name": "ide-byebye-bridge",
  "displayName": "ide-byebye Antigravity bridge",
  "publisher": "local",
  "version": "0.1.0",
  "description": "Places an ide-byebye prompt into the Antigravity IDE agent input.",
  "engines": { "vscode": "^1.80.0" },
  "activationEvents": ["onStartupFinished"],
  "main": "./extension.js",
  "contributes": {}
}
`;

/**
 * Extension entry. Watches the bridge request directory and calls
 * `vscode.antigravityExtensibility.sendToAgentPanel` with `autoSend: false`.
 */
export const BRIDGE_EXTENSION_SOURCE = `"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");

const ROOT = path.join(os.homedir(), ".antigravity-ide", "ide-byebye-bridge");
const REQUESTS = path.join(ROOT, "requests");
const ACKS = path.join(ROOT, "acks");
const WINDOWS = path.join(ROOT, "windows");
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

function fileUris(files) {
  const folders = (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath);
  const uris = [];
  for (const file of files || []) {
    if (typeof file !== "string" || !file)
      continue;
    const resolved = path.resolve(file);
    const inside = folders.some((folder) => {
      const root = path.resolve(folder);
      const prefix = root.endsWith(path.sep) ? root : root + path.sep;
      if (process.platform === "darwin" || process.platform === "win32")
        return resolved.toLowerCase().startsWith(prefix.toLowerCase());
      return resolved.startsWith(prefix);
    });
    if (inside)
      uris.push({ uri: vscode.Uri.file(resolved) });
  }
  return uris;
}

async function place(request) {
  const api = vscode.antigravityExtensibility;
  if (!api || typeof api.sendToAgentPanel !== "function")
    throw new Error("vscode.antigravityExtensibility.sendToAgentPanel is not available");
  const options = { message: request.message, autoSend: false };
  const files = fileUris(request.files);
  if (files.length)
    options.files = files;
  await api.sendToAgentPanel(options);
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
    if (!request || typeof request.id !== "string" || typeof request.message !== "string")
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
