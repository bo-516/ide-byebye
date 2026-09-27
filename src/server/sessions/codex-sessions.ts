import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readHead, readTail } from './file-window.js';
import { readSessionPicker } from './options.js';
import { buildProjectScope, matchSessionCwd, normalizeScopePath, sessionLocation, sessionProjectName } from './project-scope.js';
import { SESSION_ID_PATTERN, sessionTitle } from './types.js';

/** Bytes read from the start of a rollout. `cwd` on this machine sits inside the first 4 KB. */
const HEAD_BYTES = 4096;
/** First tail window for lifecycle events. */
const TAIL_BYTES = 65536;
/** One extra tail read when the first window has no lifecycle event. Never the whole file. */
const TAIL_RETRY_BYTES = 524288;
/** Cap on rollout files inspected per list, newest mtime first. */
const MAX_ROLLOUTS = 2000;
const ROLLOUT_NAME = /rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const LIFECYCLE = /"payload"\s*:\s*\{\s*"type"\s*:\s*"(task_started|task_complete|turn_aborted)"/g;

/**
 * Resolve the Codex data directory.
 *
 * Boundary: `sessions.home` wins, then `CODEX_HOME`, then `~/.codex`. A relative home is resolved from the process
 * cwd. This never reads a path supplied by the page.
 *
 * @param {Record<string, unknown>} [config] Codex adapter config.
 * @param {NodeJS.ProcessEnv} [env] Environment used for `CODEX_HOME`.
 * @param {string} [homeDir] User home. Tests pass a temp dir.
 * @returns {string} Absolute Codex home.
 */
export function resolveCodexHome(config: any = {}, env = process.env, homeDir = os.homedir()) {
    const picker = readSessionPicker(config);
    if (picker.home)
        return path.resolve(picker.home);
    if (typeof env.CODEX_HOME === 'string' && env.CODEX_HOME.trim())
        return path.resolve(env.CODEX_HOME.trim());
    return path.join(homeDir, '.codex');
}

/**
 * Unescape a JSON string capture without parsing the surrounding object.
 *
 * Boundary: invalid escapes return the raw capture. Callers still require `thread_source === "user"`.
 *
 * @param {string} raw Characters between the JSON quotes.
 * @returns {string} Decoded text.
 */
function unescapeJson(raw) {
    try {
        return JSON.parse(`"${raw}"`);
    }
    catch {
        return raw;
    }
}

/**
 * Pull one string field out of a rollout head.
 *
 * @param {string} text Head bytes decoded as UTF-8.
 * @param {string} key JSON key (`id`, `cwd`, or `thread_source`).
 * @returns {string | null} Decoded value, or null when the key is absent.
 */
function captureField(text, key) {
    const match = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    return match ? unescapeJson(match[1]) : null;
}

/**
 * Last lifecycle event in a tail window.
 *
 * @param {string} text Tail text. A window that starts mid-line is fine: the regex does not need a full record.
 * @returns {'task_started' | 'task_complete' | 'turn_aborted' | null} Last match, or null.
 */
function lastLifecycle(text) {
    let last = null;
    for (const match of text.matchAll(LIFECYCLE))
        last = match[1];
    return last;
}

/**
 * Later of two timestamps, as an ISO string.
 *
 * @param {string | undefined} indexed `updated_at` from `session_index.jsonl`.
 * @param {number} mtimeMs Rollout mtime.
 * @returns {string} ISO timestamp.
 */
function laterIso(indexed, mtimeMs) {
    const fromIndex = Date.parse(indexed ?? '');
    const fromFile = Number.isFinite(mtimeMs) ? mtimeMs : 0;
    const best = Math.max(Number.isFinite(fromIndex) ? fromIndex : 0, fromFile);
    return new Date(best || Date.now()).toISOString();
}

/**
 * Last `thread_name` / `updated_at` per id in `session_index.jsonl`.
 *
 * Boundary: the whole index is read (titles live on the last row, so a tail cap would drop them). Bad lines are
 * skipped. A missing file yields an empty map, which lists sessions with a blank title rather than failing the menu.
 *
 * @param {string} file Index path.
 * @param {typeof fs} io Filesystem.
 * @returns {Map<string, { title: string, updatedAt: string }>} Last row for each id.
 */
function readSessionIndex(file, io) {
    const titles = new Map();
    if (!io.existsSync(file))
        return titles;
    let text = '';
    try {
        text = io.readFileSync(file, 'utf8');
    }
    catch {
        return titles;
    }
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim())
            continue;
        let row;
        try {
            row = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (!row || typeof row.id !== 'string' || !SESSION_ID_PATTERN.test(row.id))
            continue;
        titles.set(row.id.toLowerCase(), {
            title: sessionTitle(row.thread_name ?? row.title ?? ''),
            updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
        });
    }
    return titles;
}

/**
 * Rollout files under `sessions/YYYY/MM/DD/`, newest mtime first, inside the lookback window.
 *
 * Boundary: `archived_sessions/` is never walked. The directory date is ignored — only mtime counts, because the
 * folder name is a local date and lies across time zones. At most {@link MAX_ROLLOUTS} files are returned.
 *
 * @param {string} sessionsDir `sessions/` directory.
 * @param {number} lookbackMs Files older than this age are dropped.
 * @param {number} now Epoch ms.
 * @param {typeof fs} io Filesystem.
 * @returns {Array<{ file: string, mtimeMs: number, id: string }>} Candidates.
 */
