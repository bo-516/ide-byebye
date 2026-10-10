import { el } from './dialog-utils.js';
import { createMentionElement } from './dialog-editor-mention.js';
import { createEditorCaret } from './dialog-editor-caret.js';
import { renderPinnedRow } from './dialog-render-chain.js';
import { t } from '../lib/i18n.js';
import { appendEditorTokens, serializeEditorNode } from './dialog-editor-serialize.js';
import type { EditorSelection, EditorToken } from './dialog-editor-serialize.js';

export { displayMentionLabel } from './dialog-editor-mention.js';

/**
 * createDialogEditor(options): create the intent dialog's lightweight mention editor (tiptap-style contenteditable).
 *
 * Purpose: replaces the old textarea with a contenteditable so a supplementary reference is inserted inline at the caret
 * and stays ordered within the text; the primary selection lives outside the contenteditable as a non-removable pinned
 * chip at the top. On serialization, inline references are restored to `@path #range` text and the selection list is
 * exported in order for the payload.
 * Boundary: the editor only holds this dialog's local DOM and selection cache; source resolution stays on the server.
 * Every dialog render rebuilds the DOM, so after reset() you must render() before setPrimary().
 *
 * @param {{ placeholder?: string, onChange?: () => void, onSwitchPrimary?: (inspPath: string) => void }} [options]
 *        Placeholder copy, a structure-change callback (fired when a reference is inserted/removed), and the handler
 *        for choosing another entry of a portal pick's mount chain. Omitted means an empty placeholder, a no-op
 *        callback, and no mount chain beside the primary chip.
 * @returns {object} Editor controls (`render`, `setPrimary`, `insertReference`, `serialize`, …). Method types stay on
 *          the returned object; widening them to `Function` would hide the argument and return types callers use.
 */
