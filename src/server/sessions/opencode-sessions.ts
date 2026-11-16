import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveFirstCommand } from '../agents/launch-files.js';
import { openCodeAppCandidates, resolveOpenCodeCommandCandidates } from '../agents/opencode-route.js';
import type { SessionFs } from './file-window.js';
import { readSessionPicker } from './options.js';
import {
    buildProjectScope,
    matchSessionCwd,
    normalizeScopePath,
    sessionLocation,
    sessionProjectName,
} from './project-scope.js';
import { OPENCODE_SESSION_ID_PATTERN, sessionTitle } from './types.js';

/** `opencode session list` subprocess budget. A hung CLI is reported as `cli-unreachable`. */
export const OPENCODE_LIST_TIMEOUT_MS = 5000;
/** Cap on `opencode session list` stdout so a pathological JSON dump cannot exhaust memory. */
export const OPENCODE_LIST_MAX_BUFFER = 4 * 1024 * 1024;
/** Epoch values above 10^11 (~1973 in ms, ~5138 in s) are millisecond timestamps; smaller positive numbers are seconds. */
const EPOCH_MS_THRESHOLD = 1e11;

/** One row of `opencode session list --format json` after narrowing. */
interface OpenCodeListRow {
    id?: unknown;
    title?: unknown;
    directory?: unknown;
    updated?: unknown;
    created?: unknown;
}

/** Normalized row produced by {@link parseOpenCodeSessionList}. */
export interface ParsedOpenCodeSession {
    id: string;
    title: string;
    directory: string;
    updatedAt: string;
}

/**
 * Injectable seams for {@link listOpenCodeSessions}.
 *
 * Boundary: `runList` replaces the CLI subprocess (tests never spawn). `resolveCommand` replaces binary discovery so
 * tests do not touch the host filesystem or PATH. `fs` narrows to the read-only surface project-scope needs.
 */
export interface OpenCodeSessionsIo {
    runList?: (command: string, cwd: string) => string;
    resolveCommand?: () => Promise<string | null> | string | null;
    fs?: SessionFs;
}

/**
 * Extract stderr/message text from a failed `execFileSync` error so 1.x unknown-flag errors can be distinguished.
 *
 * @param {unknown} err Thrown value from `execFileSync`.
 * @returns {string} Combined stderr and error message text.
 */
function execErrorText(err: unknown) {
    if (!err || typeof err !== 'object')
        return String(err ?? '');
    const record = err as { stderr?: unknown; message?: unknown };
    const message = typeof record.message === 'string' ? record.message : '';
    if (Buffer.isBuffer(record.stderr))
        return `${record.stderr.toString('utf8')}\n${message}`;
    const stderr = typeof record.stderr === 'string' ? record.stderr : '';
    return `${stderr}\n${message}`;
}

/** Narrow `execFileSync` signature {@link runOpenCodeList} calls, so tests pass plain functions without casts. */
export type OpenCodeExec = (
    command: string,
    args: readonly string[],
    options: { cwd: string; encoding: 'utf8'; stdio: ['ignore', 'pipe', 'pipe']; timeout: number; maxBuffer: number },
) => string;

/**
 * Spawn `opencode session list` in JSON mode without touching the 2.x background service.
 *
 * Boundary: 2.x CLIs get `--standalone` so they read the local SQLite database directly instead of starting or
 * authenticating against the background daemon. OpenCode 1.x CLIs have no background daemon and reject `--standalone`;
 * when stderr/message names `standalone`, this retries once without that flag. `cwd` is the server-resolved project
 * root, never a page field.
 *
 * @param {string} command Resolved OpenCode CLI binary.
 * @param {string} cwd Directory to list sessions for.
 * @param {OpenCodeExec} [execImpl] Subprocess runner, overridden in unit tests.
 * @returns {string} Raw stdout JSON.
 */
export function runOpenCodeList(command: string, cwd: string, execImpl: OpenCodeExec = execFileSync) {
    const execOpts = {
        cwd,
        encoding: 'utf8' as const,
        stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
        timeout: OPENCODE_LIST_TIMEOUT_MS,
        maxBuffer: OPENCODE_LIST_MAX_BUFFER,
    };
    try {
        return execImpl(command, ['session', 'list', '--standalone', '--format', 'json'], execOpts);
    }
    catch (err) {
        if (!/standalone/i.test(execErrorText(err)))
            throw err;
        return execImpl(command, ['session', 'list', '--format', 'json'], execOpts);
    }
}

/**
 * Convert an OpenCode `updated` / `created` field (ms epoch, s epoch, or ISO string) into an ISO timestamp.
 *
 * @param {unknown} value Raw timestamp from a session row.
 * @returns {string} ISO string, or `''` when absent or unparseable.
 */
function formatOpenCodeTimestamp(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        const ms = value > EPOCH_MS_THRESHOLD ? value : value * 1000;
        return new Date(ms).toISOString();
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed))
            return new Date(parsed).toISOString();
    }
    return '';
}

/**
 * Parse JSON without throwing.
 *
 * @param {string} text Raw text.
 * @returns {{ ok: true, value: unknown } | { ok: false }} Parse result.
 */
function safeParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
    try {
        return { ok: true, value: JSON.parse(text) };
    }
    catch {
        return { ok: false };
    }
}

