import { el, sourceReferenceLabel } from './dialog-utils.js';

/**
 * displayDialogReferenceLabel(label): format a reference label for attachment rows.
 *
 * Purpose: mirrors the Codex composer by showing `src/File.jsx #10-20` without the prompt-facing leading `@`.
 * Boundary: missing labels become an empty string; passing a non-string value is stringified so malformed server labels
 * are visible instead of throwing during preview rendering.
 *
 * @param {unknown} label Raw source label returned by the server or fallback formatter.
 * @returns {string} UI label without a leading `@`.
 */
export function displayDialogReferenceLabel(label) {
    return String(label || '').replace(/^@/, '');
}

/**
 * mountDialogReferencePreview(button): place the reference tray inside the dialog input field.
 *
 * Purpose: lets the reference controller mount its Codex-style attachment rows without making the oversized dialog
 * renderer know about one more child node.
 * Boundary: `button` must be the rendered reference footer button inside the current dialog. Passing a stale,
 * disconnected, or layout-incompatible button returns `null`; callers can retry after the dialog is attached.
 *
 * @param {HTMLElement | null | undefined} button Footer reference button owned by the current dialog render.
 * @returns {HTMLElement | null} Existing or newly inserted preview tray, or `null` when the dialog field is absent.
 */
export function mountDialogReferencePreview(button) {
    if (!(button instanceof HTMLElement)) {
        return null;
    }

    const dialog = button.closest('.cii-dialog');
    const field = dialog?.querySelector('.cii-field');
    const textarea = field?.querySelector('.cii-textarea');
    if (!(field instanceof HTMLElement) || !(textarea instanceof HTMLElement)) {
        return null;
    }

    const existing = field.querySelector('.cii-reference-preview');
    if (existing instanceof HTMLElement) {
        return existing;
    }

    const preview = el('div', 'cii-reference-preview');
    preview.hidden = true;
    field.insertBefore(preview, textarea);
    return preview;
}

/**
 * renderDialogReferenceChip(item, index, onRemove): build one source attachment row.
 *
 * Purpose: creates the Codex-like file icon, path text, and remove control for a selected source reference.
 * Boundary: `item.selection` is only used for fallback text and tooltip display; malformed selections still render a
 * numbered fallback. `onRemove` must accept the zero-based index, and a missing callback leaves the remove button inert.
 *
 * @param {{ label?: string, selection?: Record<string, unknown> }} item Reference item held by the controller.
 * @param {number} index Zero-based item position used for fallback labels and removal.
 * @param {(index: number) => void} onRemove Callback invoked when the user removes the row.
 * @returns {HTMLElement} Attachment row ready to append to the preview tray.
 */
export function renderDialogReferenceChip(item, index, onRemove) {
    const rawLabel = item?.label ?? sourceReferenceLabel(item?.selection, index);
    const label = displayDialogReferenceLabel(rawLabel) || `代码 ${index + 1}`;
    const chip = el('span', 'cii-code-ref-chip');
    const icon = el('span', 'cii-reference-file-icon');
    const text = el('span', 'cii-code-ref-link', label);
    const remove = el('button', 'cii-code-ref-remove', '×');

    chip.title = String(item?.selection?.inspPath ?? rawLabel ?? '');
    remove.type = 'button';
    remove.setAttribute('aria-label', `移除${label}`);
    remove.addEventListener('click', () => {
        onRemove?.(index);
    });

    chip.append(icon, text, remove);
    return chip;
}
