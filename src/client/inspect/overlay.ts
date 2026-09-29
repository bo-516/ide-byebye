import { basename, inspPathOf, parseInspPathLite } from './dom.js';
import { t } from '../lib/i18n.js';
/** Fixed-position highlight box + floating label for the hovered element. */
export class Overlay {
    box: HTMLDivElement;
    label: HTMLDivElement;
    /**
     * @param {Node} parent Shadow root (or any node) that hosts the highlight. Must implement `appendChild`.
     */
    constructor(parent: Node) {
        this.box = document.createElement('div');
        this.box.className = 'cii-overlay';
        this.label = document.createElement('div');
        this.label.className = 'cii-label';
        this.hide();
        parent.appendChild(this.box);
        parent.appendChild(this.label);
    }
    /**
     * Highlight an element that maps to source.
     *
     * @param {Element} el Hovered element. Its `data-insp-path` (or Angular label) fills the floating tag.
     * @returns {void}
     */
    showFor(el: Element): void {
        const rect = el.getBoundingClientRect();
        const inspPath = inspPathOf(el);
        const parsed = parseInspPathLite(inspPath);
        const loc = parsed.line != null ? `:${parsed.line}${parsed.column != null ? `:${parsed.column}` : ''}` : '';
        const tag = el.tagName.toLowerCase();
        this.position(rect, false);
        this.label.innerHTML = '';
        this.label.append(span('cii-tag', `<${tag}>`), document.createTextNode(' '), span('cii-loc', `${basename(parsed.file)}${loc}`));
        this.label.classList.remove('cii-nomap');
    }
    /**
     * Highlight an element that has no source mapping.
     *
     * @param {Element} el Hovered element without a location.
     * @returns {void}
     */
    showNoMapping(el: Element): void {
        const rect = el.getBoundingClientRect();
        this.position(rect, true);
        this.label.textContent = t('overlay.noMapping');
        this.label.classList.add('cii-nomap');
    }
    /**
     * Place the box and label from a viewport rect.
     *
     * @param {{ left: number, top: number, width: number, height: number, bottom: number }} rect Element rect.
     * @param {boolean} noMap True paints the unmapped style.
     * @returns {void}
     */
    position(rect: { left: number; top: number; width: number; height: number; bottom: number }, noMap: boolean): void {
        this.box.style.display = 'block';
        this.box.style.left = `${rect.left}px`;
        this.box.style.top = `${rect.top}px`;
        this.box.style.width = `${rect.width}px`;
        this.box.style.height = `${rect.height}px`;
        this.box.classList.toggle('cii-nomap', noMap);
        this.label.style.display = 'block';
        const labelTop = rect.top > 22 ? rect.top - 22 : rect.bottom + 4;
        this.label.style.left = `${Math.max(2, rect.left)}px`;
        this.label.style.top = `${labelTop}px`;
    }
    hide() {
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
 * @param {string} text Text content.
 * @returns {HTMLSpanElement} Span ready to append.
 */
function span(cls: string, text: string): HTMLSpanElement {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    return el;
}
