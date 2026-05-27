import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_DAYS = 15;
const MAX_TITLE_LINES = 240;
const MAX_TITLE_LENGTH = 88;
const MAX_HISTORY_MESSAGES = 120;

/**
 * Resolve the Codex Desktop session root.
 *
 * @param {string | undefined} configuredRoot Optional configured root.
 * @param {string} homeDir User home directory.
 * @returns {string} Absolute path to the Codex sessions directory.
 */
export function resolveCodexSessionsRoot(configuredRoot, homeDir = os.homedir()) {
    if (typeof configuredRoot === 'string' && configuredRoot.trim()) {
        return path.resolve(configuredRoot.trim());
    }

    return path.join(homeDir, '.codex', 'sessions');
}

function pad2(value) {
    return String(value).padStart(2, '0');
}

/**
 * Compute session date directories using local time.
 *
 * @param {string} root Codex session root.
 * @param {number} days Number of days including today.
 * @param {Date} now Current local date.
 * @returns {string[]} Candidate `YYYY/MM/DD` directories, newest first.
 */
export function recentSessionDateDirs(root, days = DEFAULT_DAYS, now = new Date()) {
    const safeDays = Number.isFinite(Number(days)) && Number(days) > 0
        ? Math.floor(Number(days))
        : DEFAULT_DAYS;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dirs = [];

    for (let i = 0; i < safeDays; i += 1) {
        const date = new Date(start);
        date.setDate(start.getDate() - i);
        dirs.push(path.join(root, String(date.getFullYear()), pad2(date.getMonth() + 1), pad2(date.getDate())));
    }

    return dirs;
}

/**
 * Keep only date directories that exist on disk.
 *
 * @param {string[]} dirs Candidate directories.
 * @returns {string[]} Existing directories.
 */
export function existingSessionDateDirs(dirs) {
    return dirs.filter((dir) => {
        try {
            return fs.statSync(dir).isDirectory();
        }
        catch {
            return false;
        }
    });
}

function normalizeProjectRoots(projectRoots) {
    const roots = Array.isArray(projectRoots) ? projectRoots : [projectRoots];
    return [...new Set(roots
            .filter((root) => typeof root === 'string' && root.trim())
            .map((root) => path.resolve(root.trim())))];
}

export function resolveCodexProjectRoots(projectRoot, extraRoots = []) {
    return normalizeProjectRoots([projectRoot, ...extraRoots]);
}

/**
 * Build the ripgrep args used for project-session prefiltering.
 *
 * @param {string | string[]} projectRoot Exact project root string(s) to match.
 * @param {string[]} dirs Date directories to scan.
 * @returns {string[]} `rg` arguments.
 */
export function buildProjectSessionSearchArgs(projectRoot, dirs) {
    const roots = normalizeProjectRoots(projectRoot);
    if (!roots.length)
        return [];
    if (roots.length <= 1) {
        return ['-l', '--fixed-strings', roots[0], ...dirs];
    }
    return ['-l', '--fixed-strings', ...roots.flatMap((root) => ['-e', root]), ...dirs];
}

function collectJsonlFiles(dir, out = []) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return out;
    }

    for (const entry of entries) {
        const filePath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectJsonlFiles(filePath, out);
        }
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            out.push(filePath);
        }
    }

    return out;
}

async function fileMentionsAnyRoot(filePath, roots) {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

    try {
        for await (const line of lines) {
            if (roots.some((root) => line.includes(root))) {
                return true;
            }
        }
    }
    catch {
        return false;
    }
    finally {
        lines.close();
        stream.destroy();
    }

    return false;
}

async function searchProjectSessionFilesWithoutRg(projectRoot, dirs) {
    const roots = normalizeProjectRoots(projectRoot);
    if (!dirs.length || !roots.length)
        return [];

    const files = dirs.flatMap((dir) => collectJsonlFiles(dir));
    const matches = [];
    for (const file of files) {
        if (await fileMentionsAnyRoot(file, roots)) {
            matches.push(file);
        }
    }

    return matches;
}

/**
 * Search the recent Codex session directories for files mentioning this project.
 *
 * Boundary: this is the only broad scan. The caller computes date directories
 * first, then ripgrep narrows the candidate JSONL files before parsing.
 *
 * @param {string | string[]} projectRoot Current project root(s).
 * @param {string[]} dirs Existing recent date directories.
 * @param {string} rgPath Ripgrep executable.
 * @returns {Promise<string[]>} Candidate JSONL files.
 */
export async function searchProjectSessionFiles(projectRoot, dirs, rgPath = 'rg') {
    if (!dirs.length || !normalizeProjectRoots(projectRoot).length)
        return [];

    try {
        const { stdout } = await execFileAsync(rgPath, buildProjectSessionSearchArgs(projectRoot, dirs), {
            maxBuffer: 10 * 1024 * 1024,
        });
        return stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.endsWith('.jsonl'));
    }
    catch (err) {
        if (err && typeof err === 'object' && err.code === 1) {
            return [];
        }
        if (err && typeof err === 'object' && err.code === 'ENOENT') {
            return searchProjectSessionFilesWithoutRg(projectRoot, dirs);
        }
        throw err;
    }
}

