import { DialogReferencePicker } from './dialog-reference-picker.js';
import { el, sourceReferenceLabel } from './dialog-utils.js';

/**
 * Coordinates picking extra `@code` references for the dialog mention editor.
 *
 * Boundary: this owns the footer button and the one-shot page picker. Picked references are handed to the editor via
 * `host.insertReference`, which inserts an inline mention at the captured cursor; the editor (not this controller) is the
 * single source of truth for reference order and the outgoing payload. Server-side source resolution stays authoritative
 * for the final prompt.
 */
export class DialogReferenceController {
    picker;
    host;
    button;
    pendingRange = null;
    constructor(config, overlay, host) {
        this.host = host;
        this.picker = new DialogReferencePicker(config, overlay, {
            onStart: () => this.setPicking(true),
            onCancel: () => this.setPicking(false),
            onSelect: (selection) => void this.addSelection(selection),
        });
    }

    /**
     * Reset transient picking state for a newly opened dialog.
     *
     * Boundary: reference data now lives in the editor, so this only drops the pending cursor handoff; persisted
     * preferences are untouched because references are always per intent.
     *
     * @returns {void}
     */
    reset() {
        this.pendingRange = null;
    }

    /**
     * Cancel hidden picking when the dialog closes.
     *
     * Boundary: `restore: false` prevents a hidden dialog from being shown again after close.
     *
     * @returns {void}
     */
    clear() {
        this.picker.cancel({ restore: false });
        this.pendingRange = null;
    }

    /**
     * Render the footer button that starts selecting another source reference.
     *
     * Boundary: the button captures the editor cursor, hides the dialog, and enters page-picking mode; Escape cancels
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
            // Remember where the caret is so the picked reference lands inline at that spot after the dialog re-appears.
            this.pendingRange = this.host.captureIntentCursor?.() ?? null;
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
     * Hide or restore the dialog while the user picks a page element.
     *
     * Boundary: the backdrop is hidden rather than destroyed so editor content and screenshots survive the pick.
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
     * Resolve the chip label for one selected reference.
     *
     * Boundary: the browser only knows `file:line` from `data-insp-path`; the server resolves the AST range and
     * project-relative path, so normal labels become `@src/Button.jsx #12-45`. Empty resolver results fall back to the
     * compact browser-derived label; thrown errors are handled by `addSelection()`.
     *
     * @param {Record<string, unknown>} selection Browser selection collected by the reference picker.
     * @param {number} index Zero-based fallback index.
     * @returns {Promise<string>} Prompt-facing reference label inserted into the editor.
     */
    async resolveLabel(selection, index) {
        const fallback = sourceReferenceLabel(selection, index);
        const label = await this.host.resolveReferenceText?.(selection);
        const text = String(label || '').trim();

        return text || fallback;
    }

    /**
     * Add a selected page element as an inline `@code` mention.
     *
     * Boundary: duplicate `data-insp-path` values are ignored to avoid repeated mentions. The dialog is restored before
     * insertion so the editor regains focus, then the mention is dropped at the captured cursor in the typed text.
     *
     * @param {Record<string, unknown>} selection Browser selection collected by the reference picker.
     * @returns {Promise<void>}
     */
    async addSelection(selection) {
        if (!selection?.inspPath) {
            this.setPicking(false);
            return;
        }
        if (this.host.hasReference?.(selection.inspPath)) {
            this.setPicking(false);
            return;
        }
        let label;
        try {
            label = await this.resolveLabel(selection, 0);
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
        if (this.host.hasReference?.(selection.inspPath)) {
            this.setPicking(false);
            return;
        }

        const range = this.pendingRange;
        this.pendingRange = null;
        this.setPicking(false);
        this.host.insertReference?.({ label, selection, range });
    }
}
