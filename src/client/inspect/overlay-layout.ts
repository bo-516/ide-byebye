/**
 * Pure geometry and text helpers for the hover highlight in `overlay.ts`.
 *
 * Purpose: keep label placement and label text testable without a DOM. `Overlay` measures the page element and its own
 * label, then asks these helpers where the label goes and what it says.
 * Boundary: no DOM and no `window` — every viewport fact arrives as an argument, so the same inputs always place the
 * label at the same spot.
 */

/**
 * Gap in px between the highlight box and its floating label; also the label's inset when it has to sit inside the box.
 * @type {number}
 */
export const LABEL_GAP = 4;

/**
 * Minimum distance in px the label keeps from every viewport edge, so its shadow is never cut off.
 * @type {number}
 */
export const VIEWPORT_MARGIN = 4;

/** Viewport rect of the highlighted element, as `getBoundingClientRect()` reports it. */
export interface BoxRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** Width and height in px (the measured label, or the viewport). */
export interface Size {
    width: number;
    height: number;
}

/** Viewport position in px for the label's top-left corner. */
export interface LabelPoint {
    left: number;
    top: number;
}

/**
 * Clamp `value` into `[min, max]`; a range whose `max` is below `min` resolves to `min`.
 *
 * @param {number} value Candidate. @param {number} min Lower bound. @param {number} max Upper bound.
 * @returns {number} The clamped value.
 */
function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, max));
}

/**
 * Horizontal position: start-aligned with the box, or end-aligned when a start-aligned label would run off the right
 * edge, then clamped into the viewport.
 *
 * @param {number} start Preferred left edge (box left, or box left plus an inset).
 * @param {number} end Right edge to align to when the start would overflow.
 * @param {number} width Measured label width.
 * @param {number} viewportWidth Viewport width.
 * @returns {number} Label left in px.
 */
function labelLeft(start: number, end: number, width: number, viewportWidth: number): number {
    const max = viewportWidth - width - VIEWPORT_MARGIN;
    const preferred = start > max ? end - width : start;
    return clamp(preferred, VIEWPORT_MARGIN, max);
}

/**
 * Where the floating label goes for a highlighted box.
 *
 * Purpose: above the box's top-left corner (like a design tool's selection tag); below its bottom when there is no
 * room above; inside its top-left corner when the box covers the viewport height (`<body>`, full-page wrappers).
 * A box near the right edge gets an end-aligned label so the tag still lines up with one of the box's edges.
 * Boundary: the label never leaves the viewport while it fits; a label wider than the viewport pins to the left margin
 * (CSS caps its width). Wrong `label` sizes (e.g. read while hidden, 0×0) still return a point, just a cramped one.
 *
 * @param {BoxRect} box Element rect in viewport px.
 * @param {Size} label Measured label size.
 * @param {Size} viewport `innerWidth` / `innerHeight`.
 * @returns {LabelPoint} Top-left corner for the label in viewport px.
 */
export function placeLabel(box: BoxRect, label: Size, viewport: Size): LabelPoint {
    const above = box.top - LABEL_GAP - label.height;
    const below = box.bottom + LABEL_GAP;
    const left = labelLeft(box.left, box.right, label.width, viewport.width);
    if (above >= VIEWPORT_MARGIN)
        return { left, top: above };
    if (below + label.height <= viewport.height - VIEWPORT_MARGIN)
        return { left, top: below };
    return {
        left: labelLeft(Math.max(box.left, 0) + LABEL_GAP, box.right - LABEL_GAP, label.width, viewport.width),
        top: Math.max(box.top, 0) + LABEL_GAP,
    };
}

/**
 * Line / column suffix for the label's file name.
 *
 * @param {number} [line] 1-based line. Omitted yields `''` (the column is ignored without a line).
 * @param {number} [column] Column. Omitted yields just `:line`.
 * @returns {string} `:99:9`, `:99`, or `''`.
 */
export function formatLineColumn(line?: number, column?: number): string {
    if (line == null)
        return '';
    return column == null ? `:${line}` : `:${line}:${column}`;
}

/**
 * Rendered size readout, rounded to whole CSS px like the browser's own inspector tooltip.
 *
 * @param {number} width Box width. @param {number} height Box height.
 * @returns {string} e.g. `1924 × 1120` (narrow no-break spaces keep it on one line).
 */
export function formatBoxSize(width: number, height: number): string {
    return `${Math.round(width)} × ${Math.round(height)}`;
}
