import fs from 'node:fs';

/**
 * Filesystem calls the session catalog actually makes.
 *
 * Boundary: tests spread `node:fs` and replace `readFileSync` or `readSync` with a narrower signature. A structural
 * surface accepts those stand-ins and `node:fs` itself; `typeof fs` does not, because the overloads disagree.
 * Paths passed here are server-derived, never page input.
 */
export interface SessionFs {
    /** True when the path exists. A thrown error is the caller's problem; this method itself returns a boolean. */
    existsSync(path: fs.PathLike): boolean;
    /** Stat fields the catalog reads. Missing methods would make directory walks and tail windows fail to type-check. */
    statSync(path: fs.PathLike): { size: number; mtimeMs: number; isDirectory(): boolean; isFile(): boolean };
    /** Directory names as strings. A Buffer encoding would break the path joins that follow. */
    readdirSync(path: fs.PathLike): string[];
    /** UTF-8 file text. Callers pass `'utf8'`; a Buffer return would leak into JSON parsing. */
    readFileSync(path: fs.PathOrFileDescriptor, encoding: BufferEncoding): string;
    /** Open a file descriptor. `flags` is the same `OpenMode` `node:fs` requires, so `'r'` is accepted. */
    openSync(path: fs.PathLike, flags: fs.OpenMode): number;
    /**
     * One positioned read. `position` is `number | null` (not bigint) so the Codex test double, which types its
     * position as `number | null`, still assigns. The buffer is an ArrayBufferView because `fs.readSync` accepts one.
     */
    readSync(fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number | null): number;
    /** Close the descriptor opened by {@link openSync}. */
    closeSync(fd: number): void;
    /** `realpathSync.native` plus the callback form. Scope checks use both. */
    realpathSync: typeof fs.realpathSync;
}

/**
 * Read at most `maxBytes` from the start of a file.
 *
 * Boundary: the file is never slurped. A shorter file returns its whole contents. `maxBytes` below 1 yields `''`.
 * A missing file throws from `statSync` — callers skip candidates that disappear mid-scan.
 *
 * @param {string} file Absolute path chosen by the server, never by the page.
 * @param {number} maxBytes Maximum bytes to read (Codex heads use 4096).
 * @param {SessionFs} [io] Filesystem implementation; tests pass a wrapper, production uses `node:fs`.
 * @returns {string} UTF-8 prefix. A multibyte character split by the cap may end with a replacement character.
 */
export function readHead(file: string, maxBytes: number, io: SessionFs = fs) {
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
 * @param {SessionFs} [io] Filesystem implementation.
 * @returns {string} UTF-8 suffix.
 */
export function readTail(file: string, maxBytes: number, io: SessionFs = fs) {
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
 * @param {SessionFs} io Filesystem implementation.
 * @returns {string} Decoded window.
 */
function readWindow(file: string, maxBytes: number, where: 'head' | 'tail', io: SessionFs) {
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
 * @param {unknown} pid Process id from `active_sessions.json`. A non-number is dead.
 * @returns {boolean} True when the kernel still has that process.
 */
export function pidAlive(pid: unknown) {
    const parsed = Number(pid);
    if (!Number.isInteger(parsed) || parsed <= 0)
        return false;
    try {
        process.kill(parsed, 0);
        return true;
    }
    catch (err) {
        // Strict catch is `unknown`, so `err?.code` is not a property access. The cast is erased.
        return (err as { code?: string } | null)?.code === 'EPERM';
    }
}
