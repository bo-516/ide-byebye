/**
 * Editor content serialization for the intent dialog.
 *
 * Purpose: two pure-ish walkers shared by the editor's `serialize()` (flatten to prompt text),
 * `exportContent()` (ordered token list for cold restore), and `importContent()`'s counterpart.
 *
 * Boundary: reads DOM nodes and the editor's `selections` map; mutates only the `refs`/`tokens`
 * out-params. An orphaned chip that lost its selection contributes nothing.
 */

/**
 * Selection stored beside a mention. The editor only reads `inspPath`; the index signature matches the dialog's
 * `ElementSelection` so a picked element can be stored and handed back without a cast.
 */
export interface EditorSelection {
    inspPath?: string;
    [key: string]: unknown;
}

/** One ordered piece of editor content. `text` keeps raw characters; `ref` keeps the chip and its selection. */
export type EditorToken = { t: 'text'; v: string } | { t: 'ref'; label: string; selection: EditorSelection };

/**
 * serializeEditorNode(node, refs, selections): recursively turn one DOM node into prompt text, collecting reference
 * selections in order.
 * Boundary: a mention chip is restored to `@label` with surrounding spaces; <br>/block elements become newlines; an
 * orphaned chip that lost its selection is skipped.
 *
 * @param {Node} node DOM node inside the contenteditable.
 * @param {EditorSelection[]} refs Selection list appended in appearance order. Mutated; not copied.
 * @param {Map<string, EditorSelection>} selections refId → selection map owned by the editor.
 * @returns {string} Prompt text for this node, or '' when the node contributes nothing.
 */
export function serializeEditorNode(node: Node, refs: EditorSelection[], selections: Map<string, EditorSelection>): string {
    if (node.nodeType === Node.TEXT_NODE)
        return (node as Text).data;
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
        text += serializeEditorNode(child, refs, selections);
    // Some browsers wrap a new line in a <div>/<p> inside contenteditable, so add a newline boundary.
    if (/^(DIV|P)$/.test(node.tagName))
        text += '\n';
    return text;
}

/**
 * appendEditorTokens(node, tokens, selections): recursively append one DOM node's ordered content tokens.
 * Boundary: text nodes and <br>/block boundaries become `text` tokens; a mention chip with a live
 * selection becomes a `ref` token; orphaned chips are skipped.
 *
 * @param {Node} node DOM node inside the contenteditable.
 * @param {EditorToken[]} tokens Token list appended in order. Mutated; not copied.
 * @param {Map<string, EditorSelection>} selections refId → selection map owned by the editor.
 * @returns {void}
 */
export function appendEditorTokens(node: Node, tokens: EditorToken[], selections: Map<string, EditorSelection>): void {
    if (node.nodeType === Node.TEXT_NODE) {
        const text = (node as Text).data;
        if (text)
            tokens.push({ t: 'text', v: text });
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
        appendEditorTokens(child, tokens, selections);
    if (/^(DIV|P)$/.test(node.tagName))
        tokens.push({ t: 'text', v: '\n' });
}
