import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pidAlive, readTail } from './file-window.js';
import { readSessionPicker } from './options.js';
import { buildProjectScope, matchSessionCwd, normalizeScopePath, sessionLocation, sessionProjectName } from './project-scope.js';
import { SESSION_ID_PATTERN, sessionTitle } from './types.js';

/** Tail window for `events.jsonl`. Smaller than Codex: Grok sessions are one directory per conversation. */
const EVENT_TAIL_BYTES = 32768;
const EXCLUDED_KINDS = new Set(['subagent', 'subagent_resume', 'headless']);

/**
 * Resolve the Grok data directory.
 *
 * Boundary: `sessions.home` wins, otherwise `~/.grok`. `GROK_HOME` is not consulted — it is not a documented
 * contract for this build. A relative home resolves from the process cwd. The page cannot choose this path.
 *
 * @param {Record<string, unknown>} [config] Grok adapter config.
 * @param {string} [homeDir] User home. Tests pass a temp directory's parent only via `sessions.home`.
 * @returns {string} Absolute Grok home.
 */
export function resolveGrokHome(config: any = {}, homeDir = os.homedir()) {
    const picker = readSessionPicker(config);
    if (picker.home)
        return path.resolve(picker.home);
    return path.join(homeDir, '.grok');
}

/**
 * Wait before the single `active_sessions.json` retry.
 *
 * @param {number} ms Delay. Production uses 50.
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/**
 * Parse `active_sessions.json`, retrying once when the file is unreadable.
 *
 * Boundary: a missing file means nothing is live (not an error). Invalid JSON waits `sleep` once and retries.
 * A second failure sets `unreadable` so every row becomes `live-unknown` instead of being offered for injection.
 * The shape is a bare array, or `{ sessions: [] }`.
 *
 * @param {string} file Active-session file.
 * @param {{ readFileSync: Function, existsSync: Function, sleep?: Function }} io Filesystem and clock.
 * @returns {Promise<{ entries: Array<Record<string, unknown>>, unreadable: boolean }>}
 */
async function readActiveSessions(file, io) {
    if (!io.existsSync(file))
        return { entries: [], unreadable: false };
    const parse = (text) => {
        const value = JSON.parse(text);
        if (Array.isArray(value))
            return value;
        if (value && Array.isArray(value.sessions))
            return value.sessions;
        return null;
    };
    const once = () => {
        try {
            return { value: parse(io.readFileSync(file, 'utf8')), threw: false };
        }
        catch {
            return { value: null, threw: true };
        }
    };
    const first = once();
    if (!first.threw && first.value)
        return { entries: first.value, unreadable: false };
    if (!first.threw && first.value && first.value.length === 0)
        return { entries: [], unreadable: false };
    await (io.sleep ?? delay)(50);
    const second = once();
    if (!second.threw && Array.isArray(second.value))
        return { entries: second.value, unreadable: false };
    return { entries: [], unreadable: true };
}

/**
 * Classify a Grok session from the tail of `events.jsonl`.
 *
 * Boundary: `working` requires a live process and `turn_started` after the last `turn_ended`. `waiting` is that same
 * open turn when its last `phase_changed` is `permission_prompt`. Anything else, including a dead session, is `idle`.
 * A partial first line (the read started mid-record) is dropped when `dropFirst` is set.
 *
 * @param {string} text Tail text.
 * @param {boolean} live Whether the session pid is alive.
 * @param {boolean} dropFirst Drop the first line because the window started mid-file.
 * @returns {'working' | 'waiting' | 'idle'}
 */
function classifyGrokStatus(text, live, dropFirst) {
    const lines = String(text ?? '').split(/\r?\n/);
    if (dropFirst && lines.length > 1)
        lines.shift();
    const events = [];
    for (const line of lines) {
        if (!line.trim())
            continue;
        try {
            events.push(JSON.parse(line));
        }
        catch {
            // A torn last line is ignored; the next list sees a later tail.
        }
    }
    let lastStart = -1;
    let lastEnd = -1;
    events.forEach((event, index) => {
        const type = event?.type ?? event?.event;
        if (type === 'turn_started')
            lastStart = index;
        else if (type === 'turn_ended')
            lastEnd = index;
    });
    if (!live || lastStart <= lastEnd)
        return 'idle';
    let phase = '';
    for (let index = lastEnd + 1; index < events.length; index += 1) {
        const event = events[index];
        const type = event?.type ?? event?.event;
        if (type === 'phase_changed')
            phase = event.phase ?? event.payload?.phase ?? '';
    }
    return phase === 'permission_prompt' ? 'waiting' : 'working';
}

/**
 * Whether one Grok session is currently open in a terminal.
 *
 * Boundary: unknown liveness (unreadable active file) is treated as live so the launcher is not written. A dead pid
 * returns false. The id must already be a UUID; this helper does not accept page paths.
 *
 * @param {string} home Grok home directory.
 * @param {string} sessionId Session UUID.
 * @param {{ readFileSync: Function, existsSync: Function, sleep?: Function }} [io] Filesystem override.
 * @returns {Promise<boolean>} True when injection must be refused.
 */
