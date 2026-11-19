import assert from 'node:assert/strict';
import test from 'node:test';
import {
    estimateDataUrlChars,
    isRichTextClipboard,
    PASTED_IMAGE_MAX_DATA_URL_CHARS,
    PASTED_IMAGE_MAX_EDGE,
    pickClipboardImages,
    planPastedImageEncoding,
} from './pasted-image-rules.js';

/** Minimal stand-in for a pasted `File`. */
type FakeFile = { type: string; name: string };

/**
 * Build a `clipboardData`-like object.
 *
 * @param {{ files?: FakeFile[], itemFiles?: FakeFile[], strings?: Record<string, string> }} parts Clipboard contents.
 * @returns {object} Object shaped like the parts of `DataTransfer` the rules read.
 */
function clipboard(parts: { files?: FakeFile[]; itemFiles?: FakeFile[]; strings?: Record<string, string> }) {
    const strings = parts.strings ?? {};
    const items = [
        ...Object.keys(strings).map((type) => ({ kind: 'string', type, getAsFile: () => null })),
        ...(parts.itemFiles ?? []).map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    ];
    return {
        items,
        files: parts.files ?? parts.itemFiles ?? [],
        getData: (format: string) => strings[format] ?? '',
    };
}

const png = { type: 'image/png', name: 'image.png' };
const jpeg = { type: 'image/jpeg', name: 'photo.jpg' };
const pdf = { type: 'application/pdf', name: 'doc.pdf' };

test('a screenshot on the clipboard attaches', () => {
    assert.deepEqual(pickClipboardImages(clipboard({ itemFiles: [png] })), [png]);
});

test('a browser "Copy image" (html is just an <img>) attaches the image', () => {
    const data = clipboard({
        itemFiles: [png],
        strings: { 'text/html': '<meta charset=\'utf-8\'><img src="https://example.com/a.png" alt="A chart">' },
    });
    assert.deepEqual(pickClipboardImages(data), [png]);
});

test('spreadsheet / document copies with a rendered picture stay text', () => {
    const data = clipboard({
        itemFiles: [png],
        strings: {
            'text/plain': 'Q1\t120',
            'text/html': '<html><head><style>td { color: red }</style></head><body><table><tr><td>Q1</td><td>120</td></tr></table></body></html>',
        },
    });
    assert.deepEqual(pickClipboardImages(data), []);
});

test('rich html without plain text still attaches the image', () => {
    const data = clipboard({ itemFiles: [png], strings: { 'text/html': '<p>caption</p>' } });
    assert.deepEqual(pickClipboardImages(data), [png]);
});

test('a Finder copy of image files attaches them and skips other files', () => {
    const data = clipboard({ itemFiles: [png, pdf, jpeg], strings: { 'text/plain': 'image.png' } });
    assert.deepEqual(pickClipboardImages(data), [png, jpeg]);
});

test('files are the fallback when items carry no image', () => {
    const data = { items: [], files: [pdf, jpeg], getData: () => '' };
    assert.deepEqual(pickClipboardImages(data), [jpeg]);
});

test('plain text and missing clipboard data attach nothing', () => {
    assert.deepEqual(pickClipboardImages(clipboard({ strings: { 'text/plain': 'hello' } })), []);
    assert.deepEqual(pickClipboardImages(null), []);
    assert.deepEqual(pickClipboardImages(undefined), []);
});

test('isRichTextClipboard ignores markup, comments, styles and non-breaking spaces', () => {
    assert.equal(isRichTextClipboard(''), false);
    assert.equal(isRichTextClipboard(null), false);
    assert.equal(isRichTextClipboard('<!-- StartFragment --><img src="x"><!-- EndFragment -->'), false);
    assert.equal(isRichTextClipboard('<style>p { margin: 0 }</style><span>&nbsp;</span>'), false);
    assert.equal(isRichTextClipboard('<b>bold</b>'), true);
});

test('planPastedImageEncoding keeps small PNG / JPEG / WebP files as-is', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
        assert.deepEqual(planPastedImageEncoding({ type, bytes: 200_000, width: 1280, height: 800 }), { keepOriginal: true, scale: 1 });
    }
});

test('planPastedImageEncoding re-encodes formats the server cannot store', () => {
    for (const type of ['image/gif', 'image/bmp', 'image/svg+xml', 'image/PNG', '']) {
        assert.equal(planPastedImageEncoding({ type, bytes: 1000, width: 10, height: 10 }).keepOriginal, false, type);
    }
});

test('planPastedImageEncoding scales the long edge down to the limit', () => {
    const plan = planPastedImageEncoding({ type: 'image/png', bytes: 500_000, width: PASTED_IMAGE_MAX_EDGE * 2, height: 900 });
    assert.deepEqual(plan, { keepOriginal: false, scale: 0.5 });
    const edge = planPastedImageEncoding({ type: 'image/png', bytes: 500_000, width: 900, height: PASTED_IMAGE_MAX_EDGE });
    assert.deepEqual(edge, { keepOriginal: true, scale: 1 });
});

test('planPastedImageEncoding re-encodes at full size when only the bytes are over the cap', () => {
    const maxBytes = Math.floor((PASTED_IMAGE_MAX_DATA_URL_CHARS - 32) / 4) * 3;
    assert.equal(estimateDataUrlChars(maxBytes) <= PASTED_IMAGE_MAX_DATA_URL_CHARS, true);
    assert.deepEqual(planPastedImageEncoding({ type: 'image/png', bytes: maxBytes, width: 100, height: 100 }), { keepOriginal: true, scale: 1 });
    assert.deepEqual(planPastedImageEncoding({ type: 'image/png', bytes: maxBytes + 3, width: 100, height: 100 }), { keepOriginal: false, scale: 1 });
});
