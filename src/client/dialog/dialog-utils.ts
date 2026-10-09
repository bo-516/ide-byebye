import { basename, parseInspPathLite } from '../inspect/insp-path-lite.js';
import { t } from '../lib/i18n.js';

/**
 * DOM and geometry helpers shared by the dialog and its controllers.
 *
 * Boundary: the agent catalog and preference storage moved to `dialog-agents.ts` / `dialog-prefs.ts`;
 * they are re-exported at the bottom so existing `dialog-utils.js` importers keep working.
 */

export * from './dialog-agents.js';
export * from './dialog-prefs.js';

/** Spacing overrides for dropdown placement, in pixels. Omitted fields use the same defaults as the callers. */
interface DropdownSpacing {
    gap?: number;
    margin?: number;
    minHeight?: number;
}

/**
 * Viewport measurements for {@link computeDropdownPlacement}. Numbers are CSS pixels. `anchor` is the trigger's
 * border box and `wrap` is the panel's offset parent, both as `getBoundingClientRect` reports them.
 */
interface DropdownPlacementInput {
    anchor: { top: number; bottom: number; left: number; right: number };
    wrap: { top: number; bottom: number; left: number };
    panelHeight: number;
    panelWidth: number;
    viewportWidth: number;
    viewportHeight: number;
    gap: number;
    margin: number;
    minHeight: number;
}

/**
 * Create a DOM node for the shadow-root dialog UI.
 *
 * Boundary: `tag` must be a valid HTML tag name; passing untrusted text is safe because it is assigned through
 * `textContent`, while callers that need rich children must append nodes themselves. The literal-tag overload
 * resolves through `HTMLElementTagNameMap`, so `el('button')` already types `type`/`disabled` without a cast;
 * a computed `string` tag falls back to plain `HTMLElement`.
 *
 * @param {string} tag HTML tag name to create.
 * @param {string | undefined} className Optional class string assigned directly to the element.
 * @param {string | undefined} text Optional plain text content.
 * @returns {HTMLElement} Created element ready for caller-specific attributes and listeners.
 */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string | null): HTMLElementTagNameMap[K];
export function el(tag: string, className?: string, text?: string | null): HTMLElement;
export function el(tag: string, className?: string, text?: string | null): HTMLElement {
    const node = document.createElement(tag);
    if (className)
        node.className = className;
    if (text != null)
        node.textContent = text;
    return node;
}

/**
 * Resolve a screen anchor from the selected page element.
 *
 * Boundary: missing or detached elements return null, which makes the dialog center itself. The returned point is in
 * viewport coordinates and should be consumed before layout changes move the element.
 *
 * @param {Element | null | undefined} element Element used to position the dialog near the user's click. Nullish centers the dialog.
 * @returns {{ x: number, y: number } | null} Center point for dialog placement.
 */
export function anchorFromElement(element: Element | null | undefined): { x: number; y: number } | null {
    if (!element)
        return null;
    const rect = element.getBoundingClientRect();
    return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
    };
}

/**
 * Clamp a number into an inclusive range.
 *
 * Boundary: when `max` is less than `min`, the minimum is returned so callers can handle cramped viewports without
 * producing NaN or inverted coordinates.
 *
 * @param {number} value Proposed value.
 * @param {number} min Inclusive lower bound.
 * @param {number} max Inclusive upper bound.
 * @returns {number} Clamped value.
 */
export function clamp(value: number, min: number, max: number): number {
    if (max < min)
        return min;
    return Math.min(Math.max(value, min), max);
}

