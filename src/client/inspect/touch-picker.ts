import { isPluginNode } from './dom.js';
import { t } from '../lib/i18n.js';

/** Class of the full-screen glass that takes every touch while pick mode is on. */
const GLASS_CLASS = 'cii-pick-glass';
/** Class of the hint pill at the top of the glass; hidden once the first press starts. */
const HINT_CLASS = 'cii-pick-hint';
/** Class on the glass once a press started, which fades the hint out. */
const PRESSED_CLASS = 'cii-pick-pressed';

/** Picker calls pick mode makes. `PickerController` satisfies it. */
export interface TouchPickHost {
    /** Hotkey pick mode is on. */
    isActive(): boolean;
    /** Leave hotkey pick mode. */
    exit(): void;
    dialog: { isOpen(): boolean };
    previewTarget(target: unknown): void;
    hidePreview(): void;
    selectTarget(target: unknown, point: { x: number; y: number }): boolean;
}

/** Document surface {@link pageElementAt} reads; `document` satisfies it, tests pass a stand-in. */
interface HitTester {
    elementsFromPoint(x: number, y: number): Element[];
}

/**
 * Page element under a viewport point, looking through the plugin's own UI.
 *
 * Purpose: pick mode covers the page with its glass, so the hit test that the browser would do for a tap is done here:
 * the topmost element at the point that is not plugin UI. An SVG or MathML node (an icon glyph) resolves to its nearest
 * HTML ancestor, so a tap on an icon picks the button that holds it.
 * Boundary: the browser's hit test already skips `pointer-events: none` and returns open-shadow-root hosts, not their
 * inner nodes — the same element a page click would report to the document. Returns null over empty space outside
 * `<html>` (an overscrolled edge) or when only plugin UI is under the point.
 *
 * @param {number} x Viewport x.
 * @param {number} y Viewport y.
 * @param {HitTester} [doc] Document to hit-test; defaults to `document`.
 * @returns {HTMLElement | null} Element to preview or pick.
 */
export function pageElementAt(x: number, y: number, doc: HitTester = document): HTMLElement | null {
    for (const hit of doc.elementsFromPoint(x, y)) {
        if (isPluginNode(hit))
            continue;
        let node: Element | null = hit;
        while (node && !(node instanceof HTMLElement))
            node = node.parentElement;
        return node;
    }
    return null;
}

/**
 * One-shot touch pick mode behind the floating pick button.
 *
 * Purpose: a phone has no ⌘-click, and a long-press on the page collides with the page's own gestures. Pick mode puts a
 * transparent glass over the page inside the plugin shadow root, so the page receives no event at all while the user
 * aims: press shows the highlight, moving the finger moves it, lifting picks through the picker's own
 * `selectTarget` (the ⌘-click path) and leaves pick mode once the dialog is open. A lift on an element without a
 * source mapping keeps pick mode on, with the "no source mapping" highlight, so the user can aim again.
 * Boundary: the glass blocks scrolling (`touch-action: none`), so the user scrolls first and then starts pick mode.
 * `pointercancel` only clears the highlight. The glass cancels its own `touchend` (no compat mouse events, no click
 * reach whatever is under the finger once the glass is gone) and `contextmenu`. Escape, the button again, or the
 * hotkey leaves pick mode. It refuses to start while the dialog is open, and leaves hotkey pick mode first.
 */
export class TouchPicker {
    parent: ParentNode;
    picker: TouchPickHost;
    /** Called after pick mode starts or stops, so the pick button can switch faces. */
    onChange: (active: boolean) => void;
    /** Live glass, or null while pick mode is off. */
    glass: HTMLDivElement | null = null;
    /** Pointer pressing the glass, or null between presses. */
    pointerId: number | null = null;

