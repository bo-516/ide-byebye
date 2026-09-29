import { collectSelection, findInspectableElement, isPluginNode } from '../inspect/dom.js';

const REFERENCE_SWALLOWED_EVENTS = ['mousedown', 'pointerdown', 'mouseup', 'pointerup', 'dblclick', 'contextmenu'];

/**
 * Page selection handed to the dialog. Only `inspPath` is required for the chip; the rest is round-tripped.
 * The index signature matches the dialog's `ElementSelection` so the callback object literal type-checks.
 */
interface PickedSelection {
    inspPath?: string;
    [key: string]: unknown;
}

/** Injected config fields this picker reads. Other keys stay on the object and are ignored here. */
interface ReferencePickerConfig {
    /** Present so the dialog's `{ enabledAgents }` config is assignable; this picker does not read it. */
    enabledAgents?: unknown;
    /** Cap forwarded to `collectSelection`. Omitted means the collector's own default. */
    maxDomSnippetLength?: number;
}

/**
 * Highlight overlay. The dialog types the shared instance as `object`, so the constructor casts to this shape.
 * Only these three methods are called.
 */
interface PageOverlay {
    hide(): void;
    showFor(el: Element): void;
    showNoMapping(el: Element): void;
}

/** Dialog hooks. `onSelect` may ignore the element and point; both are still passed for callers that want them. */
interface ReferencePickerCallbacks {
    onStart?: () => void;
    onCancel?: () => void;
    onSelect?: (selection: PickedSelection, element?: Element, point?: { x: number; y: number }) => void;
}

/**
 * One-shot page picker used while the dialog is already open.
 *
 * Boundary: this picker owns only the temporary "add another @code reference" interaction. It hides the dialog through
 * callbacks, swallows page events while active, and returns a collected browser selection; the server remains
 * responsible for source validation and context extraction.
 */
export class DialogReferencePicker {
    config: ReferencePickerConfig;
    overlay: PageOverlay;
    callbacks: ReferencePickerCallbacks;
    active = false;
    /** Last mapped element under the pointer, or null when the hover has no source mapping. */
    hovered: HTMLElement | null = null;
    /**
     * @param {ReferencePickerConfig} config Browser config. Only `maxDomSnippetLength` is read.
     * @param {object} overlay Shared page overlay. Typed `object` by the dialog; cast to {@link PageOverlay}.
     * @param {ReferencePickerCallbacks} callbacks Start, cancel, and select hooks. Omitted hooks are skipped.
     */
    constructor(config: ReferencePickerConfig, overlay: object, callbacks: ReferencePickerCallbacks) {
        this.config = config;
        // The dialog forwards the overlay as `object` so this file cannot see `Overlay`'s untyped methods.
        this.overlay = overlay as PageOverlay;
        this.callbacks = callbacks;
    }

    /**
     * Report whether the reference picker currently owns page events.
     *
     * Boundary: callers use this to avoid duplicate listener registration; it does not imply the dialog is visible.
     *
     * @returns {boolean} True while a reference pick is in progress.
     */
    isActive() {
        return this.active;
    }

    /**
     * Enter reference-picking mode.
     *
     * Boundary: starting while already active is ignored. The dialog callback hides the backdrop before the user clicks
     * through to the page, and Escape is the only keyboard cancellation path while the dialog is hidden.
     *
     * @returns {void}
     */
    start() {
        if (this.active)
            return;
        this.active = true;
        this.callbacks.onStart?.();
        document.addEventListener('mousemove', this.onMouseMove, true);
        document.addEventListener('click', this.onClick, true);
        document.addEventListener('keydown', this.onKeyDown, true);
        window.addEventListener('scroll', this.onScroll, true);
        for (const type of REFERENCE_SWALLOWED_EVENTS) {
            document.addEventListener(type, this.swallow, true);
        }
        document.documentElement.style.cursor = 'crosshair';
    }

