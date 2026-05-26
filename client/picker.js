import { collectSelection, findInspectableElement, isPluginNode } from './dom.js';
const SWALLOWED_EVENTS = ['mousedown', 'pointerdown', 'mouseup', 'pointerup', 'dblclick', 'contextmenu'];

/**
 * Resolve the live page element used as the screenshot anchor.
 *
 * Boundary: screenshots intentionally follow the same inspectable element shown by the overlay and sent for source
 * resolution. Using the raw click target can crop to a nested text/icon node even though the selected DOM/source node is
 * a larger component.
 *
 * @param {EventTarget | null} target Original browser event target.
 * @param {Element} inspectable Nearest source-mapped element used for code resolution.
 * @returns {Element} Element that screenshot modes should measure from.
 */
function resolveScreenshotTarget(target, inspectable) {
    if (target instanceof Element && isPluginNode(target))
        return inspectable;
    return inspectable;
}

/**
 * Element-inspector mode: hover to highlight, click to select. While active,
 * page interaction events are swallowed so picking never triggers real
 * clicks, focus changes, or navigation.
 */
export class PickerController {
    config;
    overlay;
    dialog;
    active = false;
    hovered = null;
    constructor(config, overlay, dialog) {
        this.config = config;
        this.overlay = overlay;
        this.dialog = dialog;
    }
    isActive() {
        return this.active;
    }
    previewTarget(target) {
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
    selectTarget(target, point) {
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
        const selection = collectSelection(inspectable, this.config.maxDomSnippetLength);
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
    swallow = (e) => {
        if (isPluginNode(e.target))
            return;
        e.preventDefault();
        e.stopImmediatePropagation();
    };
    onMouseMove = (e) => {
        const target = e.target;
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
    onClick = (e) => {
        if (isPluginNode(e.target))
            return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const inspectable = findInspectableElement(e.target);
        if (!inspectable) {
            if (e.target instanceof HTMLElement)
                this.overlay.showNoMapping(e.target);
            return;
        }
        const selection = collectSelection(inspectable, this.config.maxDomSnippetLength);
        const screenshotTarget = resolveScreenshotTarget(e.target, inspectable);
        this.exit();
        this.dialog.open(selection, inspectable, { x: e.clientX, y: e.clientY }, screenshotTarget);
    };
    onKeyDown = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            this.exit();
        }
    };
}
