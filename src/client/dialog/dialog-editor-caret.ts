/**
 * Caret and selection tracking for the intent editor's contenteditable.
 *
 * Purpose: keeps the live `editorEl`/`savedRange` pair in one place so the editor can focus, restore,
 * or re-insert at the last caret even after the DOM was rebuilt.
 *
 * Boundary: `savedRange` is the last Range that fell inside the editor; `editorEl` is swapped on every
 * render (the dialog rebuilds the DOM), and the getter/setter properties keep the closed-over state
 * authoritative.
 */

/** The caret state and its operations as consumed by {@link createDialogEditor}. */
export interface EditorCaret {
    editorEl: HTMLElement | null;
    savedRange: Range | null;
    resolveSelectionRoot(): Node & { getSelection?: () => Selection | null };
    readRange(): Range | null;
    endRange(): Range;
    trackRange(): void;
    focusEditor(caretRange: Range | null | undefined): void;
}

/**
 * createEditorCaret(): build the caret tracker for one editor instance.
 *
 * @returns {EditorCaret} Tracker object; assign `editorEl` on every render before using the range helpers.
 */
export function createEditorCaret(): EditorCaret {
    let editorEl: HTMLElement | null = null;
    let savedRange: Range | null = null;

    // `getRootNode()` is typed as `Node`, which has no `getSelection`. The cast only restores the runtime check below.
    const resolveSelectionRoot = () => (editorEl?.getRootNode?.() ?? document) as Node & { getSelection?: () => Selection | null };

    /**
     * readRange(): read the caret Range currently inside the contenteditable.
     * Boundary: under shadow DOM it prefers root.getSelection(), falling back to window.getSelection(); returns null when
     * the caret is not inside the editor.
     * @returns {Range | null} A clone of the caret range, or null when the selection is elsewhere.
     */
    const readRange = (): Range | null => {
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

    /** Caret at the end of the editor. Assumes `editorEl` is set; callers check that before using the range. */
    const endRange = (): Range => {
        const range = document.createRange();
        range.selectNodeContents(editorEl as HTMLElement);
        range.collapse(false);
        return range;
    };

    const trackRange = () => {
        const range = readRange();
        if (range)
            savedRange = range;
    };

    /** @param {Range | null | undefined} caretRange Range to restore. Omitted or null leaves the browser's caret. */
    const focusEditor = (caretRange: Range | null | undefined) => {
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

    return {
        get editorEl() {
            return editorEl;
        },
        set editorEl(el) {
            editorEl = el;
        },
        get savedRange() {
            return savedRange;
        },
        set savedRange(range) {
            savedRange = range;
        },
        resolveSelectionRoot,
        readRange,
        endRange,
        trackRange,
        focusEditor,
    };
}
