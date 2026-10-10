import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { resolveDevinCliCommandCandidates } from '../agents/devin-cli-launcher.js';
import { resolveFirstCommand } from '../agents/launch-files.js';
import {
    buildProjectScope,
    matchSessionCwd,
    normalizeScopePath,
    sessionLocation,
    sessionProjectName,
} from './project-scope.js';
import fs from 'node:fs';
import { readSessionPicker } from './options.js';
import { DEVIN_SESSION_ID_PATTERN, sessionTitle } from './types.js';
import type { SessionFs } from './file-window.js';

/** `devin list --format json` subprocess budget. Listing should be sub-second; a hung CLI is reported as unreachable. */
export const DEVIN_LIST_TIMEOUT_MS = 5000;
/** Cap on `devin list` stdout so a pathological JSON dump cannot exhaust memory. */
export const DEVIN_LIST_MAX_BUFFER = 4 * 1024 * 1024;

/** One row of `devin list --format json` after narrowing. */
interface DevinListRow {
    id?: unknown;
    short_id?: unknown;
    working_directory?: unknown;
    title?: unknown;
    last_activity_at?: unknown;
}

/**
 * Injectable seams for {@link listDevinSessions}.
 *
 * Boundary: `runList` replaces the `devin list` subprocess (tests never spawn). `resolveCommand` replaces binary
 * resolution so a test does not need the CLI installed. `fs` narrows to the read-only surface project-scope needs.
 */
export interface DevinSessionsIo {
    runList?: (command: string, cwd: string) => string;
    resolveCommand?: () => Promise<string | null> | string | null;
    fs?: SessionFs;
}

/**
 * Spawn `devin list --format json` and return stdout.
 *
 * Boundary: argv is fixed — nothing from the page reaches the command. `cwd` is the server-resolved project root,
 * not a page field. A non-zero exit, timeout, or missing binary throws; callers map that to `cli-unreachable`.
 *
 * @param {string} command Resolved devin binary.
 * @param {string} cwd Directory to list sessions for.
 * @returns {string} Raw stdout JSON.
 */
function runDevinList(command: string, cwd: string) {
    return execFileSync(command, ['list', '--format', 'json'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: DEVIN_LIST_TIMEOUT_MS,
        maxBuffer: DEVIN_LIST_MAX_BUFFER,
    });
}

/**
 * Parse `devin list --format json` stdout into normalized rows.
 *
 * Boundary: invalid JSON or a non-array root yields `[]` — the caller then reports `unsupported-format`. Rows whose
 * `id` fails {@link DEVIN_SESSION_ID_PATTERN} or whose `working_directory` is not a non-empty string are dropped so
 * nothing hostile reaches the launcher or the catalog.
 *
 * @param {string} text Raw stdout.
 * @returns {Array<{ id: string, title: string, workingDirectory: string, updatedAt: string }>} Parsed sessions.
 */
export function parseDevinSessionList(text: string) {
    let value: unknown;
    try {
        value = JSON.parse(text);
    }
    catch {
        return [];
    }
    if (!Array.isArray(value))
        return [];
    const rows: Array<{ id: string, title: string, workingDirectory: string, updatedAt: string }> = [];
    for (const raw of value as DevinListRow[]) {
        if (!raw || typeof raw !== 'object')
            continue;
        const id = typeof raw.id === 'string' && raw.id ? raw.id
            : typeof raw.short_id === 'string' ? raw.short_id : '';
        const workingDirectory = typeof raw.working_directory === 'string' ? raw.working_directory.trim() : '';
        if (!DEVIN_SESSION_ID_PATTERN.test(id) || !workingDirectory)
            continue;
        const epoch = Number(raw.last_activity_at);
        const updatedAt = Number.isFinite(epoch) && epoch > 0
            ? new Date(epoch * 1000).toISOString()
            : '';
        rows.push({
            id,
            title: sessionTitle(raw.title),
            workingDirectory,
            updatedAt,
        });
    }
    return rows;
}

/**
 * List Devin CLI sessions scoped to the inspector project.
 *
 * Boundary: sessions come from `devin list --format json` run in the project root — no file formats are assumed.
 * A session whose `working_directory` is outside the project scope is filtered out via {@link matchSessionCwd}; one
 * whose directory no longer exists is listed but `targetable: false`. Devin has no live/busy signal, so rows are
 * always `live: false`; the recheck-before-launch guarantee degrades to re-running this list.
 *
 * @param {{ projectRoot: string, config?: { projectRoot?: unknown, sessions?: unknown, command?: unknown }, io?: DevinSessionsIo }} input
 *        Inspector root, `devin-cli` adapter config, and test seams. `config.projectRoot` is an extra scope root
 *        (same semantics as the launcher cwd override).
 * @returns {Promise<{ sessions: Array<Record<string, unknown>>, delivery: 'resume-submit', notice?: string }>} Catalog payload.
 */
export async function listDevinSessions(input: {
    projectRoot: string;
    config?: { projectRoot?: unknown; sessions?: unknown; command?: unknown };
    io?: DevinSessionsIo;
}) {
    const io = input.io ?? {};
    const ioFs = io.fs ?? fs;
    const config = input.config ?? {};
    const picker = readSessionPicker(config);
    const delivery = 'resume-submit';
    const resolve = io.resolveCommand
        ?? (() => resolveFirstCommand(resolveDevinCliCommandCandidates(config)));
    const command = await resolve();
    if (!command)
        return { sessions: [], delivery, notice: 'cli-unreachable' };
    const extraRoot = typeof config.projectRoot === 'string' && config.projectRoot.trim()
        ? path.resolve(config.projectRoot.trim())
        : '';
    const scope = buildProjectScope(input.projectRoot, extraRoot ? [extraRoot] : [], { io: ioFs });
    let text: string;
    try {
        text = (io.runList ?? runDevinList)(command, scope.projectRoot);
    }
    catch {
        return { sessions: [], delivery, notice: 'cli-unreachable' };
    }
    const rows = parseDevinSessionList(text);
    const sessions = [];
    for (const row of rows) {
        if (!matchSessionCwd(row.workingDirectory, scope))
            continue;
        const cwd = normalizeScopePath(row.workingDirectory, ioFs);
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
    sessions.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return { sessions: sessions.slice(0, picker.limit), delivery };
}