/**
 * Decide where an absolutely-placed dropdown panel should sit so it stays fully inside the viewport.
 *
 * Boundary: this is the pure geometry behind {@link placeDropdownPanel}, split out so it can be unit-tested without a
 * DOM. All inputs are in viewport coordinates (as {@link Element.getBoundingClientRect} returns); the returned edge
 * offsets are wrapper-relative (subtracting the wrapper origin) so the caller can write them straight to inline
 * `top`/`bottom`/`left`. Exactly one of `top`/`bottom` is a number and the other is `null`, mirroring the pinned edge.
 * Placement rules: keep the panel above the trigger when the room above can hold it; otherwise flip below when the room
 * below is larger; clamp the height (`maxHeight`, non-null only when the panel must shrink) to the chosen side so it
 * scrolls internally instead of spilling; and clamp the horizontal position so a trigger near either rail cannot push a
 * wide panel off-screen. The `margin`/`gap` arithmetic guarantees the resulting panel rect stays within `margin` of
 * every viewport edge (down to a `minHeight` floor for pathologically short viewports).
 *
 * @param {DropdownPlacementInput} input Measured rects and spacing.
 * @returns {{ openDown: boolean, top: number | null, bottom: number | null, left: number, maxHeight: number | null }} Wrapper-relative placement.
 */
export function computeDropdownPlacement(input: DropdownPlacementInput): { openDown: boolean; top: number | null; bottom: number | null; left: number; maxHeight: number | null } {
    const { anchor, wrap, panelHeight, panelWidth, viewportWidth, viewportHeight, gap, margin, minHeight } = input;
    // Vertical: prefer opening upward (the design default); flip below only when the room above cannot hold the panel
    // and the room below is larger. Clamp the height to the chosen side so the list scrolls instead of leaving the view.
    const spaceAbove = anchor.top - margin;
    const spaceBelow = viewportHeight - anchor.bottom - margin;
    const openDown = panelHeight + gap > spaceAbove && spaceBelow > spaceAbove;
    const room = (openDown ? spaceBelow : spaceAbove) - gap;
    const maxHeight = panelHeight > room ? Math.max(minHeight, room) : null;
    // Horizontal: keep the panel right-aligned to the trigger, then clamp both edges into the viewport so a trigger near
    // either rail cannot shove a wide panel off-screen.
    const rightAlignedLeft = anchor.right - panelWidth;
    const clampedLeft = clamp(rightAlignedLeft, margin, Math.max(margin, viewportWidth - panelWidth - margin));
    const left = clampedLeft - wrap.left;
    if (openDown)
        return { openDown, top: (anchor.bottom + gap) - wrap.top, bottom: null, left, maxHeight };
    return { openDown, top: null, bottom: wrap.bottom - (anchor.top - gap), left, maxHeight };
}

/**
 * Position an absolutely-placed dropdown panel so it stays fully inside the viewport.
 *
 * Boundary: the panel must be a `position: absolute` child of its trigger's `position: relative` wrapper (its
 * `offsetParent`) and already un-hidden so it can be measured. The stylesheet default opens these panels upward and
 * right-aligned relative to the trigger, which clips whenever the dialog sits high in — or hard against a side of — the
 * viewport. This measures the trigger against the live viewport, delegates the geometry to
 * {@link computeDropdownPlacement}, and writes `top`/`bottom`/`left`/`right`/`max-height` inline. All inline overrides
 * are cleared first so a re-open re-measures from the natural, stylesheet-capped size. Exactly one vertical edge is
 * pinned and the other forced to `auto`; the stylesheet default sets `bottom`, so leaving it in place while opening
 * downward would stretch the panel between both edges instead of letting it size to its content.
 *
 * @param {HTMLElement | null} button Trigger button the panel anchors to. Null is accepted because some callers'
 *        fields stay typed `null` after render assigns the live node; the body still treats it as an element.
 * @param {HTMLElement | null} panel Absolutely-positioned dropdown panel, already visible. Same null-field caveat.
 * @param {DropdownSpacing} [options] Spacing overrides (px).
 * @returns {void}
 */
