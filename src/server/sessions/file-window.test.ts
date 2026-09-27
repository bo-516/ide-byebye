import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pidAlive, readHead, readTail } from './file-window.js';

test('readHead and readTail return a short file whole and only the tail of a longer one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'window-'));
    const file = path.join(dir, 'rollout.jsonl');
    fs.writeFileSync(file, 'HEAD-MARKER\n' + 'x'.repeat(100) + '\nTAIL-MARKER');
    assert.equal(readHead(file, 4096).startsWith('HEAD-MARKER'), true);
    assert.equal(readTail(file, 65536).includes('TAIL-MARKER'), true);
    const tail = readTail(file, 11);
    assert.equal(tail, 'TAIL-MARKER');
    assert.equal(tail.includes('HEAD-MARKER'), false);
    assert.equal(pidAlive(2147483646), false);
    assert.equal(pidAlive(process.pid), true);
});
