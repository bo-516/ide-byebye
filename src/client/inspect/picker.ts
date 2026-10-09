import { collectSelection, findInspectableElement, isPluginNode } from './dom.js';
const SWALLOWED_EVENTS = ['mousedown', 'pointerdown', 'mouseup', 'pointerup', 'dblclick', 'contextmenu'];

/** Page config this picker reads. The live object has more keys; only the snippet cap is indexed. */
interface PickerConfig {
    maxDomSnippetLength: number;
}

/** Highlight overlay. Methods stay bivariant so the real `Overlay` class satisfies this. */
interface PickerOverlay {
    hide(): void;
    showFor(el: Element): void;
    showNoMapping(el: Element): void;
}

/**
 * Dialog surface the picker opens. Matches `Dialog.open` / `Dialog.isOpen` without importing that class, so a
 * narrower selection type here cannot reject the dialog's index-signature selection.
 */
interface PickerDialog {
    isOpen(): boolean;
    open(selection: { inspPath?: string; [key: string]: unknown }, selectedElement?: Element | null, anchor?: { x: number; y: number } | null, screenshotElement?: Element | null): void;
}

/**
 * Resolve the live page element used as the screenshot anchor.
 *
 * Boundary: screenshots intentionally follow the same inspectable element shown by the overlay and sent for source
 * resolution. Using the raw click target can crop to a nested text/icon node even though the selected DOM/source node is
 * a larger component.
 *
 * @param {unknown} target Original browser event target. Plugin UI falls back to `inspectable`.
 * @param {Element} inspectable Nearest source-mapped element used for code resolution.
 * @returns {Element} Element that screenshot modes should measure from.
 */
function resolveScreenshotTarget(target: unknown, inspectable: Element): Element {
    if (target instanceof Element && isPluginNode(target))
        return inspectable;
    return inspectable;
}

/**
 * Element-inspector mode: hover to highlight, click/tap to select. While active,
 * page interaction events are swallowed so picking never triggers real
 * clicks, focus changes, or navigation.
 *
 * Pointer events are the source of truth so Chrome device-mode (click → touch) still selects: swallowing
 * `pointerdown` with preventDefault suppresses the synthesized `click`, so selection runs on `pointerup`.
 */
export class PickerController {
    config: PickerConfig;
    overlay: PickerOverlay;
    dialog: PickerDialog;
    active = false;
    /** `null` is the initial value; a later hover stores the element. Left unannotated, the field would stay `null`. */
    hovered: HTMLElement | null = null;
    /**
     * @param {PickerConfig} config Injected page config. Only `maxDomSnippetLength` is read.
     * @param {PickerOverlay} overlay Hover highlight.
     * @param {PickerDialog} dialog Intent dialog opened on a successful pick.
     */
    constructor(config: PickerConfig, overlay: PickerOverlay, dialog: PickerDialog) {
        this.config = config;
        this.overlay = overlay;
        this.dialog = dialog;
    }
    isActive() {
        return this.active;
    }
    /**
     * @param {unknown} target Event target or test double.
     * @returns {void}
     */
    previewTarget(target: unknown): void {
        if (this.active || this.dialog.isOpen())
            return;
        if (isPluginNode(target)) {
            this.overlay.hide();
            return;
        }
        const inspectable = findInspectableElement(target);
        if (inspectable) {
            this.hovered = inspectable;
            this.overlay.showFor(inspectable);
            return;
        }
        this.hovered = null;
        if (target instanceof HTMLElement)
            this.overlay.showNoMapping(target);
        else
            this.overlay.hide();
    }
    /**
     * Pick `target` as the dialog's primary selection (a portal pick also carries its render chain).
     *
     * @param {unknown} target Event target or test double.
     * @param {{ x: number, y: number }} point Viewport point passed to the dialog.
     * @returns {boolean} False when the dialog must stay closed.
     */
    selectTarget(target: unknown, point: { x: number; y: number }): boolean {
        if (this.active || this.dialog.isOpen())
            return false;
        if (isPluginNode(target))
            return false;
        const inspectable = findInspectableElement(target);
        if (!inspectable) {
            if (target instanceof HTMLElement) {
                this.overlay.showNoMapping(target);
                return true;
            }
            this.overlay.hide();
            return false;
        }
        const selection = collectSelection(inspectable, this.config.maxDomSnippetLength, { withChain: true });
        const screenshotTarget = resolveScreenshotTarget(target, inspectable);
        this.overlay.hide();
        this.hovered = null;
        this.dialog.open(selection, inspectable, point, screenshotTarget);
        return true;
    }
    hidePreview() {
        if (this.active)
            return;
        this.hovered = null;
        this.overlay.hide();
    }
    toggle() {
        if (this.active)
            this.exit();
        else
            this.enter();
    }
    enter() {
        if (this.active || this.dialog.isOpen())
            return;
        this.active = true;
        document.addEventListener('mousemove', this.onMouseMove, true);
        document.addEventListener('pointermove', this.onMouseMove, true);
        // Register pointerup/click BEFORE swallow so capture-order still reaches the picker after preventDefault
        // on pointerdown (device-mode touch never synthesizes click once pointerdown is cancelled).
        document.addEventListener('pointerup', this.onPointerUp, true);
        document.addEventListener('click', this.onClick, true);
        document.addEventListener('keydown', this.onKeyDown, true);
        window.addEventListener('scroll', this.onScroll, true);
        for (const type of SWALLOWED_EVENTS) {
            document.addEventListener(type, this.swallow, true);
        }
        document.documentElement.style.cursor = 'crosshair';
    }
    exit() {
        if (!this.active)
            return;
        this.active = false;
        document.removeEventListener('mousemove', this.onMouseMove, true);
        document.removeEventListener('pointermove', this.onMouseMove, true);
        document.removeEventListener('pointerup', this.onPointerUp, true);
        document.removeEventListener('click', this.onClick, true);
        document.removeEventListener('keydown', this.onKeyDown, true);
        window.removeEventListener('scroll', this.onScroll, true);
        for (const type of SWALLOWED_EVENTS) {
            document.removeEventListener(type, this.swallow, true);
        }
        document.documentElement.style.cursor = '';
        this.overlay.hide();
        this.hovered = null;
    }
    swallow = (event: Event) => {
        if (isPluginNode(event.target))
            return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    /** `mousemove` and `pointermove` share this. `MouseEvent` accepts a `PointerEvent`. */
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
    onScroll = () => {
        if (this.hovered)
            this.overlay.showFor(this.hovered);
    };
    onPointerUp = (event: PointerEvent) => {
        if (event.isPrimary === false)
            return;
        if (typeof event.button === 'number' && event.button !== 0)
            return;
        this.onClick(event);
    };
    /**
     * Pick-mode click: opens the dialog with the primary selection (a portal pick also carries its render chain).
     * `click` delivers a `MouseEvent`. `onPointerUp` forwards a `PointerEvent`, which extends it.
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
        const selection = collectSelection(inspectable, this.config.maxDomSnippetLength, { withChain: true });
        const screenshotTarget = resolveScreenshotTarget(event.target, inspectable);
        this.exit();
        this.dialog.open(selection, inspectable, { x: event.clientX, y: event.clientY }, screenshotTarget);
    };
    onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.exit();
        }
    };
}