export function placeDropdownPanel(button: HTMLElement | null, panel: HTMLElement | null, options: DropdownSpacing = {}) {
    // Strict inference keeps the pre-render `null` on caller fields. The cast does not change the property reads.
    const trigger = button as HTMLElement;
    const menu = panel as HTMLElement;
    const gap = options.gap ?? 8;
    const margin = options.margin ?? 8;
    const minHeight = options.minHeight ?? 140;
    // Drop prior overrides so the measurement below reflects the natural, stylesheet-capped size, not last open's clamp.
    menu.style.top = '';
    menu.style.bottom = '';
    menu.style.left = '';
    menu.style.right = '';
    menu.style.maxHeight = '';
    menu.style.overflowY = '';

    const placement = computeDropdownPlacement({
        anchor: trigger.getBoundingClientRect(),
        wrap: (menu.offsetParent ?? trigger).getBoundingClientRect(),
        panelHeight: menu.offsetHeight,
        panelWidth: menu.offsetWidth,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        gap,
        margin,
        minHeight,
    });

    if (placement.maxHeight != null) {
        menu.style.maxHeight = `${placement.maxHeight}px`;
        menu.style.overflowY = 'auto';
    }
    if (placement.openDown) {
        menu.style.top = `${placement.top}px`;
        menu.style.bottom = 'auto';
    }
    else {
        menu.style.bottom = `${placement.bottom}px`;
        menu.style.top = 'auto';
    }
    menu.style.left = `${placement.left}px`;
    menu.style.right = 'auto';
}

/**
 * Reveal a hidden dropdown panel at its viewport-fitted position without a first-frame flash.
 *
 * Boundary: opening a panel with `hidden = false` and then positioning it can let the browser paint one frame at the
 * stylesheet default (up + right-aligned) before {@link placeDropdownPanel}'s computed offsets apply — seen as the panel
 * appearing in one spot and jumping to another. Un-hiding under `visibility: hidden` keeps the panel laid out (so it is
 * measurable) but unpainted; only after it is placed do we clear `visibility`, so the panel's first painted frame is
 * already at its final spot. Callers own the toggle: this is the open half; closing stays a plain `hidden = true`.
 *
 * @param {HTMLElement | null} button Trigger button the panel anchors to. See {@link placeDropdownPanel} for the null caveat.
 * @param {HTMLElement | null} panel Absolutely-positioned dropdown panel to open.
 * @param {DropdownSpacing} [options] Spacing overrides forwarded to placement.
 * @returns {void}
 */
export function revealDropdownPanel(button: HTMLElement | null, panel: HTMLElement | null, options: DropdownSpacing = {}): void {
    const menu = panel as HTMLElement;
    menu.style.visibility = 'hidden';
    menu.hidden = false;
    try {
        placeDropdownPanel(button, menu, options);
    }
    finally {
        // Always restore visibility, even if measurement threw — a panel stuck at `visibility: hidden` would be open
        // but invisible, worse than an unpositioned one.
        menu.style.visibility = '';
    }
}

/**
 * Build the compact link label for an additional source reference chip.
 *
 * Boundary: invalid or missing `data-insp-path` values fall back to a numbered generic label; callers should still
 * send the original selection so the server can perform authoritative validation. This is only a local fallback; the
 * dialog asks the server for the project-relative `@path #range` label before inserting normal references.
 *
 * @param {{ inspPath?: unknown } | null | undefined} selection Browser selection collected from a page element.
 *        Nullish or a missing path uses the numbered fallback. `inspPath` is `unknown` because callers pass both the
 *        dialog's selection and loosely typed picker results.
 * @param {number} index Zero-based reference index.
 * @returns {string} Compact fallback label such as `@Button.jsx #42`.
 */
export function sourceReferenceLabel(selection: { inspPath?: unknown } | null | undefined, index: number): string {
    const parsed = parseInspPathLite(selection?.inspPath ?? '');
    if (!parsed.file)
        return t('reference.codeFallback', { n: index + 1 });
    const line = parsed.line != null ? ` #${parsed.line}` : '';
    return `@${basename(parsed.file)}${line}`;
}
