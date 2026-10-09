import { el } from './dialog-utils.js';
import { splitMentionLabel } from './dialog-mention-label.js';
import { t } from '../lib/i18n.js';

/**
 * Mention chip creation for the intent editor.
 *
 * Boundary: chips are display + remove interaction only; the full prompt-facing label lives in
 * `data-label` (what serialization reads) and selection data stays in the editor's Map keyed by
 * refId, so no objects are stuffed into DOM attributes.
 */

/** Chip options. `static` chips have no remove button; `onRemove` is ignored when `static` is set. */
export interface MentionOptions {
    refId?: string;
    inspPath?: string;
    static?: boolean;
    onRemove?: (chip: HTMLElement) => void;
}

/**
 * displayMentionLabel(label): strip the prompt-facing leading `@` for chip display.
 *
 * Purpose: a mention chip shows `src/App.jsx #9-12`, while serialization into the prompt still uses the full label with
 * its leading `@`.
 * Boundary: empty input returns an empty string; non-strings are coerced via String() so a malformed label is surfaced
 * rather than thrown.
 *
 * @param {unknown} label Reference label resolved by the server, e.g. `@src/App.jsx #9-12`.
 * @returns {string} Display text without the leading `@`.
 */
export function displayMentionLabel(label: unknown): string {
    return String(label || '').replace(/^@/, '');
}

/**
 * createMentionElement(label, options): create one atomic mention chip node.
 *
 * Purpose: uses `contenteditable=false` so a reference behaves as a single unit the caret cannot split; static (primary)
 * chips have no remove button, supplementary references carry a `×`. The visible label is split by
 * {@link splitMentionLabel} into `.cii-mention-dir` (omitted without a directory), `.cii-mention-file`, and a
 * `.cii-mention-range` tag (omitted without a range) so the stylesheet can dim, emphasize, or hide each part.
 * Boundary: the node only handles display and remove interaction; the full prompt-facing label lives in `data-label`
 * (what serialization reads) and the selection data is kept by the caller in an external Map keyed by refId, so no
 * objects are stuffed into DOM attributes. A missing label renders an empty chip.
 *
 * @param {string} label Reference label (with `@`).
 * @param {MentionOptions} [options] Chip behavior config. Omitted means a removable chip with no ids.
 * @returns {HTMLElement} A mention node insertable into the contenteditable.
 */
export function createMentionElement(label: string, options: MentionOptions = {}) {
    const text = String(label || '').trim();
    const chip: HTMLElement = el('span', `cii-mention${options.static ? ' cii-mention-static' : ''}`);
    chip.setAttribute('contenteditable', 'false');
    chip.dataset.label = text;
    if (options.inspPath)
        chip.dataset.inspPath = options.inspPath;
    if (options.refId)
        chip.dataset.refId = options.refId;
    chip.title = options.inspPath || text;

    const parts = splitMentionLabel(text);
    const labelEl = el('span', 'cii-mention-text');
    if (parts.dir)
        labelEl.append(el('span', 'cii-mention-dir', parts.dir));
    labelEl.append(el('span', 'cii-mention-file', parts.file));
    chip.append(el('span', 'cii-mention-icon'), labelEl);
    if (parts.lines)
        chip.append(el('span', 'cii-mention-range', parts.lines));

    if (!options.static) {
        const remove = el('button', 'cii-mention-remove', '×');
        remove.type = 'button';
        remove.setAttribute('contenteditable', 'false');
        remove.setAttribute('aria-label', t('mention.remove.aria', { label: displayMentionLabel(text) }));
        remove.addEventListener('mousedown', (event) => {
            // In a contenteditable, mousedown moves the caret / starts a delete selection, so prevent default first.
            event.preventDefault();
            event.stopPropagation();
        });
        remove.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            options.onRemove?.(chip);
        });
        chip.append(remove);
    }
    return chip;
}