export function createDialogEditor(options: { placeholder?: string; onChange?: () => void; onSwitchPrimary?: (inspPath: string) => void } = {}) {
    const placeholder = String(options.placeholder || '');
    const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};

    let pinnedEl: HTMLElement | null = null;
    const caret = createEditorCaret();
    const editorEl = () => caret.editorEl;
    // `= null` would freeze these as `null` and reject the range / primary assigned later.
    let primary: { label: string; selection: EditorSelection } | null = null;
    let refSeq = 0;
    const selections = new Map<string, EditorSelection>();

    /**
     * isEditorEmpty(): whether the editor has "no meaningful content" (no reference chip and no non-whitespace text).
     * Purpose: drives placeholder visibility; the primary pinned chip lives outside the editor and does not affect this.
     */
    const isEditorEmpty = () => {
        if (!caret.editorEl)
            return true;
        if (caret.editorEl.querySelector('.cii-mention'))
            return false;
        // An element's `textContent` is a string; `!` keeps the throw if a non-element ever lands here.
        return caret.editorEl.textContent!.trim().length === 0;
    };

    const refreshEmptyState = () => {
        caret.editorEl?.classList.toggle('cii-editor-empty', isEditorEmpty());
    };

    /**
     * renderPinned(): render/refresh the non-removable primary chip outside the contenteditable, plus a portal pick's
     * mount chain (see `renderPinnedRow`). Hides the container when there is no primary.
     */
    const renderPinned = () => {
        if (pinnedEl)
            renderPinnedRow(pinnedEl, primary, (label, inspPath) => createMentionElement(label, { static: true, inspPath }), options.onSwitchPrimary);
    };

    return {
        /**
         * render(): build and return this dialog's `.cii-field` (pinned chip container + contenteditable).
         * Boundary: every dialog rebuilds the DOM; if primary data already exists, the pinned chip is rendered too.
         *
         * @returns {HTMLElement} Field container ready to append into the dialog body.
         */
        render() {
            const field = el('div', 'cii-field');
            const pinned = el('div', 'cii-editor-pinned');
            pinned.hidden = true;
            const editor = el('div', 'cii-editor');
            pinnedEl = pinned;
            caret.editorEl = editor;
            editor.setAttribute('contenteditable', 'true');
            editor.setAttribute('role', 'textbox');
            editor.setAttribute('aria-multiline', 'true');
            editor.setAttribute('aria-label', t('editor.aria'));
            editor.dataset.placeholder = placeholder;
            editor.spellcheck = false;

            ['keyup', 'mouseup', 'input', 'focus'].forEach((eventName) => {
                editor.addEventListener(eventName, caret.trackRange);
            });
            editor.addEventListener('input', refreshEmptyState);
            editor.addEventListener('paste', (event) => {
                // Accept plain text only, so external rich text cannot pollute the contenteditable structure.
                event.preventDefault();
                const text = event.clipboardData?.getData('text/plain') ?? '';
                const range = caret.readRange() ?? caret.savedRange ?? caret.endRange();
                range.deleteContents();
                const node = document.createTextNode(text);
                range.insertNode(node);
                const after = document.createRange();
                after.setStartAfter(node);
                after.collapse(true);
                caret.savedRange = after.cloneRange();
                caret.focusEditor(after);
                refreshEmptyState();
            });

            field.append(pinned, editor);
            renderPinned();
            refreshEmptyState();
            return field;
        },

        /**
         * getEditorElement(): return the contenteditable node so the dialog can attach keydown (submit/Esc) and the focus
         * guard.
         * @returns {HTMLElement | null}
         */
        getEditorElement() {
            return editorEl();
        },

        /**
         * focus(): focus the editor and place the caret at the end.
         * Boundary: degrades safely when the editor is not rendered.
         */
        focus() {
            if (!caret.editorEl)
                return;
            caret.focusEditor(caret.endRange());
        },

        /**
         * setPrimary(data): set/refresh the primary selection chip data (triggered by a click, not removable).
         * Purpose: show the client fallback label immediately, then call again to upgrade once the server resolves the
         * `@path #range`. A portal pick's `selection.renderChain` renders as switchable entries around the chip.
         * Boundary: only updates memory and (if rendered) the pinned DOM; never writes into the contenteditable, so it
         * does not enter the intent text.
         *
         * @param {{ label?: unknown, selection?: EditorSelection | null } | null | undefined} [data] Primary selection.
         *        Missing data, or data without a selection, clears the pinned chip. `label` is coerced with `String`.
         */
        setPrimary(data?: { label?: unknown; selection?: EditorSelection | null } | null) {
            if (!data || !data.selection) {
                primary = null;
            }
            else {
                primary = { label: String(data.label || '').trim(), selection: data.selection };
            }
            renderPinned();
        },

        /**
         * captureCursor(): record the current caret Range so "add code reference" can re-insert at the original spot
         * after the dialog is hidden.
         * @returns {Range | null} The most recent Range that fell inside the editor.
         */
        captureCursor() {
            caret.trackRange();
            return caret.savedRange;
        },

        /**
         * hasReference(inspPath): whether a supplementary reference for that source already exists in the editor.
         * Boundary: only looks at mentions inside the contenteditable; the primary selection is not counted.
         *
         * @param {string} inspPath The `data-insp-path` written by the built-in stamper.
         * @returns {boolean}
         */
        hasReference(inspPath: string) {
            if (!caret.editorEl || !inspPath)
                return false;
            // `dataset` is typed on HTMLElement. The cast erases, so an SVG mention is still matched by its attribute.
            return Array.from(caret.editorEl.querySelectorAll('.cii-mention')).some((node) => (node as HTMLElement).dataset.inspPath === inspPath);
        },

        /**
         * insertReference(item): insert one removable reference chip inline at the caret (preserving order).
         * Purpose: replaces the old "pinned chip tray" so content `@`-mentioned mid-typing lands at its original spot.
         * Boundary: does not insert when label/selection is missing or the source is a duplicate; after insertion it
         * updates the cached caret and fires onChange (so the dialog can reposition).
         *
         * @param {{ label?: unknown, selection?: EditorSelection | null, range?: Range | null } | null | undefined} [item]
         *        Reference label, selection, and an optional insertion Range (captured by the dialog when the `@`
         *        button is clicked, so the dialog restore does not move the caret to the end). A missing label or
         *        selection inserts nothing.
         * @returns {boolean} Whether an insertion actually happened.
         */
        insertReference(item?: { label?: unknown; selection?: EditorSelection | null; range?: Range | null } | null) {
            const label = String(item?.label || '').trim();
            const selection = item?.selection;
            const editorNode = caret.editorEl;
            if (!editorNode || !label || !selection)
                return false;
            if (selection.inspPath && this.hasReference(selection.inspPath))
                return false;

            const refId = `r${++refSeq}`;
            selections.set(refId, selection);
            const mention = createMentionElement(label, {
                refId,
                inspPath: selection.inspPath,
                onRemove: (node) => this.removeMention(node),
            });

            const insideEditor = (range: Range | null | undefined): range is Range => !!range && editorNode.contains(range.commonAncestorContainer);
            const requested = item?.range;
            const targetRange = insideEditor(requested)
                ? requested
                : insideEditor(caret.savedRange)
                    ? caret.savedRange
                    : caret.endRange();
            const range = targetRange.cloneRange();
            range.deleteContents();
            const fragment = document.createDocumentFragment();
            fragment.append(document.createTextNode(' '), mention, document.createTextNode(' '));
            range.insertNode(fragment);

            const after = document.createRange();
            after.setStartAfter(mention.nextSibling ?? mention);
            after.collapse(true);
            caret.savedRange = after.cloneRange();
            caret.focusEditor(after);
            refreshEmptyState();
            onChange();
            return true;
        },

        /**
         * removeMention(node): remove one supplementary reference chip and its adjacent spacer space.
         * Boundary: degrades safely when the node has left the DOM; after removal it refreshes the empty state and fires
         * onChange.
         *
         * @param {HTMLElement | null | undefined} node The mention node created by insertReference. Null is a no-op.
         */
        removeMention(node: HTMLElement | null | undefined) {
            if (!node || !caret.editorEl?.contains(node))
                return;
            const next = node.nextSibling;
            const prev = node.previousSibling;
            const isSpace = (sibling: ChildNode | null): sibling is Text => !!sibling && sibling.nodeType === Node.TEXT_NODE && /^\s$/.test((sibling as Text).data);
            if (isSpace(next))
                next.remove();
            else if (isSpace(prev))
                prev.remove();
            if (node.dataset.refId)
                selections.delete(node.dataset.refId);
            node.remove();
            caret.trackRange();
            refreshEmptyState();
            onChange();
            this.focus();
        },

        /**
         * serialize(): export the editor content into the payload's { intent, references }.
         * Purpose: intent = text + inline `@path #range` (the primary is excluded; the server pins it from the selection);
         * references = the selection list in appearance order (needed for claude-app file attachments and codex-app
         * markdown links).
         * Boundary: collapses extra spaces and trims per line; the primary is not inside the contenteditable and is thus
         * naturally excluded.
         *
         * @returns {{ intent: string, references: Array<Record<string, unknown>> }}
         */
        serialize() {
            const refs: EditorSelection[] = [];
            if (!caret.editorEl)
                return { intent: '', references: refs };
            let text = '';
            for (const child of caret.editorEl.childNodes)
                text += serializeEditorNode(child, refs, selections);
            const intent = text
                .replace(/[ \t]+/g, ' ')
                .split('\n')
                .map((line) => line.trim())
                .join('\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            return { intent, references: refs };
        },

        /**
         * exportContent(): export the editor content as an ordered token list so a pinned dialog can be precisely rebuilt
         * on a cold restore (reload / cross-page).
         * Purpose: unlike serialize(), this keeps the order structure of "text segments" and "reference chips" (instead of
         * flattening to one string), so a restore does not duplicate inline references as plain text. The primary is not
         * inside the contenteditable and is restored separately by setPrimary.
         * Boundary: an orphaned chip that lost its selection is skipped; an empty editor returns an empty array.
         *
         * @returns {EditorToken[]} Ordered content tokens.
         */
        exportContent() {
            const tokens: EditorToken[] = [];
            if (!caret.editorEl)
                return tokens;
            for (const child of caret.editorEl.childNodes)
                appendEditorTokens(child, tokens, selections);
            return tokens;
        },

        /**
         * importContent(tokens): rebuild editor content from an exportContent() token list (cold restore).
         * Boundary: must be called after render(); appends text and reference chips in order, preserving their original
         * sequence; degrades safely for a non-array or empty input.
         *
         * @param {Array<Record<string, unknown>> | null | undefined} tokens Ordered content tokens exported by
         *        exportContent(). A non-array is ignored.
         * @returns {void}
         */
        importContent(tokens?: Array<Record<string, unknown>> | null) {
            if (!caret.editorEl || !Array.isArray(tokens))
                return;
            for (const token of tokens) {
                if (token?.t === 'text' && token.v) {
                    const range = caret.endRange();
                    // `token.v` is `unknown` on the loose import type; exports store a string and `createTextNode` coerces.
                    const node = document.createTextNode(token.v as string);
                    range.insertNode(node);
                    const after = document.createRange();
                    after.setStartAfter(node);
                    after.collapse(true);
                    caret.savedRange = after.cloneRange();
                }
                else if (token?.t === 'ref' && token.label && token.selection) {
                    this.insertReference({ label: token.label, selection: token.selection as EditorSelection });
                }
            }
            refreshEmptyState();
        },

        /**
         * setDisabled(disabled): disable editing while busy (resolving/sending) so content cannot change mid-send.
         * @param {boolean} disabled Whether to disable.
         */
        setDisabled(disabled: boolean) {
            if (!caret.editorEl)
                return;
            caret.editorEl.setAttribute('contenteditable', disabled ? 'false' : 'true');
            caret.editorEl.classList.toggle('cii-editor-disabled', Boolean(disabled));
        },

        /**
         * reset(): clear this dialog's editor state (text, references, primary, caret cache).
         * Boundary: only resets memory and (if present) the DOM; a new dialog must setPrimary again after render.
         */
        reset() {
            primary = null;
            caret.savedRange = null;
            refSeq = 0;
            selections.clear();
            if (caret.editorEl)
                caret.editorEl.innerHTML = '';
            renderPinned();
            refreshEmptyState();
        },
    };
}
