import fs from 'node:fs';
import path from 'node:path';
import { assertPathInsideRoot } from './security.js';

/**
 * How long a generated artifact stays readable.
 *
 * Purpose: screenshots, recordings, and file handoffs are named from a prompt the agent opens later.
 * One window makes one send's files expire together.
 * Boundary: comparisons use `now - mtime <= ARTIFACT_MAX_AGE_MS`, so a file aged exactly this long is kept.
 * A shorter window drops a handoff the agent has not opened yet.
 */
export const ARTIFACT_MAX_AGE_MS = 4 * 60 * 60 * 1000;

/**
 * Leftover files older builds wrote and this server does not.
 *
 * Boundary: `requests/` is a live handoff directory and must not be listed here. Deleting it on the next
 * send removes a path the previous prompt already handed to an agent.
 */
const LEGACY_LOG_ARTIFACTS = ['audit.log'];

/** Subdirectory of file-handoff markdown. Agents open these paths after the send returns. */
const REQUESTS_SUBDIR = 'requests';

/** Only this extension is a handoff file. Other names in the directory are left alone. */
const REQUEST_EXTENSION = '.md';

/**
 * List one directory, or an empty list when it is missing or unreadable.
 *
 * Boundary: errors are swallowed so artifact cleanup cannot fail a send. A path that is not a directory
 * also returns an empty list.
 *
 * @param dir Absolute directory.
 * @returns Directory entries. Empty when the directory cannot be read.
 */
function readArtifactDir(dir: string): fs.Dirent[] {
    try {
        return fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return [];
    }
}

/**
 * Remove leftover log files from an inspector output directory.
 *
 * Purpose: `audit.log` is no longer written (`logger.audit` is a no-op). Drop a copy left by an older build.
 * Boundary: each target must resolve inside `projectRoot`. A path that fails the guard, or a file that is already
 * gone, is skipped. This never removes `requests/`.
 *
 * @param outputDir Absolute inspector output directory.
 * @param projectRoot Absolute project root used as the containment boundary.
 * @returns {void}
 */
function removeLegacyLogs(outputDir: string, projectRoot: string) {
    for (const name of LEGACY_LOG_ARTIFACTS) {
        const target = path.join(outputDir, name);
        try {
            assertPathInsideRoot(target, projectRoot);
            fs.rmSync(target, { recursive: true, force: true });
        }
        catch {
            // Best effort: a stale log should not block the inspector.
        }
    }
}

/**
 * Delete handoff markdown older than {@link ARTIFACT_MAX_AGE_MS}.
 *
 * Purpose: `requests/` is the file an agent opens after send. A later send must leave a pointer that has not
 * been read yet. Age is the bound because that read happens outside this process.
 * Boundary: only regular `.md` files directly inside `outputDir/requests` are removed. The directory, other
 * files, subdirectories, and symlinks stay. A `requests` path that is itself a symlink is skipped, so cleanup
 * cannot follow it out of the project. The directory must resolve inside `projectRoot`; a guard failure or a
 * missing directory removes nothing.
 *
 * @param outputDir Absolute inspector output directory.
 * @param projectRoot Absolute project root used as the containment boundary.
 * @param nowMs Current time in milliseconds.
 * @returns Number of handoff files removed.
 */
function removeExpiredRequests(outputDir: string, projectRoot: string, nowMs: number) {
    const dir = path.join(outputDir, REQUESTS_SUBDIR);
    let removed = 0;
    let dirStat: fs.Stats;
    try {
        assertPathInsideRoot(dir, projectRoot);
        dirStat = fs.lstatSync(dir);
    }
    catch {
        return 0;
    }
    if (!dirStat.isDirectory())
        return 0;
    for (const entry of readArtifactDir(dir)) {
        if (!entry.isFile())
            continue;
        if (path.extname(entry.name).toLowerCase() !== REQUEST_EXTENSION)
            continue;
        const file = path.join(dir, entry.name);
        try {
            assertPathInsideRoot(file, projectRoot);
            const stat = fs.lstatSync(file);
            if (!stat.isFile())
                continue;
            if (nowMs - stat.mtimeMs <= ARTIFACT_MAX_AGE_MS)
                continue;
            fs.rmSync(file, { force: true });
            removed += 1;
        }
        catch {
            // Best effort: one stuck handoff file must not block the next send.
        }
    }
    return removed;
}

/**
 * Drop leftover audit logs and handoff files past their retention window.
 *
 * Purpose: called before a send and when the plugin learns the project root. Recent `requests/*.md` stay,
 * because an agent may still open the previous handoff. `audit.log` is unused and removed outright.
 * Boundary: see {@link removeLegacyLogs} and {@link removeExpiredRequests}. Either step swallowing an error
 * still lets the other step run. `nowMs` is injectable so tests can age files without sleeping.
 *
 * @param outputDir Absolute inspector output directory.
 * @param projectRoot Absolute project root used as the containment boundary.
 * @param nowMs Current time in milliseconds. Defaults to `Date.now()`.
 * @returns Number of expired handoff files removed. Legacy log removal is not counted.
 */
export function cleanupInspectorArtifacts(outputDir: string, projectRoot: string, nowMs = Date.now()) {
    removeLegacyLogs(outputDir, projectRoot);
    return removeExpiredRequests(outputDir, projectRoot, nowMs);
}
