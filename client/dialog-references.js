import { DialogReferencePicker } from './dialog-reference-picker.js';
import { el, sourceReferenceLabel } from './dialog-utils.js';

/**
 * Local controller for extra `@code` references in the dialog.
 *
 * Boundary: this owns one-shot picking and the raw source selections for the current intent. The visible short label is
 * inserted into the host textarea, while server-side source resolution remains authoritative.
 */
export class DialogReferenceController {
    picker;
    host;
    button;
    previewEl;
    items = [];
    constructor(config, overlay, host) {
        this.host = host;
        this.picker = new DialogReferencePicker(config, overlay, {
            onStart: () => this.setPicking(true),
            onCancel: () => this.setPicking(false),
            onSelect: (selection) => void this.addSelection(selection),
        });
    }

    /**
     * Reset extra reference state for a newly opened dialog.
     *
     * Boundary: this does not touch persisted preferences because references are always per intent.
     *
     * @returns {void}
     */
    reset() {
        this.items = [];
    }

    /**
     * Cancel hidden picking and clear chip state when the dialog closes.
     *
     * Boundary: `restore: false` prevents a hidden dialog from being shown again after close.
     *
     * @returns {void}
     */
    clear() {
        this.picker.cancel({ restore: false });
        this.items = [];
    }

    /**
     * Attach the chip preview container for the current dialog render.
     *
     * Boundary: callers must pass the current dialog's container; stale containers will be overwritten on next render.
     *
     * @param {HTMLElement} previewEl Reference chip container.
     * @returns {void}
     */
    attachPreview(previewEl) {
        this.previewEl = previewEl;
        this.previewEl.hidden = true;
    }

    /**
     * Render the footer button that starts selecting another source reference.
     *
     * Boundary: the button records the textarea cursor, hides the dialog, and enters page-picking mode; Escape cancels
     * and restores the dialog.
     *
     * @returns {HTMLButtonElement} Footer icon button.
     */
    renderButton() {
        this.button = el('button', 'cii-icon-btn cii-reference-btn');
        this.button.type = 'button';
        this.button.title = '添加代码引用';
        this.button.setAttribute('aria-label', '添加代码引用');
        this.button.append(el('span', 'cii-code-ref-icon'));
        this.button.addEventListener('click', (event) => {
            event.stopPropagation();
            this.host.captureIntentCursor?.();
            this.picker.start();
        });
        return this.button;
    }

    /**
     * Disable or enable the reference button during busy states.
     *
     * Boundary: active hidden picking is not canceled here; the dialog only disables the visible control while resolving
     * or sending.
     *
     * @param {boolean} disabled Whether the reference button should be disabled.
     * @returns {void}
     */
    setDisabled(disabled) {
        if (this.button)
            this.button.disabled = disabled;
    }

    /**
     * Report whether the hidden page picker is currently active.
     *
     * Boundary: this mirrors the underlying one-shot picker state so the dialog can avoid closing on Escape while a
     * reference pick should merely be canceled.
     *
     * @returns {boolean} True while the page picker owns events.
     */
    isPicking() {
        return this.picker.isActive();
    }

    /**
     * Return raw selections for the send payload.
     *
     * Boundary: these selections have not been server-validated. Empty lists return an empty array so the dialog can
     * omit the payload field; when intentText is passed, references whose inline label was removed are omitted.
     *
     * @param {string | undefined} intentText Current textarea value used to keep inline text and hidden payload aligned.
     * @returns {Array<Record<string, unknown>>} Additional source selections.
     */
    payloadSelections(intentText) {
        const shouldFilterByIntent = typeof intentText === 'string';
        const text = String(intentText ?? '');

        return this.items
            .filter((item) => !shouldFilterByIntent || text.includes(item.label))
            .map((item) => item.selection);
    }

    /**
     * Hide or restore the dialog while the user picks a page element.
     *
     * Boundary: the backdrop is hidden rather than destroyed so textarea content and screenshots survive the pick.
     *
     * @param {boolean} active True while hidden picking is active.
     * @returns {void}
     */
    setPicking(active) {
        this.host.setBackdropHidden(active);
        if (this.button) {
            this.button.classList.toggle('cii-icon-btn-active', active);
            this.button.setAttribute('aria-pressed', active ? 'true' : 'false');
        }
        if (!active)
            this.host.focusIntent();
    }

    /**
     * Resolve the inline text inserted for one selected reference.
     *
     * Boundary: the browser only knows `file:line` from `data-insp-path`; the server resolves the AST range and
     * project-relative path, so normal labels become `@src/Button.jsx #12-45`.
     *
     * @param {Record<string, unknown>} selection Browser selection collected by the reference picker.
     * @param {number} index Zero-based fallback index.
     * @returns {Promise<string>} Text inserted into the intent textarea.
     */
    async resolveLabel(selection, index) {
        const fallback = sourceReferenceLabel(selection, index);
        const label = await this.host.resolveReferenceText?.(selection);
        const text = String(label || '').trim();

        return text || fallback;
    }

    /**
     * Add a selected page element as an extra source reference.
     *
     * Boundary: duplicate `data-insp-path` values are ignored to avoid repeated prompt lines and duplicate inline text.
     *
     * @param {Record<string, unknown>} selection Browser selection collected by the reference picker.
     * @returns {Promise<void>}
     */
    async addSelection(selection) {
        if (!selection?.inspPath) {
            this.setPicking(false);
            return;
        }
        if (this.items.some((item) => item.selection?.inspPath === selection.inspPath)) {
            this.setPicking(false);
            return;
        }
        let label;
        try {
            label = await this.resolveLabel(selection, this.items.length);
        }
        catch (err) {
            if (this.host.isOpen?.() !== false) {
                this.setPicking(false);
                this.host.showError?.(err instanceof Error ? err.message : String(err));
            }
            return;
        }
        if (this.host.isOpen?.() === false)
            return;
        if (this.items.some((item) => item.selection?.inspPath === selection.inspPath)) {
            this.setPicking(false);
            return;
        }

        this.items = [...this.items, { label, selection }];
        this.host.insertReferenceText?.(label);
        this.renderPreviews();
        this.setPicking(false);
        this.host.reposition();
    }

    /**
     * Render link-like chips for additional source references when a preview container is attached.
     *
     * Boundary: current dialog layout inserts labels into the textarea and does not attach a preview container. This
     * fallback keeps older hosts working without changing the outgoing references.
     *
     * @returns {void}
     */
    renderPreviews() {
        if (!this.previewEl)
            return;
        this.previewEl.innerHTML = '';
        this.previewEl.hidden = this.items.length === 0;
        this.items.forEach((item, index) => {
            const label = item.label ?? sourceReferenceLabel(item.selection, index);
            const chip = el('span', 'cii-code-ref-chip');
            const link = el('button', 'cii-code-ref-link', label);
            link.type = 'button';
            link.title = item.selection?.inspPath ?? '';
            const remove = el('button', 'cii-code-ref-remove', '×');
            remove.type = 'button';
            remove.setAttribute('aria-label', `移除${label}`);
            remove.addEventListener('click', () => this.remove(index));
            chip.append(link, remove);
            this.previewEl.append(chip);
        });
    }

    /**
     * Remove one extra source reference chip.
     *
     * Boundary: out-of-range indexes are ignored so stale handlers after a re-render cannot corrupt the list.
     *
     * @param {number} index Zero-based chip index.
     * @returns {void}
     */
    remove(index) {
        if (index < 0 || index >= this.items.length)
            return;
        this.items = this.items.filter((_, itemIndex) => itemIndex !== index);
        this.renderPreviews();
        this.host.reposition();
    }
}
