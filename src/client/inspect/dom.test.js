import assert from 'node:assert/strict';
import test from 'node:test';
import { promoteToOuterSameSizeElement } from './dom.js';
import { INSP_PATH_ATTR } from '../../shared/constants.js';

// The promotion walk reads border widths through the browser-global `getComputedStyle`; node has none, so route it to
// the mock element's declared borders. Each test file runs in its own process, so the global never leaks elsewhere.
globalThis.getComputedStyle = (el) => el.__computedStyle;

/**
 * Minimal element stand-in: the promotion walk only touches `parentElement`, `getBoundingClientRect()`,
 * `getAttribute(INSP_PATH_ATTR)` and computed border widths, so plain objects can model a wrapper chain without a DOM
 * environment. `border` is the wrapper's own border width on every edge.
 */
function makeEl({ left = 0, top = 0, width = 100, height = 50, border = 0, inspPath = null, parent = null }) {
    return {
        parentElement: parent,
        getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height }),
        getAttribute: (name) => (name === INSP_PATH_ATTR ? inspPath : null),
        __computedStyle: {
            borderTopWidth: `${border}px`,
            borderRightWidth: `${border}px`,
            borderBottomWidth: `${border}px`,
            borderLeftWidth: `${border}px`,
        },
    };
}

/**
 * Build a chain from the outermost box inward; every wrapper has `border` px of border on each edge and its child
 * exactly fills the inside-border area. Returns the innermost element.
 */
function makeChain(levels, { border = 1, size = 100 } = {}) {
    let parent = null;
    const chain = [];
    for (let i = 0; i < levels; i += 1) {
        const inset = i * border;
        parent = makeEl({
            left: inset,
            top: inset,
            width: size - inset * 2,
            height: size - inset * 2,
            border,
            inspPath: `src/App.jsx:${i + 1}:1`,
            parent,
        });
        chain.push(parent);
    }
    return chain[chain.length - 1];
}

test('promotes to a parent whose border is the only thing around the child, whatever its width', () => {
    const parent = makeEl({ left: 0, top: 0, width: 116, height: 66, border: 8, inspPath: 'src/App.jsx:1:1' });
    const child = makeEl({ left: 8, top: 8, width: 100, height: 50, inspPath: 'src/App.jsx:2:3', parent });
    assert.equal(promoteToOuterSameSizeElement(child), parent);
});

test('promotes through a borderless wrapper occupying the exact same box', () => {
    const parent = makeEl({ left: 0, top: 0, width: 100, height: 50, inspPath: 'src/App.jsx:1:1' });
    const child = makeEl({ left: 0, top: 0, width: 100, height: 50, inspPath: 'src/App.jsx:2:3', parent });
    assert.equal(promoteToOuterSameSizeElement(child), parent);
});

test('does not promote when the gap is padding, not border — even a 1px one', () => {
    // Old tolerance-based logic would have absorbed this 1px gap; border-aware comparison must not.
    const parent = makeEl({ left: 0, top: 0, width: 102, height: 52, border: 0, inspPath: 'src/App.jsx:1:1' });
    const child = makeEl({ left: 1, top: 1, width: 100, height: 50, inspPath: 'src/App.jsx:2:3', parent });
    assert.equal(promoteToOuterSameSizeElement(child), child);
});

test('does not promote when the parent has border AND padding', () => {
    // 2px border + 2px padding: inside-border area is still 2px larger than the child on every edge.
    const parent = makeEl({ left: 0, top: 0, width: 108, height: 58, border: 2, inspPath: 'src/App.jsx:1:1' });
    const child = makeEl({ left: 4, top: 4, width: 100, height: 50, inspPath: 'src/App.jsx:2:3', parent });
    assert.equal(promoteToOuterSameSizeElement(child), child);
});

test('absorbs sub-pixel layout rounding', () => {
    const parent = makeEl({ left: 0, top: 0, width: 102.4, height: 52.4, border: 1.2, inspPath: 'src/App.jsx:1:1' });
    const child = makeEl({ left: 1.2, top: 1.2, width: 100.3, height: 50.3, inspPath: 'src/App.jsx:2:3', parent });
    assert.equal(promoteToOuterSameSizeElement(child), parent);
});

test('promotes through a chain of border-only wrappers to the outermost one', () => {
    const inner = makeChain(4);
    let outermost = inner;
    while (outermost.parentElement) outermost = outermost.parentElement;
    assert.equal(promoteToOuterSameSizeElement(inner), outermost);
});

test('caps the climb at 5 ancestor levels', () => {
    const inner = makeChain(8); // 7 border-only ancestors above the innermost
    let expected = inner;
    for (let i = 0; i < 5; i += 1) expected = expected.parentElement;
    assert.equal(promoteToOuterSameSizeElement(inner), expected);
});

test('does not promote when the parent box is visibly larger', () => {
    const parent = makeEl({ left: 0, top: 0, width: 300, height: 200, inspPath: 'src/App.jsx:1:1' });
    const child = makeEl({ left: 20, top: 20, width: 100, height: 50, inspPath: 'src/App.jsx:2:3', parent });
    assert.equal(promoteToOuterSameSizeElement(child), child);
});

test('climbs through an unmapped border-only wrapper but only returns mapped ancestors', () => {
    const grandparent = makeEl({ left: 0, top: 0, width: 104, height: 54, border: 1, inspPath: 'src/App.jsx:1:1' });
    const unmapped = makeEl({ left: 1, top: 1, width: 102, height: 52, border: 1, inspPath: null, parent: grandparent });
    const child = makeEl({ left: 2, top: 2, width: 100, height: 50, inspPath: 'src/App.jsx:2:3', parent: unmapped });
    assert.equal(promoteToOuterSameSizeElement(child), grandparent);
});

test('keeps the picked element when same-size ancestors carry no insp-path at all', () => {
    const unmappedOuter = makeEl({ left: 0, top: 0, width: 102, height: 52, border: 1, inspPath: null });
    const child = makeEl({ left: 1, top: 1, width: 100, height: 50, inspPath: 'src/App.jsx:2:3', parent: unmappedOuter });
    assert.equal(promoteToOuterSameSizeElement(child), child);
});

test('never promotes a zero-size element', () => {
    const parent = makeEl({ left: 0, top: 0, width: 0, height: 0, inspPath: 'src/App.jsx:1:1' });
    const child = makeEl({ left: 0, top: 0, width: 0, height: 0, inspPath: 'src/App.jsx:2:3', parent });
    assert.equal(promoteToOuterSameSizeElement(child), child);
});

test('stops climbing once a level breaks the chain, even if higher levels match again', () => {
    // grandparent matches the CHILD's box, but the middle parent is a wide row — the visual chain is broken there.
    const grandparent = makeEl({ left: 1, top: 1, width: 100, height: 50, inspPath: 'src/App.jsx:1:1' });
    const wideParent = makeEl({ left: 0, top: 0, width: 400, height: 52, inspPath: 'src/App.jsx:2:1', parent: grandparent });
    const child = makeEl({ left: 1, top: 1, width: 100, height: 50, inspPath: 'src/App.jsx:3:3', parent: wideParent });
    assert.equal(promoteToOuterSameSizeElement(child), child);
});
