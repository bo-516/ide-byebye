import assert from 'node:assert/strict';
import test from 'node:test';
import { splitMentionLabel } from './dialog-mention-label.js';

test('splitMentionLabel separates directory, file name and line range', () => {
    assert.deepEqual(splitMentionLabel('@react/src/App.jsx #99-104'), { dir: 'react/src/', file: 'App.jsx', lines: 'L99–104' });
});

test('splitMentionLabel keeps a single line and a directory-less fallback label', () => {
    assert.deepEqual(splitMentionLabel('@App.jsx #42'), { dir: '', file: 'App.jsx', lines: 'L42' });
    assert.deepEqual(splitMentionLabel('@src/a.ts #7-7'), { dir: 'src/', file: 'a.ts', lines: 'L7' });
});

test('splitMentionLabel treats labels without a trailing range as a plain path', () => {
    assert.deepEqual(splitMentionLabel('Code 1'), { dir: '', file: 'Code 1', lines: '' });
    assert.deepEqual(splitMentionLabel('@src/#tmp/App.jsx'), { dir: 'src/#tmp/', file: 'App.jsx', lines: '' });
    assert.deepEqual(splitMentionLabel('@src/App.jsx #L9'), { dir: 'src/', file: 'App.jsx #L9', lines: '' });
});

test('splitMentionLabel does not split on a leading or trailing separator and accepts backslashes', () => {
    assert.deepEqual(splitMentionLabel('@src/'), { dir: '', file: 'src/', lines: '' });
    assert.deepEqual(splitMentionLabel('/App.jsx #3'), { dir: '', file: '/App.jsx', lines: 'L3' });
    assert.deepEqual(splitMentionLabel('@src\\App.tsx #3-5'), { dir: 'src\\', file: 'App.tsx', lines: 'L3–5' });
});

test('splitMentionLabel returns empty parts for a missing label', () => {
    assert.deepEqual(splitMentionLabel(undefined), { dir: '', file: '', lines: '' });
    assert.deepEqual(splitMentionLabel('   '), { dir: '', file: '', lines: '' });
});