    /**
     * Cancel reference picking and restore the dialog.
     *
     * Boundary: this is safe to call even when inactive. Passing `restore: false` is used during dialog teardown so the
     * hidden dialog is not brought back after it has been closed.
     *
     * @param {{ restore?: boolean }} [options] Cancellation behavior flags. Omitted means restore the dialog.
     * @returns {void}
     */
    cancel(options: { restore?: boolean } = {}) {
        if (!this.active)
            return;
        this.deactivate();
        if (options.restore !== false)
            this.callbacks.onCancel?.();
    }

    /**
     * Remove listeners and visual state for the current pick.
     *
     * Boundary: this does not call user callbacks, allowing select and cancel paths to decide whether to restore,
     * append a reference, or leave the dialog closed.
     *
     * @returns {void}
     */
    deactivate() {
        if (!this.active)
            return;
        this.active = false;
        document.removeEventListener('mousemove', this.onMouseMove, true);
        document.removeEventListener('click', this.onClick, true);
        document.removeEventListener('keydown', this.onKeyDown, true);
        window.removeEventListener('scroll', this.onScroll, true);
        for (const type of REFERENCE_SWALLOWED_EVENTS) {
            document.removeEventListener(type, this.swallow, true);
        }
        document.documentElement.style.cursor = '';
        this.overlay.hide();
        this.hovered = null;
    }

    /**
     * Swallow page input while allowing plugin UI events through.
     *
     * Boundary: the dialog is hidden during normal picking, but this guard keeps the handler safe if the user starts a
     * pick and the plugin UI becomes visible again before listeners are removed.
     *
     * @param {Event} event Captured page event.
     * @returns {void}
     */
    swallow = (event: Event) => {
        if (isPluginNode(event.target))
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    /**
     * Update the overlay as the user hovers potential reference targets.
     *
     * Boundary: only elements with a source mapping can be selected; unmapped elements are highlighted with the existing
     * "no source mapping" state but do not complete the pick.
     *
     * @param {MouseEvent} event Mouse move event from the page.
     * @returns {void}
     */
    onMouseMove = (event: MouseEvent) => {
        const target = event.target;
        if (isPluginNode(target)) {
            this.overlay.hide();
            return;
        }
        const inspectable = findInspectableElement(target);
        if (inspectable) {
            this.hovered = inspectable;
            this.overlay.showFor(inspectable);
        }
        else if (target instanceof HTMLElement) {
            this.hovered = null;
            this.overlay.showNoMapping(target);
        }
        else {
            this.overlay.hide();
        }
    };

    /**
     * Keep the overlay aligned with the hovered element during scroll.
     *
     * Boundary: no work is done when there is no current mapped hover target.
     *
     * @returns {void}
     */
    onScroll = () => {
        if (this.hovered)
            this.overlay.showFor(this.hovered);
    };

    /**
     * Complete the reference pick from a mapped page element.
     *
     * Boundary: page clicks are always swallowed. Unmapped targets keep the picker active so the user can try another
     * nearby element without reopening the dialog.
     *
     * @param {MouseEvent} event Captured click event.
     * @returns {void}
     */
    onClick = (event: MouseEvent) => {
        if (isPluginNode(event.target))
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const inspectable = findInspectableElement(event.target);
        if (!inspectable) {
            if (event.target instanceof HTMLElement)
                this.overlay.showNoMapping(event.target);
            return;
        }
        const selection = collectSelection(inspectable, this.config.maxDomSnippetLength);
        this.deactivate();
        this.callbacks.onSelect?.(selection, inspectable, { x: event.clientX, y: event.clientY });
    };

    /**
     * Cancel the hidden-dialog pick when the user presses Escape.
     *
     * Boundary: other keys are ignored so text input and browser shortcuts do not leak into the page while picking.
     *
     * @param {KeyboardEvent} event Captured keydown event.
     * @returns {void}
     */
    onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.cancel();
        }
    };
}
