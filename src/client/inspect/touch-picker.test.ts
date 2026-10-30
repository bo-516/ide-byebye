import assert from 'node:assert/strict';
import test from 'node:test';
import { pageElementAt } from './touch-picker.js';

/** Node has no DOM; `pageElementAt` only needs `instanceof HTMLElement`, `closest` and `parentElement`. */
class FakeHTMLElement {
    parentElement: unknown = null;
    closest() {
        return null;
    }
}
(globalThis as Record<string, unknown>).HTMLElement = FakeHTMLElement;

/** Plugin host as `document.elementsFromPoint` reports it: shadow content is retargeted to the host. */
const pluginHost = { closest: () => ({}), parentElement: null };

function hitTester(hits: unknown[]) {
    return { elementsFromPoint: () => hits as Element[] };
}

test('pageElementAt looks through the plugin glass to the page element under the finger', () => {
    const button = new FakeHTMLElement();
    const body = new FakeHTMLElement();
    assert.equal(pageElementAt(10, 10, hitTester([pluginHost, button, body])), button);
});

test('pageElementAt resolves an SVG glyph to the HTML element that holds it', () => {
    const button = new FakeHTMLElement();
    const svg = { closest: () => null, parentElement: button };
    const path = { closest: () => null, parentElement: svg };
    assert.equal(pageElementAt(10, 10, hitTester([pluginHost, path, svg, button])), button);
});

test('pageElementAt returns null when only plugin UI or nothing is under the point', () => {
    assert.equal(pageElementAt(10, 10, hitTester([pluginHost, pluginHost])), null);
    assert.equal(pageElementAt(10, 10, hitTester([])), null);
});
