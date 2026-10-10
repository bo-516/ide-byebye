import { inspPathOf } from './dom.js';
import { basename, parseInspPathLite } from './insp-path-lite.js';
import { formatBoxSize, formatLineColumn, placeLabel } from './overlay-layout.js';
import { t } from '../lib/i18n.js';

/**
 * Class that lets the box and label glide from one element to the next. It is dropped when the same element only
 * moved (scroll, resize), so the highlight then tracks the element without lagging behind it.
 * @type {string}
 */
const GLIDE_CLASS = 'cii-glide';

/**
 * Class for the unmapped look (dashed amber box, amber tag) on both the box and the label.
 * @type {string}
 */
const NO_MAP_CLASS = 'cii-nomap';

/**
 * Fixed-position highlight for the hovered element: a box that hugs the element's rect and corner radius, plus a
 * floating tag (`tag  file:line  W × H`) pinned to one of its corners.
 *
 * Boundary: it only paints; the pickers decide which element to show and when to hide. Repeat calls for the same
 * element and geometry write nothing, so a `mousemove` stream over one element costs one rect read per event.
 */
export class Overlay {
    box: HTMLDivElement;
    label: HTMLDivElement;
    /** Label parts, created once and refilled in place so a hover never rebuilds markup. */
    tagText: HTMLSpanElement;
    fileText: HTMLSpanElement;
    lineText: HTMLSpanElement;
    sizeText: HTMLSpanElement;
    /** Element the highlight follows; `null` while hidden. Switching to another element glides, the same one snaps. */
    target: Element | null = null;
    /** Mapping, text, and geometry last painted for `target`; equal input on the same element skips every write. */
    painted = '';
    /**
     * @param {Node} parent Shadow root (or any node) that hosts the highlight. Must implement `appendChild`.
     */
    constructor(parent: Node) {
        const loc = span('cii-label-loc');
        this.box = document.createElement('div');
        this.box.className = 'cii-overlay';
        this.label = document.createElement('div');
        this.label.className = 'cii-label';
        this.tagText = span('cii-label-tag');
        this.fileText = span('cii-label-file');
        this.lineText = span('cii-label-line');
        this.sizeText = span('cii-label-size');
        loc.append(this.fileText, this.lineText);
        this.label.append(this.tagText, loc, this.sizeText);
        this.hide();
        parent.appendChild(this.box);
        parent.appendChild(this.label);
    }
    /**
     * Highlight an element that maps to source.
     *
     * @param {Element} el Hovered element. Its `data-insp-path` (or Angular / component-tree location) fills the tag.
     * @returns {void}
     */
    showFor(el: Element): void {
        const parsed = parseInspPathLite(inspPathOf(el));
        this.paint(el, false, basename(parsed.file), formatLineColumn(parsed.line, parsed.column));
    }
    /**
     * Highlight an element that has no source mapping.
     *
     * @param {Element} el Hovered element without a location.
     * @returns {void}
     */
    showNoMapping(el: Element): void {
        this.paint(el, true, t('overlay.noMapping'), '');
    }
    /**
     * Place the box on `el` and fill and place the tag.
     *
     * Boundary: reads the element rect every call, and its computed corner radius only when the target changes. The
     * label is measured after its text is set, so placement always uses the real width.
     *
     * @param {Element} el Element to outline.
     * @param {boolean} noMap True paints the unmapped style.
     * @param {string} file Main tag text: the source file name, or the "no mapping" note.
     * @param {string} line `:line:column` suffix, or `''` to hide it.
     * @returns {void}
     */
    paint(el: Element, noMap: boolean, file: string, line: string): void {
        const rect = el.getBoundingClientRect();
        const key = [noMap, file, line, rect.left, rect.top, rect.width, rect.height].join('|');
        const retarget = el !== this.target;
        const glide = retarget && this.target !== null;
        if (!retarget && key === this.painted)
            return;
        this.target = el;
        this.painted = key;
        for (const node of [this.box, this.label]) {
            node.classList.toggle(GLIDE_CLASS, glide);
            node.classList.toggle(NO_MAP_CLASS, noMap);
            node.style.display = '';
        }
        this.box.style.left = `${rect.left}px`;
        this.box.style.top = `${rect.top}px`;
        this.box.style.width = `${rect.width}px`;
        this.box.style.height = `${rect.height}px`;
        if (retarget)
            this.box.style.borderRadius = getComputedStyle(el).borderRadius;
        this.tagText.textContent = el.tagName.toLowerCase();
        this.fileText.textContent = file;
        this.lineText.textContent = line;
        this.sizeText.textContent = formatBoxSize(rect.width, rect.height);
        const at = placeLabel(rect, { width: this.label.offsetWidth, height: this.label.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
        this.label.style.left = `${at.left}px`;
        this.label.style.top = `${at.top}px`;
    }
    hide() {
        this.target = null;
        this.painted = '';
        this.box.style.display = 'none';
        this.label.style.display = 'none';
    }
    destroy() {
        this.box.remove();
        this.label.remove();
    }
}
/**
 * @param {string} cls Class name.
 * @returns {HTMLSpanElement} Empty span ready to fill and append.
 */
function span(cls: string): HTMLSpanElement {
    const el = document.createElement('span');
    el.className = cls;
    return el;
}