function listRolloutFiles(sessionsDir, lookbackMs, now, io) {
    if (!io.existsSync(sessionsDir))
        return [];
    const found = [];
    const years = io.readdirSync(sessionsDir);
    for (const year of years) {
        const yearDir = path.join(sessionsDir, year);
        let months = [];
        try {
            if (!io.statSync(yearDir).isDirectory())
                continue;
            months = io.readdirSync(yearDir);
        }
        catch {
            continue;
        }
        for (const month of months) {
            const monthDir = path.join(yearDir, month);
            let days = [];
            try {
                if (!io.statSync(monthDir).isDirectory())
                    continue;
                days = io.readdirSync(monthDir);
            }
            catch {
                continue;
            }
            for (const day of days) {
                const dayDir = path.join(monthDir, day);
                let names = [];
                try {
                    if (!io.statSync(dayDir).isDirectory())
                        continue;
                    names = io.readdirSync(dayDir);
                }
                catch {
                    continue;
                }
                for (const name of names) {
                    const idMatch = name.match(ROLLOUT_NAME);
                    if (!idMatch)
                        continue;
                    const file = path.join(dayDir, name);
                    let stat;
                    try {
                        stat = io.statSync(file);
                    }
                    catch {
                        continue;
                    }
                    if (!stat.isFile() || now - stat.mtimeMs > lookbackMs)
                        continue;
                    found.push({ file, mtimeMs: stat.mtimeMs, id: idMatch[1].toLowerCase() });
                }
            }
        }
    }
    found.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return found.slice(0, MAX_ROLLOUTS);
}

/**
 * List Codex threads that belong to the current project.
 *
 * Boundary: page input is not accepted. Only `thread_source === "user"` rollouts under `sessions/` are eligible.
 * `working` requires the last lifecycle event to be `task_started` AND a writer lock; a leftover `task_started`
 * without the lock is `idle`. A missing home returns an empty list and no notice. When rollout files exist but none
 * of their heads match the meta shape, the result is `{ notice: "unsupported-format" }` so the new-session path is
 * unchanged. Reads stay bounded: 4 KB head, 64 KB tail, and one 512 KB tail retry.
 *
 * @param {{ projectRoot: string, config?: Record<string, unknown>, now?: number, io?: typeof fs, env?: NodeJS.ProcessEnv, homeDir?: string }} input
 *        Inspector project root plus the Codex adapter config. `io` is the filesystem (tests wrap it).
 * @returns {{ sessions: Array<Record<string, unknown>>, delivery: 'prefill', notice?: string }} Catalog rows with server-only `cwd`.
 */
export function listCodexSessions(input) {
    const io = input.io ?? fs;
    const config = input.config ?? {};
    const picker = readSessionPicker(config);
    const home = resolveCodexHome(config, input.env, input.homeDir);
    const delivery = 'prefill';
    if (!io.existsSync(home))
        return { sessions: [], delivery };
    const extraRoot = typeof config.projectRoot === 'string' && config.projectRoot.trim()
        ? path.resolve(config.projectRoot.trim())
        : '';
    const scope = buildProjectScope(input.projectRoot, extraRoot ? [extraRoot] : [], { io });
    const now = input.now ?? Date.now();
    const files = listRolloutFiles(path.join(home, 'sessions'), picker.lookbackDays * 86400000, now, io);
    const titles = readSessionIndex(path.join(home, 'session_index.jsonl'), io);
    const locksDir = path.join(home, 'thread-writer-locks');
    const sessions = [];
    let parsed = 0;
    for (const candidate of files) {
        if (sessions.length >= picker.limit)
            break;
        let head = '';
        try {
            head = readHead(candidate.file, HEAD_BYTES, io);
        }
        catch {
            continue;
        }
        const cwd = captureField(head, 'cwd');
        const threadSource = captureField(head, 'thread_source');
        const headId = captureField(head, 'id');
        if (!cwd || !threadSource)
            continue;
        parsed += 1;
        if (threadSource !== 'user')
            continue;
        if (!matchSessionCwd(cwd, scope))
            continue;
        const id = (headId && SESSION_ID_PATTERN.test(headId) ? headId : candidate.id).toLowerCase();
        const normalizedCwd = normalizeScopePath(cwd, io);
        let tail = '';
        let event = null;
        try {
            tail = readTail(candidate.file, TAIL_BYTES, io);
            event = lastLifecycle(tail);
            if (!event) {
                const size = io.statSync(candidate.file).size;
                if (size > TAIL_BYTES) {
                    tail = readTail(candidate.file, TAIL_RETRY_BYTES, io);
                    event = lastLifecycle(tail);
                }
            }
        }
        catch {
            event = null;
        }
        const live = io.existsSync(path.join(locksDir, `${id}.lock`));
        const indexed = titles.get(id);
        sessions.push({
            id,
            title: indexed?.title ?? '',
            cwd: normalizedCwd,
            projectName: sessionProjectName(normalizedCwd, scope.platform),
            location: sessionLocation(normalizedCwd, scope.projectRoot, scope.platform),
            status: event === 'task_started' && live ? 'working' : 'idle',
            live,
            targetable: true,
            updatedAt: laterIso(indexed?.updatedAt, candidate.mtimeMs),
        });
    }
    if (files.length > 0 && parsed === 0)
        return { sessions: [], delivery, notice: 'unsupported-format' };
    sessions.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return { sessions, delivery };
}