function compactTitle(value) {
    let text = String(value ?? '');
    const requestMatch = text.match(/(?:My request for Codex:|My request:)([\s\S]*)/i);
    if (requestMatch?.[1]) {
        text = requestMatch[1];
    }
    if (/^\s*#\s*AGENTS\.md instructions for\b/i.test(text)) {
        return '';
    }
    if (/^\s*<environment_context>/i.test(text)) {
        return '';
    }
    let hasTitleContent = false;
    const strippedRefs = text
        .split(/\r?\n/)
        .filter((line) => {
        const trimmed = line.trim();
        if (hasTitleContent)
            return true;
        if (!trimmed || trimmed.startsWith('@'))
            return false;
        hasTitleContent = true;
        return true;
    })
        .join('\n')
        .trim();
    if (strippedRefs)
        text = strippedRefs;

    return text
        .replace(/<image\b[\s\S]*?<\/image>/gi, ' ')
        .replace(/^# Files mentioned by the user:[\s\S]*?(?=\n\S)/i, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_TITLE_LENGTH);
}

function compactIndexTitle(value) {
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_TITLE_LENGTH);
}

function codexSessionIndexPath(sessionsRoot) {
    return path.join(path.dirname(resolveCodexSessionsRoot(sessionsRoot)), 'session_index.jsonl');
}

function readCodexSessionIndex(sessionsRoot) {
    const indexPath = codexSessionIndexPath(sessionsRoot);
    let text;
    try {
        text = fs.readFileSync(indexPath, 'utf8');
    }
    catch {
        return new Map();
    }

    const entries = new Map();
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim())
            continue;
        let record;
        try {
            record = JSON.parse(line);
        }
        catch {
            continue;
        }
        const id = typeof record?.id === 'string' && record.id.trim()
            ? record.id.trim()
            : '';
        if (!id)
            continue;
        entries.set(id, {
            title: compactIndexTitle(record.thread_name ?? record.title),
            updatedAt: typeof record.updated_at === 'string' ? record.updated_at : undefined,
        });
    }

    return entries;
}

function applySessionIndex(records, sessionsRoot) {
    const index = readCodexSessionIndex(sessionsRoot);
    if (!index.size)
        return records;

    return records.map((record) => {
        const entry = index.get(String(record.id ?? ''));
        if (!entry)
            return record;
        return {
            ...record,
            title: entry.title || record.title,
            updatedAt: entry.updatedAt || record.updatedAt,
        };
    });
}

