import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveRecordingPayloads } from './screenshot.js';
import { buildPromptReferenceLines } from './prompt.js';
import { buildPromptMarkdownReferenceLines } from './prompt-markdown.js';

// 1x1 transparent PNG used as a stand-in still frame data URL.
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const SAMPLE_EVENTS = [
    { type: 4, data: { href: 'http://localhost/', width: 800, height: 600 }, timestamp: 1000 },
    { type: 2, data: { node: {} }, timestamp: 1001 },
    { type: 3, data: { source: 2 }, timestamp: 1500 },
];

test('saveRecordingPayloads writes the event stream and still, returning correlated paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-rec-'));
    const outputDir = path.join(root, '.intent-inspector');
    const saved = saveRecordingPayloads([
        {
            scope: 'recording',
            events: SAMPLE_EVENTS,
            clip: { t0: 0, t1: 500 },
            durationMs: 500,
            stillFrame: { dataUrl: PNG_DATA_URL, width: 800, height: 600 },
            capturedAt: '2026-06-30T00:00:00.000Z',
        },
    ], { projectRoot: root }, outputDir);

    assert.equal(saved.length, 1);
    const entry = saved[0];
    assert.ok(entry.eventsPath.endsWith('.rrweb.json'), 'event stream uses .rrweb.json');
    assert.ok(entry.stillFramePath && entry.stillFramePath.endsWith('.png'), 'still uses image extension');
    assert.ok(fs.existsSync(entry.eventsPath), 'event file written to disk');
    assert.ok(fs.existsSync(entry.stillFramePath), 'still file written to disk');
    // events and still share the same random id stem for easy correlation
    const eventsId = path.basename(entry.eventsPath).replace(/\.rrweb\.json$/, '');
    const stillId = path.basename(entry.stillFramePath).replace(/\.png$/, '');
    assert.equal(eventsId, stillId);
    const persisted = JSON.parse(fs.readFileSync(entry.eventsPath, 'utf8'));
    assert.equal(persisted.length, SAMPLE_EVENTS.length);
    assert.deepEqual(entry.clip, { t0: 0, t1: 500 });

    fs.rmSync(root, { recursive: true, force: true });
});

test('saveRecordingPayloads returns undefined when there are no recordings', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cii-rec-'));
    const outputDir = path.join(root, '.intent-inspector');
    assert.equal(saveRecordingPayloads(undefined, { projectRoot: root }, outputDir), undefined);
    assert.equal(saveRecordingPayloads([], { projectRoot: root }, outputDir), undefined);
    fs.rmSync(root, { recursive: true, force: true });
});

test('prompt references include the recording still frame but never the event JSON', () => {
    const request = {
        projectRoot: '/tmp/project',
        recordings: [
            {
                scope: 'recording',
                eventsPath: '/tmp/project/.intent-inspector/recordings/abc1234.rrweb.json',
                stillFramePath: '/tmp/project/.intent-inspector/recordings/abc1234.webp',
                clip: { t0: 0, t1: 500 },
            },
        ],
    };

    const plain = buildPromptReferenceLines(request);
    assert.deepEqual(plain, ['@.intent-inspector/recordings/abc1234.webp']);
    assert.ok(!plain.some((ref) => ref.includes('.rrweb.json')), 'plain prompt never references the event JSON');

    const markdown = buildPromptMarkdownReferenceLines(request);
    assert.deepEqual(markdown, [
        '[.intent-inspector/recordings/abc1234.webp](.intent-inspector/recordings/abc1234.webp)',
    ]);
    assert.ok(!markdown.some((ref) => ref.includes('.rrweb.json')), 'markdown prompt never references the event JSON');
});