export async function isGrokSessionLive(home, sessionId, io = fs) {
    const active = await readActiveSessions(path.join(home, 'active_sessions.json'), io);
    if (active.unreadable)
        return true;
    return active.entries.some((entry) => {
        const id = entry?.session_id ?? entry?.sessionId;
        return id === sessionId && pidAlive(entry?.pid);
    });
}

/**
 * List Grok sessions for the current project.
 *
 * Boundary: only `session_kind` of `''` or `'fork'` is included. A live pid yields `targetable: false` and
 * `reason: "open-in-terminal"`. A missing cwd yields `cwd-missing`. When `active_sessions.json` is still unreadable
 * after one retry, every row is `live-unknown`. A missing home returns an empty list and no notice. Session directory
 * names are `encodeURIComponent(cwd)` and are decoded here; the page never supplies that path.
 *
 * @param {{ projectRoot: string, config?: Record<string, unknown>, io?: typeof fs }} input Inspector root and Grok config.
 * @returns {Promise<{ sessions: Array<Record<string, unknown>>, delivery: 'resume-submit', notice?: string }>}
 */
export async function listGrokSessions(input) {
    const io = input.io ?? fs;
    const config = input.config ?? {};
    const picker = readSessionPicker(config);
    const home = resolveGrokHome(config);
    const delivery = 'resume-submit';
    if (!io.existsSync(home))
        return { sessions: [], delivery };
    const sessionsRoot = path.join(home, 'sessions');
    if (!io.existsSync(sessionsRoot))
        return { sessions: [], delivery };
    const extraRoot = typeof config.projectRoot === 'string' && config.projectRoot.trim()
        ? path.resolve(config.projectRoot.trim())
        : '';
    const scope = buildProjectScope(input.projectRoot, extraRoot ? [extraRoot] : [], { io });
    const active = await readActiveSessions(path.join(home, 'active_sessions.json'), io);
    const liveIds = new Set();
    if (!active.unreadable) {
        for (const entry of active.entries) {
            const id = entry?.session_id ?? entry?.sessionId;
            if (typeof id === 'string' && pidAlive(entry?.pid))
                liveIds.add(id);
        }
    }
    const sessions = [];
    let sawSummary = false;
    let parsedSummary = false;
    let names = [];
    try {
        names = io.readdirSync(sessionsRoot);
    }
    catch {
        return { sessions: [], delivery, notice: 'unsupported-format' };
    }
    for (const encoded of names) {
        let cwdName;
        try {
            cwdName = decodeURIComponent(encoded);
        }
        catch {
            continue;
        }
        if (!matchSessionCwd(cwdName, scope))
            continue;
        const parent = path.join(sessionsRoot, encoded);
        let ids = [];
        try {
            if (!io.statSync(parent).isDirectory())
                continue;
            ids = io.readdirSync(parent);
        }
        catch {
            continue;
        }
        for (const id of ids) {
            if (!SESSION_ID_PATTERN.test(id))
                continue;
            const summaryPath = path.join(parent, id, 'summary.json');
            if (!io.existsSync(summaryPath))
                continue;
            sawSummary = true;
            let summary;
            try {
                summary = JSON.parse(io.readFileSync(summaryPath, 'utf8'));
            }
            catch {
                continue;
            }
            if (!summary || typeof summary !== 'object')
                continue;
            parsedSummary = true;
            const kind = summary.session_kind ?? summary.info?.session_kind ?? '';
            if (kind && (EXCLUDED_KINDS.has(kind) || kind !== 'fork'))
                continue;
            const normalizedCwd = normalizeScopePath(cwdName, io);
            const cwdExists = io.existsSync(normalizedCwd);
            const live = liveIds.has(id);
            let reason;
            let targetable = true;
            if (active.unreadable) {
                targetable = false;
                reason = 'live-unknown';
            }
            else if (live) {
                targetable = false;
                reason = 'open-in-terminal';
            }
            else if (!cwdExists) {
                targetable = false;
                reason = 'cwd-missing';
            }
            let status = 'idle';
            const eventsPath = path.join(parent, id, 'events.jsonl');
            if (io.existsSync(eventsPath)) {
                try {
                    const size = io.statSync(eventsPath).size;
                    const tail = readTail(eventsPath, EVENT_TAIL_BYTES, io);
                    status = classifyGrokStatus(tail, live && !active.unreadable, size > EVENT_TAIL_BYTES);
                }
                catch {
                    status = 'idle';
                }
            }
            const updatedRaw = summary.last_active_at ?? summary.updated_at ?? '';
            sessions.push({
                id,
                title: sessionTitle(summary.generated_title || summary.session_summary || ''),
                cwd: normalizedCwd,
                projectName: sessionProjectName(normalizedCwd, scope.platform),
                location: sessionLocation(normalizedCwd, scope.projectRoot, scope.platform),
                status,
                live: live && !active.unreadable,
                targetable,
                reason,
                updatedAt: Number.isFinite(Date.parse(updatedRaw))
                    ? new Date(updatedRaw).toISOString()
                    : new Date(io.statSync(summaryPath).mtimeMs).toISOString(),
            });
        }
    }
    if (sawSummary && !parsedSummary)
        return { sessions: [], delivery, notice: 'unsupported-format' };
    sessions.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return { sessions: sessions.slice(0, picker.limit), delivery };
}