function compactHistoryText(value) {
    let text = String(value ?? '')
        .replace(/<image\b[\s\S]*?<\/image>/gi, ' ')
        .trim();
    if (!text)
        return '';
    if (/^#\s*AGENTS\.md instructions for\b/i.test(text))
        return '';
    if (/^<environment_context>/i.test(text))
        return '';

    const requestMatch = text.match(/(?:##\s*)?My request for Codex:([\s\S]*)/i)
        ?? text.match(/My request:([\s\S]*)/i);
    if (requestMatch?.[1]) {
        text = requestMatch[1];
    }
    else {
        text = text.replace(/^# Files mentioned by the user:[\s\S]*?(?=\n\S)/i, ' ');
    }

    return text
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function readContentText(content) {
    if (typeof content === 'string')
        return content;
    if (!Array.isArray(content))
        return undefined;

    return content
        .map((item) => {
            if (typeof item === 'string')
                return item;
            if (typeof item?.text === 'string')
                return item.text;
            return '';
        })
        .filter(Boolean)
        .join(' ');
}

function extractUserTitle(record) {
    const payload = record?.payload;
    if (record?.type === 'event_msg' && payload?.type === 'user_message') {
        return compactTitle(payload.message);
    }
    if (record?.type === 'response_item' && payload?.role === 'user') {
        return compactTitle(readContentText(payload.content));
    }
    if (record?.type === 'turn_context' && typeof payload?.user_prompt === 'string') {
        return compactTitle(payload.user_prompt);
    }
    return '';
}

function extractHistoryMessage(record) {
    const payload = record?.payload;
    if (record?.type === 'event_msg' && payload?.type === 'user_message') {
        return { type: 'user', text: compactHistoryText(payload.message) };
    }
    if (record?.type === 'event_msg' && payload?.type === 'agent_message') {
        return {
            type: payload.phase === 'commentary' ? 'status' : 'assistant',
            text: compactHistoryText(payload.message),
        };
    }
    if (record?.type === 'response_item' && payload?.type === 'message') {
        if (payload.role === 'user') {
            return { type: 'user', text: compactHistoryText(readContentText(payload.content)) };
        }
        if (payload.role === 'assistant') {
            return {
                type: payload.phase === 'commentary' ? 'status' : 'assistant',
                text: compactHistoryText(readContentText(payload.content)),
            };
        }
    }
    return null;
}

function pushHistoryMessage(messages, message) {
    if (!message?.text)
        return;
    const duplicate = messages
        .slice(-4)
        .some((item) => item.type === message.type && item.text === message.text);
    if (duplicate)
        return;
    messages.push(message);
    if (messages.length > MAX_HISTORY_MESSAGES) {
        messages.splice(0, messages.length - MAX_HISTORY_MESSAGES);
    }
}

function idFromFilename(filePath) {
    const base = path.basename(filePath, '.jsonl');
    const match = base.match(/T\d{2}-\d{2}-\d{2}-(.+)$/);
    return match?.[1] || base;
}

function timestampFromFilename(filePath) {
    const base = path.basename(filePath);
    const match = base.match(/rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
    if (!match)
        return undefined;
    const iso = `${match[1].replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3')}Z`;
    const time = new Date(iso);
    return Number.isNaN(time.getTime()) ? undefined : time.toISOString();
}

function normalizedMetaCwd(meta) {
    return typeof meta?.cwd === 'string' && meta.cwd.trim()
        ? path.resolve(meta.cwd)
        : '';
}

/**
 * Parse one candidate Codex JSONL file after ripgrep has matched it.
 *
 * @param {string} filePath Candidate JSONL file.
 * @param {string | string[]} projectRoot Exact project root(s) allowed in `session_meta.cwd`.
 * @returns {Promise<Record<string, unknown> | null>} Compact session record.
 */
export async function parseCodexSessionFile(filePath, projectRoot) {
    const allowedRoots = new Set(normalizeProjectRoots(projectRoot));
    let meta = null;
    let title = '';
    let lineCount = 0;

    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

    try {
        for await (const line of lines) {
            lineCount += 1;
            if (!line.trim())
                continue;

            let record;
            try {
                record = JSON.parse(line);
            }
            catch {
                continue;
            }

            if (record?.type === 'session_meta') {
                meta = record.payload ?? {};
                if (!allowedRoots.has(normalizedMetaCwd(meta))) {
                    lines.close();
                    stream.destroy();
                    return null;
                }
            }

            if (!title) {
                title = extractUserTitle(record);
            }

            if (meta && title)
                break;
            if (meta && lineCount >= MAX_TITLE_LINES)
                break;
        }
    }
    finally {
        lines.close();
        stream.destroy();
    }

    if (!meta || !allowedRoots.has(normalizedMetaCwd(meta)))
        return null;

    let stat;
    try {
        stat = fs.statSync(filePath);
    }
    catch {
        stat = null;
    }

    const startedAt = meta.timestamp ?? timestampFromFilename(filePath);

    return {
        id: meta.id ?? idFromFilename(filePath),
        title: title || 'Untitled session',
        startedAt,
        updatedAt: stat ? stat.mtime.toISOString() : startedAt,
        cwd: meta.cwd,
        source: meta.originator ?? meta.source,
        model: meta.model ?? meta.model_provider,
        filePath,
    };
}

/**
 * Parse displayable user/assistant history from a Codex JSONL session.
 *
 * @param {string} filePath Candidate JSONL file.
 * @param {string | string[]} projectRoot Exact project root(s) allowed in `session_meta.cwd`.
 * @returns {Promise<Array<{ type: string, text: string }> | null>} Compact chat history, or null when the session cwd is outside this project.
 */
export async function parseCodexSessionMessages(filePath, projectRoot) {
    const allowedRoots = new Set(normalizeProjectRoots(projectRoot));
    let meta = null;
    const messages = [];

    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

    try {
        for await (const line of lines) {
            if (!line.trim())
                continue;

            let record;
            try {
                record = JSON.parse(line);
            }
            catch {
                continue;
            }

            if (record?.type === 'session_meta') {
                meta = record.payload ?? {};
                if (!allowedRoots.has(normalizedMetaCwd(meta))) {
                    lines.close();
                    stream.destroy();
                    return null;
                }
                continue;
            }
            if (!meta)
                continue;

            pushHistoryMessage(messages, extractHistoryMessage(record));
        }
    }
    finally {
        lines.close();
        stream.destroy();
    }

    if (!meta || !allowedRoots.has(normalizedMetaCwd(meta)))
        return null;

    return messages;
}

/**
 * List recent Codex sessions for the current project.
 *
 * @param {{ projectRoot: string, projectRoots?: string[], sessionsRoot?: string, days?: number, now?: Date, rgPath?: string, searchFiles?: Function }} options Listing options.
 * @returns {Promise<Array<Record<string, unknown>>>} Sorted compact sessions.
 */
export async function listProjectCodexSessions(options) {
    const root = resolveCodexSessionsRoot(options.sessionsRoot);
    const projectRoots = resolveCodexProjectRoots(options.projectRoot, options.projectRoots ?? []);
    const candidates = recentSessionDateDirs(root, options.days ?? DEFAULT_DAYS, options.now ?? new Date());
    const dirs = existingSessionDateDirs(candidates);
    const searchFiles = options.searchFiles ?? ((projectRoot, searchDirs) => searchProjectSessionFiles(projectRoot, searchDirs, options.rgPath));
    const files = await searchFiles(projectRoots, dirs);
    const records = await Promise.all([...new Set(files)].map((file) => parseCodexSessionFile(file, projectRoots)));

    return applySessionIndex(records.filter(Boolean), root)
        .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
}
