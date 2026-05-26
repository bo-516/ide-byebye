import fs from 'node:fs';
import path from 'node:path';
const EMPTY = { version: 1 };
/**
 * Tiny JSON-file backed key/value store for agent thread/session ids.
 *
 * - Lazily creates the file on first write.
 * - Writes atomically (temp file + rename).
 * - Backs up and resets a corrupt file instead of throwing.
 *
 * Keys use dotted paths, e.g. `codexSdk.lastThreadId`.
 */
export class SessionStore {
    dirAbs;
    file;
    cache = null;
    constructor(dirAbs) {
        this.dirAbs = dirAbs;
        this.file = path.join(dirAbs, 'sessions.json');
    }
    load() {
        if (this.cache)
            return this.cache;
        if (!fs.existsSync(this.file)) {
            this.cache = { ...EMPTY };
            return this.cache;
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
        return this.cache;
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
    persist(data) {
        fs.mkdirSync(this.dirAbs, { recursive: true });
        const tmp = path.join(this.dirAbs, `sessions.${process.pid}.${Date.now()}.tmp`);
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmp, this.file);
    }
    get(dottedKey) {
        const data = this.load();
        const parts = dottedKey.split('.');
        let node = data;
        for (const part of parts) {
            if (node == null || typeof node !== 'object')
                return undefined;
            node = node[part];
        }
        return node;
    }
    set(dottedKey, value) {
        const data = this.load();
        const parts = dottedKey.split('.');
        let node = data;
        for (let i = 0; i < parts.length - 1; i += 1) {
            const part = parts[i];
            if (node[part] == null || typeof node[part] !== 'object') {
                node[part] = {};
            }
            node = node[part];
        }
        node[parts[parts.length - 1]] = value;
        this.cache = data;
        this.persist(data);
    }
    all() {
        return this.load();
    }
}
