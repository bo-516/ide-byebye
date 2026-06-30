import { el } from './dialog-utils.js';
import { t } from '../lib/i18n.js';

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
export function displayMentionLabel(label) {
    return String(label || '').replace(/^@/, '');
}

/**
 * createMentionElement(label, options): create one atomic mention chip node.
 *
 * Purpose: uses `contenteditable=false` so a reference behaves as a single unit the caret cannot split; static (primary)
 * chips have no remove button, supplementary references carry a `×`.
 * Boundary: the node only handles display and remove interaction; the selection data is kept by the caller in an
 * external Map keyed by refId, so no objects are stuffed into DOM attributes.
 *
 * @param {string} label Reference label (with `@`).
 * @param {{ refId?: string, inspPath?: string, static?: boolean, onRemove?: Function }} options Chip behavior config.
 * @returns {HTMLElement} A mention node insertable into the contenteditable.
 */
function createMentionElement(label, options = {}) {
    const text = String(label || '').trim();
    const chip = el('span', `cii-mention${options.static ? ' cii-mention-static' : ''}`);
    chip.setAttribute('contenteditable', 'false');
    chip.dataset.label = text;
    if (options.inspPath)
        chip.dataset.inspPath = options.inspPath;
    if (options.refId)
        chip.dataset.refId = options.refId;
    chip.title = options.inspPath || text;

    const icon = el('span', 'cii-mention-icon');
    const labelEl = el('span', 'cii-mention-text', displayMentionLabel(text));
    chip.append(icon, labelEl);

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
 * @param {{ placeholder?: string, onChange?: Function }} options Placeholder copy and a structure-change callback (fired
 * when a reference is inserted/removed).
 * @returns {Record<string, Function>} Editor control methods.
 */
export function createDialogEditor(options = {}) {
    const placeholder = String(options.placeholder || '');
    const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};

    let fieldEl = null;
    let pinnedEl = null;
    let editorEl = null;
    let primary = null; // { label, selection }
    let savedRange = null;
    let refSeq = 0;
    const selections = new Map(); // refId -> selection

    const resolveSelectionRoot = () => editorEl?.getRootNode?.() ?? document;

    /**
     * readRange(): read the caret Range currently inside the contenteditable.
     * Boundary: under shadow DOM it prefers root.getSelection(), falling back to window.getSelection(); returns null when
     * the caret is not inside the editor.
     */
    const readRange = () => {
        if (!editorEl)
            return null;
        const root = resolveSelectionRoot();
        const selection = (root.getSelection && root.getSelection()) || window.getSelection?.();
        if (!selection || selection.rangeCount === 0)
            return null;
        const range = selection.getRangeAt(0);
        if (!editorEl.contains(range.commonAncestorContainer))
            return null;
        return range.cloneRange();
    };

    const endRange = () => {
        const range = document.createRange();
        range.selectNodeContents(editorEl);
        range.collapse(false);
        return range;
    };

    const trackRange = () => {
        const range = readRange();
        if (range)
            savedRange = range;
    };

    /**
     * isEditorEmpty(): whether the editor has "no meaningful content" (no reference chip and no non-whitespace text).
     * Purpose: drives placeholder visibility; the primary pinned chip lives outside the editor and does not affect this.
     */
    const isEditorEmpty = () => {
        if (!editorEl)
            return true;
        if (editorEl.querySelector('.cii-mention'))
            return false;
        return editorEl.textContent.trim().length === 0;
    };

    const refreshEmptyState = () => {
        editorEl?.classList.toggle('cii-editor-empty', isEditorEmpty());
    };

    const focusEditor = (caretRange) => {
        if (!editorEl)
            return;
        try {
            editorEl.focus({ preventScroll: true });
        }
        catch {
            editorEl.focus();
        }
        if (!caretRange)
            return;
        try {
            const root = resolveSelectionRoot();
            const selection = (root.getSelection && root.getSelection()) || window.getSelection?.();
            if (selection) {
                selection.removeAllRanges();
                selection.addRange(caretRange);
            }
        }
        catch {
            // Failing to restore the selection is not fatal: the next click/typing re-establishes the caret.
        }
    };

    /**
     * renderPinned(): render/refresh the primary selection pinned chip outside the contenteditable.
     * Boundary: hides the container when there is no primary; the primary chip has no remove button and is naturally
     * not editable-deletable.
     */
    const renderPinned = () => {
        if (!pinnedEl)
            return;
        pinnedEl.innerHTML = '';
        if (!primary) {
            pinnedEl.hidden = true;
            return;
        }
        pinnedEl.hidden = false;
        const chip = createMentionElement(primary.label, {
            static: true,
            inspPath: primary.selection?.inspPath,
        });
        chip.title = t('editor.primaryPinned.title', { target: primary.selection?.inspPath ?? primary.label });
        pinnedEl.append(chip);
    };

    /**
     * serializeNode(node, refs): recursively turn one DOM node into prompt text, collecting reference selections in order.
     * Boundary: a mention chip is restored to `@label` with surrounding spaces; <br>/block elements become newlines; an
     * orphaned chip that lost its selection is skipped.
     */
    const serializeNode = (node, refs) => {
        if (node.nodeType === Node.TEXT_NODE)
            return node.data;
        if (!(node instanceof HTMLElement))
            return '';
        if (node.tagName === 'BR')
            return '\n';
        if (node.classList.contains('cii-mention')) {
            const refId = node.dataset.refId;
            const selection = refId ? selections.get(refId) : null;
            if (!selection)
                return '';
            refs.push(selection);
            const label = node.dataset.label || '';
            return ` ${label} `;
        }
        let text = '';
        for (const child of node.childNodes)
            text += serializeNode(child, refs);
        // Some browsers wrap a new line in a <div>/<p> inside contenteditable, so add a newline boundary.
        if (/^(DIV|P)$/.test(node.tagName))
            text += '\n';
        return text;
    };

    return {
        /**
         * render(): build and return this dialog's `.cii-field` (pinned chip container + contenteditable).
         * Boundary: every dialog rebuilds the DOM; if primary data already exists, the pinned chip is rendered too.
         *
         * @returns {HTMLElement} Field container ready to append into the dialog body.
         */
        render() {
            fieldEl = el('div', 'cii-field');
            pinnedEl = el('div', 'cii-editor-pinned');
            pinnedEl.hidden = true;
            editorEl = el('div', 'cii-editor');
            editorEl.setAttribute('contenteditable', 'true');
            editorEl.setAttribute('role', 'textbox');
            editorEl.setAttribute('aria-multiline', 'true');
            editorEl.setAttribute('aria-label', t('editor.aria'));
            editorEl.dataset.placeholder = placeholder;
            editorEl.spellcheck = false;

            ['keyup', 'mouseup', 'input', 'focus'].forEach((eventName) => {
                editorEl.addEventListener(eventName, trackRange);
            });
            editorEl.addEventListener('input', refreshEmptyState);
            editorEl.addEventListener('paste', (event) => {
                // Accept plain text only, so external rich text cannot pollute the contenteditable structure.
                event.preventDefault();
                const text = event.clipboardData?.getData('text/plain') ?? '';
                const range = readRange() ?? savedRange ?? endRange();
                range.deleteContents();
                const node = document.createTextNode(text);
                range.insertNode(node);
                const after = document.createRange();
                after.setStartAfter(node);
                after.collapse(true);
                savedRange = after.cloneRange();
                focusEditor(after);
                refreshEmptyState();
            });

            fieldEl.append(pinnedEl, editorEl);
            renderPinned();
            refreshEmptyState();
            return fieldEl;
        },

        /**
         * getEditorElement(): return the contenteditable node so the dialog can attach keydown (submit/Esc) and the focus
         * guard.
         * @returns {HTMLElement | null}
         */
        getEditorElement() {
            return editorEl;
        },

        /**
         * focus(): focus the editor and place the caret at the end.
         * Boundary: degrades safely when the editor is not rendered.
         */
        focus() {
            if (!editorEl)
                return;
            focusEditor(endRange());
        },

        /**
         * setPrimary(data): set/refresh the primary selection chip data (triggered by a click, not removable).
         * Purpose: show the client fallback label immediately, then call again to upgrade once the server resolves the
         * `@path #range`.
         * Boundary: only updates memory and (if rendered) the pinned DOM; never writes into the contenteditable, so it
         * does not enter the intent text.
         *
         * @param {{ label: string, selection: Record<string, unknown> }} data Primary selection label and selection.
         */
        setPrimary(data) {
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
            trackRange();
            return savedRange;
        },

        /**
         * hasReference(inspPath): whether a supplementary reference for that source already exists in the editor.
         * Boundary: only looks at mentions inside the contenteditable; the primary selection is not counted.
         *
         * @param {string} inspPath The `data-insp-path` injected by code-inspector.
         * @returns {boolean}
         */
        hasReference(inspPath) {
            if (!editorEl || !inspPath)
                return false;
            return Array.from(editorEl.querySelectorAll('.cii-mention')).some((node) => node.dataset.inspPath === inspPath);
        },

        /**
         * insertReference(item): insert one removable reference chip inline at the caret (preserving order).
         * Purpose: replaces the old "pinned chip tray" so content `@`-mentioned mid-typing lands at its original spot.
         * Boundary: does not insert when label/selection is missing or the source is a duplicate; after insertion it
         * updates the cached caret and fires onChange (so the dialog can reposition).
         *
         * @param {{ label: string, selection: Record<string, unknown>, range?: Range }} item Reference label, selection,
         * and an optional insertion Range (captured by the dialog when the `@` button is clicked, so the dialog restore
         * does not move the caret to the end).
         * @returns {boolean} Whether an insertion actually happened.
         */
        insertReference(item) {
            const label = String(item?.label || '').trim();
            const selection = item?.selection;
            if (!editorEl || !label || !selection)
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

            const insideEditor = (range) => range && editorEl.contains(range.commonAncestorContainer);
            const targetRange = insideEditor(item?.range)
                ? item.range
                : insideEditor(savedRange)
                    ? savedRange
                    : endRange();
            const range = targetRange.cloneRange();
            range.deleteContents();
            const fragment = document.createDocumentFragment();
            fragment.append(document.createTextNode(' '), mention, document.createTextNode(' '));
            range.insertNode(fragment);

            const after = document.createRange();
            after.setStartAfter(mention.nextSibling ?? mention);
            after.collapse(true);
            savedRange = after.cloneRange();
            focusEditor(after);
            refreshEmptyState();
            onChange();
            return true;
        },

        /**
         * removeMention(node): remove one supplementary reference chip and its adjacent spacer space.
         * Boundary: degrades safely when the node has left the DOM; after removal it refreshes the empty state and fires
         * onChange.
         *
         * @param {HTMLElement} node The mention node created by insertReference.
         */
        removeMention(node) {
            if (!node || !editorEl?.contains(node))
                return;
            const next = node.nextSibling;
            const prev = node.previousSibling;
            const isSpace = (sibling) => sibling?.nodeType === Node.TEXT_NODE && /^\s$/.test(sibling.data);
            if (isSpace(next))
                next.remove();
            else if (isSpace(prev))
                prev.remove();
            if (node.dataset.refId)
                selections.delete(node.dataset.refId);
            node.remove();
            trackRange();
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
            const refs = [];
            if (!editorEl)
                return { intent: '', references: refs };
            let text = '';
            for (const child of editorEl.childNodes)
                text += serializeNode(child, refs);
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
         * @returns {Array<{ t: 'text', v: string } | { t: 'ref', label: string, selection: Record<string, unknown> }>} Ordered content tokens.
         */
        exportContent() {
            const tokens = [];
            if (!editorEl)
                return tokens;
            const walk = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    if (node.data)
                        tokens.push({ t: 'text', v: node.data });
                    return;
                }
                if (!(node instanceof HTMLElement))
                    return;
                if (node.tagName === 'BR') {
                    tokens.push({ t: 'text', v: '\n' });
                    return;
                }
                if (node.classList.contains('cii-mention')) {
                    const refId = node.dataset.refId;
                    const selection = refId ? selections.get(refId) : null;
                    if (selection)
                        tokens.push({ t: 'ref', label: node.dataset.label || '', selection });
                    return;
                }
                for (const child of node.childNodes)
                    walk(child);
                if (/^(DIV|P)$/.test(node.tagName))
                    tokens.push({ t: 'text', v: '\n' });
            };
            for (const child of editorEl.childNodes)
                walk(child);
            return tokens;
        },

        /**
         * importContent(tokens): rebuild editor content from an exportContent() token list (cold restore).
         * Boundary: must be called after render(); appends text and reference chips in order, preserving their original
         * sequence; degrades safely for a non-array or empty input.
         *
         * @param {Array<Record<string, unknown>>} tokens Ordered content tokens exported by exportContent().
         * @returns {void}
         */
        importContent(tokens) {
            if (!editorEl || !Array.isArray(tokens))
                return;
            for (const token of tokens) {
                if (token?.t === 'text' && token.v) {
                    const range = endRange();
                    const node = document.createTextNode(token.v);
                    range.insertNode(node);
                    const after = document.createRange();
                    after.setStartAfter(node);
                    after.collapse(true);
                    savedRange = after.cloneRange();
                }
                else if (token?.t === 'ref' && token.label && token.selection) {
                    this.insertReference({ label: token.label, selection: token.selection });
                }
            }
            refreshEmptyState();
        },

        /**
         * setDisabled(disabled): disable editing while busy (resolving/sending) so content cannot change mid-send.
         * @param {boolean} disabled Whether to disable.
         */
        setDisabled(disabled) {
            if (!editorEl)
                return;
            editorEl.setAttribute('contenteditable', disabled ? 'false' : 'true');
            editorEl.classList.toggle('cii-editor-disabled', Boolean(disabled));
        },

        /**
         * reset(): clear this dialog's editor state (text, references, primary, caret cache).
         * Boundary: only resets memory and (if present) the DOM; a new dialog must setPrimary again after render.
         */
        reset() {
            primary = null;
            savedRange = null;
            refSeq = 0;
            selections.clear();
            if (editorEl)
                editorEl.innerHTML = '';
            renderPinned();
            refreshEmptyState();
        },
    };
}