/**
 * Parse `opencode session list --format json` stdout into normalized rows.
 *
 * Boundary: invalid JSON or a non-array root sets `valid: false` so the caller reports `unsupported-format`. Rows
 * whose `id` fails {@link OPENCODE_SESSION_ID_PATTERN} or whose `directory` is blank are dropped before reaching the
 * catalog or launcher.
 *
 * @param {string} text Raw stdout from `opencode session list --format json`.
 * @returns {{ rows: ParsedOpenCodeSession[], valid: boolean }} Parsed sessions and whether stdout was a JSON array.
 */
export function parseOpenCodeSessionList(text: string): { rows: ParsedOpenCodeSession[]; valid: boolean } {
    const rows: ParsedOpenCodeSession[] = [];
    const parsed = safeParseJson(text);
    if (!parsed.ok || !Array.isArray(parsed.value))
        return { rows, valid: false };
    for (const entry of parsed.value) {
        if (!entry || typeof entry !== 'object')
            continue;
        const raw = entry as OpenCodeListRow;
        const id = typeof raw.id === 'string' ? raw.id : '';
        const directory = typeof raw.directory === 'string' ? raw.directory.trim() : '';
        if (!OPENCODE_SESSION_ID_PATTERN.test(id) || !directory)
            continue;
        const updatedAt = formatOpenCodeTimestamp(raw.updated) || formatOpenCodeTimestamp(raw.created);
        rows.push({ id, title: sessionTitle(raw.title), directory, updatedAt });
    }
    return { rows, valid: true };
}

/**
 * Default CLI discovery matching the OpenCode adapter's probe order (`opencode`, `~/.opencode/bin/opencode`, app CLI).
 *
 * @param {{ command?: unknown, appPath?: unknown }} config OpenCode adapter config.
 * @returns {Promise<string | null>} Working CLI binary, or null.
 */
function defaultResolveCommand(config: { command?: unknown; appPath?: unknown }) {
    const host = { platform: process.platform, homedir: os.homedir() };
    const appPath = openCodeAppCandidates(config, host).find((candidate) => fs.existsSync(candidate)) ?? null;
    return resolveFirstCommand(resolveOpenCodeCommandCandidates(config, { homedir: host.homedir, appPath }));
}

/**
 * Run the list callback and convert any throw to null (`cli-unreachable`).
 *
 * @param {(command: string, cwd: string) => string} run List callback.
 * @param {string} command CLI binary.
 * @param {string} cwd Project directory.
 * @returns {string | null} Raw stdout, or null when the subprocess failed.
 */
function tryRunList(run: (command: string, cwd: string) => string, command: string, cwd: string) {
    try {
        return run(command, cwd);
    }
    catch {
        return null;
    }
}

/**
 * List OpenCode sessions scoped to the inspector project.
 *
 * Boundary: sessions come from `opencode session list --format json` run in the project root. Entries outside the
 * project scope are dropped via {@link matchSessionCwd}; entries whose directory no longer exists stay visible with
 * `targetable: false` (`cwd-missing`).
 *
 * @param {{ projectRoot: string, config?: { projectRoot?: unknown, sessions?: unknown, command?: unknown, appPath?: unknown }, io?: OpenCodeSessionsIo }} input
 *        Inspector root, `opencode` adapter config, and test seams.
 * @returns {Promise<{ sessions: Array<Record<string, unknown>>, delivery: 'resume-submit', notice?: string }>} Catalog payload.
 */
export async function listOpenCodeSessions(input: {
    projectRoot: string;
    config?: { projectRoot?: unknown; sessions?: unknown; command?: unknown; appPath?: unknown };
    io?: OpenCodeSessionsIo;
}) {
    const io = input.io ?? {};
    const ioFs = io.fs ?? fs;
    const config = input.config ?? {};
    const picker = readSessionPicker(config);
    const delivery = 'resume-submit' as const;
    const resolve = io.resolveCommand ?? (() => defaultResolveCommand(config));
    const command = await resolve();
    if (!command)
        return { sessions: [], delivery, notice: 'cli-unreachable' };
    const extraRoot = typeof config.projectRoot === 'string' && config.projectRoot.trim()
        ? path.resolve(config.projectRoot.trim())
        : '';
    const scope = buildProjectScope(input.projectRoot, extraRoot ? [extraRoot] : [], { io: ioFs });
    const run = io.runList ?? ((cmd: string, cwd: string) => runOpenCodeList(cmd, cwd));
    const text = tryRunList(run, command, scope.projectRoot);
    if (text === null)
        return { sessions: [], delivery, notice: 'cli-unreachable' };
    const parsed = parseOpenCodeSessionList(text);
    if (!parsed.valid)
        return { sessions: [], delivery, notice: 'unsupported-format' };
    const sessions: Array<Record<string, unknown>> = [];
    for (const row of parsed.rows) {
        if (!matchSessionCwd(row.directory, scope))
            continue;
        const cwd = normalizeScopePath(row.directory, ioFs);
        const cwdExists = ioFs.existsSync(cwd);
        sessions.push({
            id: row.id,
            title: row.title,
            cwd,
            projectName: sessionProjectName(cwd, scope.platform),
            location: sessionLocation(cwd, scope.projectRoot, scope.platform),
            status: 'idle',
            live: false,
            targetable: cwdExists,
            reason: cwdExists ? undefined : 'cwd-missing',
            updatedAt: row.updatedAt,
        });
    }
    sessions.sort((a, b) => (Date.parse(b.updatedAt as string) || 0) - (Date.parse(a.updatedAt as string) || 0));
    return { sessions: sessions.slice(0, picker.limit), delivery };
}
