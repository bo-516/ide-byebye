import fs from 'node:fs';
import path from 'node:path';
/** JSON object stored in sessions.json. Nested values are whatever the caller wrote. */
type SessionData = Record<string, unknown>;

const EMPTY = { version: 1 };
/**
 * Tiny JSON-file backed key/value store for agent thread/session ids.
 *
 * - Lazily creates the file on first write.
 * - Writes atomically (temp file + rename).
 * - Backs up and resets a corrupt file instead of throwing.
 *
 * Keys use dotted paths, e.g. `agent.lastThreadId`.
 */
export class SessionStore {
    dirAbs: string;
    file: string;
    cache: SessionData | null = null;
    constructor(dirAbs: string) {
        this.dirAbs = dirAbs;
        this.file = path.join(dirAbs, 'sessions.json');
    }
    load(): SessionData {
        if (this.cache)
            return this.cache;
        if (!fs.existsSync(this.file)) {
            this.cache = { ...EMPTY };
            return this.cache!;
        }
        try {
            const raw = fs.readFileSync(this.file, 'utf8');
            const parsed = JSON.parse(raw);
            this.cache = parsed && typeof parsed === 'object' ? parsed : { ...EMPTY };
        }
        catch {
            this.backupCorrupt();
            this.cache = { ...EMPTY };
        }
        return this.cache!;
    }
    backupCorrupt() {
        try {
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backup = path.join(this.dirAbs, `sessions.corrupt.${stamp}.json`);
            fs.renameSync(this.file, backup);
        }
        catch {
            // best effort
        }
    }
    persist(data: SessionData) {
        fs.mkdirSync(this.dirAbs, { recursive: true });
        const tmp = path.join(this.dirAbs, `sessions.${process.pid}.${Date.now()}.tmp`);
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmp, this.file);
    }
    get(dottedKey: string): unknown {
        const data = this.load();
        const parts = dottedKey.split('.');
        let node: SessionData = data;
        for (const part of parts) {
            if (node == null || typeof node !== 'object')
                return undefined;
            node = node[part] as SessionData;
        }
        return node;
    }
    set(dottedKey: string, value: unknown) {
        const data = this.load();
        const parts = dottedKey.split('.');
        let node: SessionData = data;
        for (let i = 0; i < parts.length - 1; i += 1) {
            const part = parts[i];
            if (node[part] == null || typeof node[part] !== 'object') {
                node[part] = {};
            }
            node = node[part] as SessionData;
        }
        node[parts[parts.length - 1]] = value;
        this.cache = data;
        this.persist(data);
    }
    all() {
        return this.load();
    }
}
