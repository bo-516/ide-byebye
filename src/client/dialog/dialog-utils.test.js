import assert from 'node:assert/strict';
import test from 'node:test';
import { computeDropdownPlacement } from './dialog-utils.js';

const GAP = 8;
const MARGIN = 8;
const MIN_HEIGHT = 140;

/**
 * Build a placement input for a trigger button at the given viewport position, with the wrapper coincident with the
 * button (the real controllers wrap only the button, so its rect equals the trigger's).
 */
function makeInput({ buttonLeft, buttonTop, buttonW = 36, buttonH = 36, panelWidth, panelHeight, vw = 1200, vh = 800 }) {
    const anchor = { left: buttonLeft, right: buttonLeft + buttonW, top: buttonTop, bottom: buttonTop + buttonH };
    return {
        anchor,
        wrap: { top: anchor.top, bottom: anchor.bottom, left: anchor.left },
        panelHeight, panelWidth,
        viewportWidth: vw, viewportHeight: vh,
        gap: GAP, margin: MARGIN, minHeight: MIN_HEIGHT,
    };
}

/**
 * Reconstruct the panel's on-screen (viewport) rect from the wrapper-relative placement, so tests can assert where the
 * panel actually lands. Mirrors how the browser resolves the inline `top`/`bottom`/`left` against the offset parent.
 */
function panelRect(input, placement) {
    const effHeight = placement.maxHeight != null ? placement.maxHeight : input.panelHeight;
    const leftVp = input.wrap.left + placement.left;
    let topVp;
    if (placement.openDown)
        topVp = input.wrap.top + placement.top; // resolves to anchor.bottom + gap
    else
        topVp = (input.wrap.bottom - placement.bottom) - effHeight; // bottom edge is anchor.top - gap
    return { left: leftVp, right: leftVp + input.panelWidth, top: topVp, bottom: topVp + effHeight };
}

/** Assert the panel rect sits fully within the viewport, honouring the intended edge margin. */
function assertInsideViewport(input, rect) {
    const e = 0.5;
    assert.ok(rect.left >= MARGIN - e, `left ${rect.left} >= ${MARGIN}`);
    assert.ok(rect.top >= MARGIN - e, `top ${rect.top} >= ${MARGIN}`);
    assert.ok(rect.right <= input.viewportWidth - MARGIN + e, `right ${rect.right} <= ${input.viewportWidth - MARGIN}`);
    assert.ok(rect.bottom <= input.viewportHeight - MARGIN + e, `bottom ${rect.bottom} <= ${input.viewportHeight - MARGIN}`);
}

test('opens upward without clamping when there is ample room above', () => {
    const input = makeInput({ buttonLeft: 582, buttonTop: 600, panelWidth: 340, panelHeight: 440 });
    const placement = computeDropdownPlacement(input);
    assert.equal(placement.openDown, false);
    assert.equal(placement.maxHeight, null);
    assert.equal(placement.top, null); // only the bottom edge is pinned when opening up
    assertInsideViewport(input, panelRect(input, placement));
});

test('flips downward when the room above cannot hold the panel and below is larger', () => {
    const input = makeInput({ buttonLeft: 582, buttonTop: 120, panelWidth: 340, panelHeight: 440 });
    const placement = computeDropdownPlacement(input);
    assert.equal(placement.openDown, true);
    assert.equal(placement.maxHeight, null); // 636px below fits the 440px panel, no clamp needed
    assert.equal(placement.bottom, null); // only the top edge is pinned when opening down
    assertInsideViewport(input, panelRect(input, placement));
});

test('flips downward AND clamps height when below is larger but still too short', () => {
    const input = makeInput({ buttonLeft: 582, buttonTop: 120, panelWidth: 340, panelHeight: 440, vh: 500 });
    const placement = computeDropdownPlacement(input);
    assert.equal(placement.openDown, true);
    // spaceBelow = 500 - 156 - 8 = 336; usable = 336 - gap = 328 < 440 → clamp to 328.
    assert.equal(placement.maxHeight, 328);
    assertInsideViewport(input, panelRect(input, placement));
});

test('stays upward and clamps when above is cramped but still the larger side', () => {
    // Button low in a short viewport: little room below, so it keeps opening up and clamps to the space above.
    const input = makeInput({ buttonLeft: 582, buttonTop: 430, panelWidth: 340, panelHeight: 440, vh: 500 });
    const placement = computeDropdownPlacement(input);
    assert.equal(placement.openDown, false);
    // spaceAbove = 430 - 8 = 422; usable = 422 - gap = 414 < 440 → clamp to 414.
    assert.equal(placement.maxHeight, 414);
    assertInsideViewport(input, panelRect(input, placement));
});

test('clamps a wide panel against the left rail so it cannot run off-screen', () => {
    const input = makeInput({ buttonLeft: 8, buttonTop: 600, panelWidth: 340, panelHeight: 200 });
    const placement = computeDropdownPlacement(input);
    const rect = panelRect(input, placement);
    assert.equal(rect.left, MARGIN); // pinned to the left margin instead of extending negative
    assertInsideViewport(input, rect);
});

test('keeps a panel right-aligned to a trigger against the right rail', () => {
    const input = makeInput({ buttonLeft: 1156, buttonTop: 600, panelWidth: 340, panelHeight: 200 }); // right edge at 1192 = vw - 8
    const placement = computeDropdownPlacement(input);
    const rect = panelRect(input, placement);
    assert.equal(rect.right, input.viewportWidth - MARGIN);
    assertInsideViewport(input, rect);
});

test('the reported case — trigger high in the viewport — never clips the panel off the top', () => {
    // A tall style panel (max 440) with the dialog footer sitting near the top, the exact failure the fix targets.
    for (const buttonTop of [0, 20, 60, 120, 200, 300]) {
        const input = makeInput({ buttonLeft: 582, buttonTop, panelWidth: 340, panelHeight: 440 });
        const rect = panelRect(input, computeDropdownPlacement(input));
        assertInsideViewport(input, rect);
    }
});

test('a short menu (screenshot/scope picker) stays put and unclamped mid-viewport', () => {
    const input = makeInput({ buttonLeft: 500, buttonTop: 400, panelWidth: 192, panelHeight: 176 });
    const placement = computeDropdownPlacement(input);
    assert.equal(placement.openDown, false);
    assert.equal(placement.maxHeight, null);
    assertInsideViewport(input, panelRect(input, placement));
});

test('sweeps every corner and edge and keeps the panel inside the viewport', () => {
    const vw = 1000, vh = 700;
    for (const panelHeight of [176, 300, 440]) {
        for (const buttonTop of [0, 30, 120, 350, vh - 80, vh - 36]) {
            for (const buttonLeft of [0, 8, vw / 2, vw - 44, vw - 36]) {
                const input = makeInput({ buttonLeft, buttonTop, panelWidth: 340, panelHeight, vw, vh });
                const rect = panelRect(input, computeDropdownPlacement(input));
                assertInsideViewport(input, rect);
            }
        }
    }
});