    /**
     * @param {ParentNode} parent Plugin shadow root; the glass is appended there.
     * @param {TouchPickHost} picker Picker that previews and selects.
     * @param {{ onChange?: (active: boolean) => void } | null} [callbacks] Missing `onChange` is a no-op.
     */
    constructor(parent: ParentNode, picker: TouchPickHost, callbacks?: { onChange?: (active: boolean) => void } | null) {
        this.parent = parent;
        this.picker = picker;
        this.onChange = typeof callbacks?.onChange === 'function' ? callbacks.onChange : () => {};
    }

    isActive() {
        return this.glass != null;
    }

    toggle() {
        if (this.glass)
            this.exit();
        else
            this.enter();
    }

    /**
     * Start pick mode: put the glass up.
     * @returns {void}
     */
    enter() {
        if (this.glass || this.picker.dialog.isOpen())
            return;
        if (this.picker.isActive())
            this.picker.exit();
        const glass = document.createElement('div');
        const hint = document.createElement('div');
        glass.className = GLASS_CLASS;
        hint.className = HINT_CLASS;
        hint.textContent = t('pick.hint');
        glass.append(hint);
        glass.addEventListener('pointerdown', this.onPointerDown);
        glass.addEventListener('pointermove', this.onPointerMove);
        glass.addEventListener('pointerup', this.onPointerUp);
        glass.addEventListener('pointercancel', this.onPointerCancel);
        glass.addEventListener('touchend', this.onTouchEnd, { passive: false });
        glass.addEventListener('contextmenu', this.onContextMenu);
        this.glass = glass;
        this.parent.append(glass);
        window.addEventListener('keydown', this.onKeyDown, true);
        this.onChange(true);
    }

    /**
     * Stop pick mode: remove the glass and any highlight it painted.
     * @returns {void}
     */
    exit() {
        if (!this.glass)
            return;
        this.glass.remove();
        this.glass = null;
        this.pointerId = null;
        window.removeEventListener('keydown', this.onKeyDown, true);
        this.picker.hidePreview();
        this.onChange(false);
    }

    onPointerDown = (event: PointerEvent) => {
        if (!event.isPrimary || event.button !== 0 || !this.glass)
            return;
        // Mouse input (pickButton: true on a desktop): no compat mousedown, focus change or text selection.
        event.preventDefault();
        this.pointerId = event.pointerId;
        try {
            this.glass.setPointerCapture(event.pointerId);
        }
        catch {
            // Touch already captures implicitly; a mouse that leaves the window just stops moving the highlight.
        }
        this.glass.classList.add(PRESSED_CLASS);
        this.preview(event);
    };

    /** Touch moves only while pressed; a mouse also previews on hover. */
    onPointerMove = (event: PointerEvent) => {
        if (this.pointerId === null ? event.pointerType !== 'mouse' : event.pointerId !== this.pointerId)
            return;
        this.preview(event);
    };

    onPointerUp = (event: PointerEvent) => {
        if (event.pointerId !== this.pointerId)
            return;
        this.pointerId = null;
        const target = pageElementAt(event.clientX, event.clientY);
        if (!target) {
            this.picker.hidePreview();
            return;
        }
        this.picker.selectTarget(target, { x: event.clientX, y: event.clientY });
        if (this.picker.dialog.isOpen())
            this.exit();
    };

    onPointerCancel = (event: PointerEvent) => {
        if (event.pointerId !== this.pointerId)
            return;
        this.pointerId = null;
        this.picker.hidePreview();
    };

    /** Dispatched to the glass even after `exit` removed it; cancelling stops the compat mouse events and the click. */
    onTouchEnd = (event: TouchEvent) => {
        if (event.cancelable)
            event.preventDefault();
    };

    onContextMenu = (event: Event) => event.preventDefault();

    onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape')
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.exit();
    };

    /**
     * Highlight the page element under the pointer, or clear the highlight over empty space.
     * @param {PointerEvent} event Pointer event on the glass.
     * @returns {void}
     */
    preview(event: PointerEvent) {
        const target = pageElementAt(event.clientX, event.clientY);
        if (target)
            this.picker.previewTarget(target);
        else
            this.picker.hidePreview();
    }
}
