import fs from 'node:fs';

/**
 * Read at most `maxBytes` from the start of a file.
 *
 * Boundary: the file is never slurped. A shorter file returns its whole contents. `maxBytes` below 1 yields `''`.
 * A missing file throws from `statSync` — callers skip candidates that disappear mid-scan.
 *
 * @param {string} file Absolute path chosen by the server, never by the page.
 * @param {number} maxBytes Maximum bytes to read (Codex heads use 4096).
 * @param {typeof fs} [io] Filesystem implementation; tests pass a wrapper, production uses `node:fs`.
 * @returns {string} UTF-8 prefix. A multibyte character split by the cap may end with a replacement character.
 */
export function readHead(file, maxBytes, io = fs) {
    return readWindow(file, maxBytes, 'head', io);
}

/**
 * Read at most `maxBytes` from the end of a file.
 *
 * Boundary: when the file is smaller than the window the whole file is returned. Larger files return only the tail,
 * which is what keeps rollout scans off the full transcript. A missing file throws.
 *
 * @param {string} file Absolute path chosen by the server.
 * @param {number} maxBytes Maximum bytes to read (Codex tails start at 65536 and may retry at 524288).
 * @param {typeof fs} [io] Filesystem implementation.
 * @returns {string} UTF-8 suffix.
 */
export function readTail(file, maxBytes, io = fs) {
    return readWindow(file, maxBytes, 'tail', io);
}

/**
 * Shared bounded read. `where` selects the start offset.
 *
 * Boundary: `readSync` is issued once for exactly the clamped length. Callers must not follow this with a full-file
 * read of the same rollout.
 *
 * @param {string} file Absolute file path.
 * @param {number} maxBytes Requested window.
 * @param {'head' | 'tail'} where Which end of the file to read.
 * @param {typeof fs} io Filesystem implementation.
 * @returns {string} Decoded window.
 */
function readWindow(file, maxBytes, where, io) {
    const size = io.statSync(file).size;
    const length = Math.max(0, Math.min(size, Math.floor(Number(maxBytes) || 0)));
    if (length === 0)
        return '';
    const position = where === 'tail' ? size - length : 0;
    const handle = io.openSync(file, 'r');
    try {
        const buffer = Buffer.alloc(length);
        const read = io.readSync(handle, buffer, 0, length, position);
        return buffer.subarray(0, read).toString('utf8');
    }
    finally {
        io.closeSync(handle);
    }
}

/**
 * Whether a pid is still alive.
 *
 * Boundary: `process.kill(pid, 0)` does not signal the process. `EPERM` counts as alive (the process exists but we
 * cannot signal it). `ESRCH` and a non-positive or non-integer pid count as dead. This is the Grok "open in a
 * terminal" check and can false-positive if the pid was recycled.
 *
 * @param {unknown} pid Process id from `active_sessions.json`.
 * @returns {boolean} True when the kernel still has that process.
 */
export function pidAlive(pid) {
    const parsed = Number(pid);
    if (!Number.isInteger(parsed) || parsed <= 0)
        return false;
    try {
        process.kill(parsed, 0);
        return true;
    }
    catch (err) {
        return err?.code === 'EPERM';
    }
}
