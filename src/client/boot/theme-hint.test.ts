import assert from 'node:assert/strict';
import test from 'node:test';
import { logThemeHintAfterLoad, themeHintArgs } from './theme-hint.js';

/**
 * Minimal window stand-in: a document ready state plus a recorded `load` listener that the test fires by hand.
 * @param {DocumentReadyState} readyState State to report. @returns {{ win: any, fireLoad: () => void }} Fake window.
 */
function fakeWindow(readyState: string) {
    let onLoad: (() => void) | null = null;
    const win = {
        document: { readyState },
        addEventListener(type: string, listener: () => void) {
            if (type === 'load')
                onLoad = listener;
        },
    };
    return { win, fireLoad: () => onLoad?.() };
}

test('themeHintArgs styles a badge and the message with two %c directives', () => {
    const [format, badge, message] = themeHintArgs('hello');
    assert.equal(format, '%cide-byebye%c hello');
    assert.match(badge, /linear-gradient/);
    assert.match(message, /color:/);
});

test('logThemeHintAfterLoad waits for the load event', (context) => {
    const info = context.mock.method(console, 'info', () => {});
    const { win, fireLoad } = fakeWindow('interactive');
    logThemeHintAfterLoad(win);
    assert.equal(info.mock.callCount(), 0);
    fireLoad();
    assert.equal(info.mock.callCount(), 1);
    const [format] = info.mock.calls[0].arguments;
    assert.match(format, /theme/);
    assert.match(format, /'light' \| 'auto' \| 'dark'/);
});

test('logThemeHintAfterLoad logs at once when the page has already loaded', (context) => {
    const info = context.mock.method(console, 'info', () => {});
    logThemeHintAfterLoad(fakeWindow('complete').win);
    assert.equal(info.mock.callCount(), 1);
});
