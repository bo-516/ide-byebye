import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ARTIFACT_MAX_AGE_MS, cleanupInspectorArtifacts } from './output-cleanup.js';

/**
 * Write `text` at `file`, creating parent directories.
 *
 * @param file Absolute path. A relative path would land outside the temp root the test just made.
 * @param text File contents.
 */
function write(file: string, text: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
}

/**
 * Set both timestamps so retention sees `mtimeMs` as the file's age.
 *
 * @param file Absolute path of a file that already exists.
 * @param mtimeMs Timestamp in milliseconds.
 */
function age(file: string, mtimeMs: number) {
    const when = new Date(mtimeMs);
    fs.utimesSync(file, when, when);
}

test('handoff retention is the four-hour artifact window', () => {
    assert.equal(ARTIFACT_MAX_AGE_MS, 4 * 60 * 60 * 1000);
});

test('cleanup keeps recent handoffs and drops only expired markdown', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-cleanup-'));
    const outputDir = path.join(root, '.intent-inspector');
    const requests = path.join(outputDir, 'requests');
    const fresh = path.join(requests, 'fresh.md');
    const stale = path.join(requests, 'stale.md');
    const notes = path.join(requests, 'notes.txt');
    const nested = path.join(requests, 'nested', 'hidden.md');
    const launch = path.join(outputDir, 'launches', 'run.prompt.txt');
    // Whole seconds: Node 20's `utimesSync` hands libuv float seconds and its libuv truncates to microseconds, so about
    // half of millisecond timestamps read back 1 µs early and the exact-boundary file below would look expired.
    const now = Math.floor(Date.now() / 1000) * 1000;
    try {
        write(fresh, 'fresh-body');
        write(stale, 'stale-body');
        write(notes, 'keep-notes');
        write(nested, 'keep-nested');
        write(launch, 'keep-launch');
        write(path.join(outputDir, 'audit.log'), 'old-log');
        age(fresh, now - 1000);
        age(stale, now - ARTIFACT_MAX_AGE_MS - 1);
        age(notes, now - ARTIFACT_MAX_AGE_MS - 1);
        age(nested, now - ARTIFACT_MAX_AGE_MS - 1);
        age(launch, now - ARTIFACT_MAX_AGE_MS - 1);
        const boundary = path.join(requests, 'boundary.md');
        write(boundary, 'boundary-body');
        age(boundary, now - ARTIFACT_MAX_AGE_MS);

        const removed = cleanupInspectorArtifacts(outputDir, root, now);

        assert.equal(removed, 1);
        assert.equal(fs.readFileSync(fresh, 'utf8'), 'fresh-body');
        assert.equal(fs.readFileSync(boundary, 'utf8'), 'boundary-body');
        assert.equal(fs.existsSync(stale), false);
        assert.equal(fs.readFileSync(notes, 'utf8'), 'keep-notes');
        assert.equal(fs.readFileSync(nested, 'utf8'), 'keep-nested');
        assert.equal(fs.readFileSync(launch, 'utf8'), 'keep-launch');
        assert.equal(fs.existsSync(path.join(outputDir, 'audit.log')), false);
        assert.equal(fs.existsSync(requests), true);
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('cleanup keeps every recent handoff when several sends land together', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-cleanup-'));
    const requests = path.join(root, '.intent-inspector', 'requests');
    const first = path.join(requests, 'first.md');
    const second = path.join(requests, 'second.md');
    const now = Date.now();
    try {
        write(first, 'first-body');
        write(second, 'second-body');
        age(first, now - 5_000);
        age(second, now - 1_000);

        assert.equal(cleanupInspectorArtifacts(path.join(root, '.intent-inspector'), root, now), 0);
        assert.equal(fs.readFileSync(first, 'utf8'), 'first-body');
        assert.equal(fs.readFileSync(second, 'utf8'), 'second-body');
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('cleanup deletes nothing when the output directory is outside the project', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-cleanup-root-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-cleanup-out-'));
    const outputDir = path.join(outside, '.intent-inspector');
    const handoff = path.join(outputDir, 'requests', 'stale.md');
    const audit = path.join(outputDir, 'audit.log');
    try {
        write(handoff, 'outside');
        write(audit, 'outside-log');
        age(handoff, Date.now() - ARTIFACT_MAX_AGE_MS - 1);

        assert.equal(cleanupInspectorArtifacts(outputDir, root, Date.now()), 0);
        assert.equal(fs.readFileSync(handoff, 'utf8'), 'outside');
        assert.equal(fs.readFileSync(audit, 'utf8'), 'outside-log');
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

test('cleanup does not follow a symlinked requests directory or a symlinked markdown file', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-cleanup-link-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-cleanup-target-'));
    const outputDir = path.join(root, '.intent-inspector');
    const linkedDir = path.join(outside, 'real-requests');
    const secret = path.join(linkedDir, 'secret.md');
    const requests = path.join(outputDir, 'requests');
    const linkedFile = path.join(requests, 'linked.md');
    const outsideFile = path.join(outside, 'outside.md');
    const now = Date.now();
    try {
        write(secret, 'secret-body');
        age(secret, now - ARTIFACT_MAX_AGE_MS - 1);
        fs.mkdirSync(outputDir, { recursive: true });
        fs.symlinkSync(linkedDir, requests);
        assert.equal(cleanupInspectorArtifacts(outputDir, root, now), 0);
        assert.equal(fs.readFileSync(secret, 'utf8'), 'secret-body');
        assert.equal(fs.lstatSync(requests).isSymbolicLink(), true);

        fs.rmSync(requests);
        fs.mkdirSync(requests);
        write(outsideFile, 'outside-body');
        age(outsideFile, now - ARTIFACT_MAX_AGE_MS - 1);
        fs.symlinkSync(outsideFile, linkedFile);
        assert.equal(cleanupInspectorArtifacts(outputDir, root, now), 0);
        assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'outside-body');
        assert.equal(fs.lstatSync(linkedFile).isSymbolicLink(), true);
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

test('cleanup is a no-op when there is no requests directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-cleanup-empty-'));
    try {
        assert.equal(cleanupInspectorArtifacts(path.join(root, '.intent-inspector'), root), 0);
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
