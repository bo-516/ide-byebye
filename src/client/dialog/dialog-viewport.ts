import { clamp } from './dialog-utils.js';
import type { DialogAnchor, DialogBox } from './dialog-types.js';

/**
 * Viewport placement math for the intent dialog.
 *
 * Purpose: pure functions over the measured `DialogBox` so `Dialog`'s thin methods (which tests bind
 * through `Dialog.prototype`) share one implementation and this file stays logic-verifiable in Node.
 *
 * Boundary: no state, no DOM writes beyond the passed box's inline `style`. All measurements come
 * from `getBoundingClientRect` on the argument — callers pass a live, attached dialog element.
 */

/**
 * Place the dialog beside the click, or center it when there is no anchor.
 *
 * Boundary: top and left are derived from the dialog's current height, so calling this again after the content
 * grows moves the box. Later content changes go through {@link keepBoxInView}. `dialog` must already be in the
 * document; a detached node reports an empty box and is positioned as if it had no size.
 *
 * @param {DialogBox} dialog Dialog element to position. Must already be in the document for a real size.
 * @param {DialogAnchor | null} anchor Viewport click point. Null centers the dialog.
 * @returns {void}
 */
export function placeDialog(dialog: DialogBox, anchor: DialogAnchor | null) {
    const margin = 12;
    const offset = 14;
    const rect = dialog.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const maxX = Math.max(margin, window.innerWidth - width - margin);
    const maxY = Math.max(margin, window.innerHeight - height - margin);
    let x = Math.round((window.innerWidth - width) / 2);
    let y = Math.round((window.innerHeight - height) / 2);
    if (anchor) {
        const rightX = anchor.x + offset;
        const leftX = anchor.x - width - offset;
        const bottomY = anchor.y + offset;
        const topY = anchor.y - height - offset;
        x = rightX <= maxX || leftX < margin ? rightX : leftX;
        y = bottomY <= maxY || topY < margin ? bottomY : topY;
    }
    dialog.style.left = `${clamp(Math.round(x), margin, maxX)}px`;
    dialog.style.top = `${clamp(Math.round(y), margin, maxY)}px`;
}

/**
 * Keep a positioned dialog fully inside the viewport without moving it unless a size change pushed it out of bounds.
 *
 * Boundary: reads the dialog's current top/left (its `style` coordinates equal viewport coordinates because the
 * shadow host is a `position: fixed; inset: 0` box) and only pulls it back when its right/bottom edge would cross the
 * margin {@link placeDialog} uses. Growing content therefore expands the box in place — the top stays put — until
 * it reaches the viewport edge, instead of the box hopping to a freshly re-anchored spot on each change.
 * @param {DialogBox} dialog Positioned dialog element.
 * @returns {void}
 */
export function keepBoxInView(dialog: DialogBox) {
    const margin = 12;
    const rect = dialog.getBoundingClientRect();
    const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxY = Math.max(margin, window.innerHeight - rect.height - margin);
    dialog.style.left = `${clamp(Math.round(rect.left), margin, maxX)}px`;
    dialog.style.top = `${clamp(Math.round(rect.top), margin, maxY)}px`;
}
