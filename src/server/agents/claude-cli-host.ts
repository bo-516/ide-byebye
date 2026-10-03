import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CLAUDE_CLI_COMMAND } from './claude-cli-route.js';
import { probeCommandExit, probeCommandVersion, resolveFirstCommand } from './launch-files.js';
import { openTarget } from './opener.js';

/** Timeout for the Windows `reg query` that checks whether `claude-cli://` is registered. */
const REGISTRY_QUERY_TIMEOUT_MS = 3000;

/** Side effects of the Claude Code CLI adapter; tests replace them so nothing is spawned or opened. */
export interface ClaudeCliDeps {
    platform: string;
    homedir: string;
    env: Record<string, string | undefined>;
    /** Existence check that follows symlinks (`fs.existsSync`). */
    exists: (file: string) => boolean;
    /** Symlink target, or null when `file` is not a link. */
    readlink: (file: string) => string | null;
    /** `--version` probe for one CLI candidate. */
    probe: (command: string) => Promise<boolean>;
    /** Windows only: whether `HKCU\Software\Classes\claude-cli` exists. */
    registryHasHandler: () => Promise<boolean>;
    /** Opens a deeplink or launcher; `config` carries `openCommand` / `openArgs`. */
    open: (config: Record<string, unknown>, target: string) => Promise<void>;
}

/**
 * Real side effects, used for every dependency the caller does not override.
 *
 * @returns {ClaudeCliDeps} Production dependencies.
 */
export function defaultClaudeCliDeps(): ClaudeCliDeps {
    return {
        platform: process.platform,
        homedir: os.homedir(),
        env: process.env,
        exists: fs.existsSync,
        readlink: (file) => {
            try {
                return fs.readlinkSync(file);
            }
            catch {
                return null;
            }
        },
        probe: (command) => probeCommandVersion(command),
        registryHasHandler: () => probeCommandExit('reg', ['query', 'HKCU\\Software\\Classes\\claude-cli', '/ve'], REGISTRY_QUERY_TIMEOUT_MS),
        open: (config, target) => openTarget(config, target),
    };
}

/**
 * File whose presence means `claude-cli://` is registered, or null on Windows (the registry is checked instead).
 *
 * Boundary: on macOS this is the handler app's executable, a symlink to the CLI — when the CLI is uninstalled the link
 * dangles and an existence check that follows links reports it unregistered. On Linux it is the `.desktop` entry.
 *
 * @param {{ platform: string, homedir: string, env: Record<string, string | undefined> }} host Platform, home, env.
 * @returns {string | null} Absolute path to check, or null on `win32`.
 */
export function claudeCliHandlerPath(host: { platform: string, homedir: string, env: Record<string, string | undefined> }) {
    if (host.platform === 'win32')
        return null;
    if (host.platform === 'darwin')
        return path.join(host.homedir, 'Applications', 'Claude Code URL Handler.app', 'Contents', 'MacOS', 'claude');
    const dataHome = host.env.XDG_DATA_HOME || path.join(host.homedir, '.local', 'share');
    return path.join(dataHome, 'applications', 'claude-code-url-handler.desktop');
}

/**
 * Whether `claude-cli://` would reach an installed CLI: the handler file resolves (macOS / Linux) or the registry key
 * exists (Windows).
 *
 * @param {ClaudeCliDeps} deps Host and side effects.
 * @returns {Promise<boolean>} True when the deeplink route can be used.
 */
export async function isClaudeCliHandlerRegistered(deps: ClaudeCliDeps) {
    const handlerPath = claudeCliHandlerPath(deps);
    return handlerPath ? deps.exists(handlerPath) : deps.registryHasHandler();
}

/**
 * CLI candidates for the Terminal route, in probe order.
 *
 * Boundary: a non-blank `command` replaces the defaults. Otherwise `claude` on PATH, the native install
 * (`~/.local/bin/claude`), the old local install (`~/.claude/local/claude`), then the CLI the macOS handler links to —
 * which covers a Homebrew or npm install that a GUI-started dev server cannot see on PATH. Duplicates are dropped.
 *
 * @param {{ command?: unknown }} config Claude Code CLI config.
 * @param {{ homedir: string, handlerTarget?: string | null }} host Home directory and the handler link target, if any.
 * @returns {string[]} Ordered candidates (at most four).
 */
export function resolveClaudeCliCommandCandidates(config: { command?: unknown }, host: { homedir: string, handlerTarget?: string | null }) {
    if (typeof config.command === 'string' && config.command.trim())
        return [config.command.trim()];
    const candidates = [
        DEFAULT_CLAUDE_CLI_COMMAND,
        path.join(host.homedir, '.local', 'bin', DEFAULT_CLAUDE_CLI_COMMAND),
        path.join(host.homedir, '.claude', 'local', DEFAULT_CLAUDE_CLI_COMMAND),
    ];
    if (host.handlerTarget && !candidates.includes(host.handlerTarget))
        candidates.push(host.handlerTarget);
    return candidates;
}

/**
 * First working CLI for the Terminal route, probing {@link resolveClaudeCliCommandCandidates}.
 *
 * Boundary: on macOS the handler app's link target joins the candidates (relative targets resolve from the link's
 * folder). Null means unavailable — never launch an unverified name.
 *
 * @param {{ command?: unknown }} config Claude Code CLI config.
 * @param {ClaudeCliDeps} deps Host and side effects.
 * @returns {Promise<string | null>} The command to embed in the launcher, or null.
 */
export function resolveClaudeCliCommand(config: { command?: unknown }, deps: ClaudeCliDeps) {
    const handlerPath = deps.platform === 'darwin' ? claudeCliHandlerPath(deps) : null;
    const link = handlerPath ? deps.readlink(handlerPath) : null;
    const handlerTarget = handlerPath && link ? path.resolve(path.dirname(handlerPath), link) : null;
    return resolveFirstCommand(resolveClaudeCliCommandCandidates(config, { homedir: deps.homedir, handlerTarget }), deps.probe);
}
