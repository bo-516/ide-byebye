/**
 * DIALOG_REFERENCE_STYLE_TEXT: source-owned styles for the dialog mention editor.
 *
 * Purpose: turns the intent field into a lightweight tiptap-style contenteditable where the click-selected element is a
 * pinned, non-removable chip and supplementary `@code` references are inline atomic mentions that keep their position in
 * the typed text.
 * Boundary: this stylesheet must be appended after `STYLE_TEXT` inside the plugin shadow root; installing it elsewhere
 * has no effect, and installing it before the base rules lets the old textarea borders win.
 *
 * @type {string} CSS text appended to the plugin shadow root.
 */
export const DIALOG_REFERENCE_STYLE_TEXT = `
.cii-field {
  overflow: hidden;
  border: 1px solid var(--cii-color-textarea-border);
  border-radius: 12px;
  background: var(--cii-color-textarea-surface);
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.cii-field:focus-within {
  border-color: var(--cii-color-textarea-border-focus);
  box-shadow: var(--cii-shadow-textarea-focus);
}
.cii-editor-pinned {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 96px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 12px 14px 2px;
  scrollbar-width: thin;
}
.cii-editor-pinned[hidden] {
  display: none;
}
.cii-editor {
  position: relative;
  min-height: 96px;
  max-height: 220px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 12px 16px;
  color: var(--cii-color-textarea-text);
  font: 15px/1.6 system-ui, sans-serif;
  outline: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  scrollbar-width: thin;
}
.cii-editor-pinned:not([hidden]) + .cii-editor {
  min-height: 76px;
  padding-top: 8px;
}
.cii-editor.cii-editor-empty::before {
  content: attr(data-placeholder);
  position: absolute;
  top: 12px;
  left: 16px;
  right: 16px;
  color: var(--cii-color-textarea-placeholder);
  pointer-events: none;
  white-space: pre-wrap;
}
.cii-editor-disabled {
  opacity: 0.6;
  cursor: default;
}
.cii-mention {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  margin: 0 1px;
  padding: 1px 5px 1px 7px;
  border-radius: 6px;
  background: rgba(20, 121, 201, 0.10);
  color: #1366aa;
  font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  vertical-align: baseline;
  white-space: nowrap;
  user-select: none;
  cursor: default;
}
.cii-mention-icon {
  width: 11px;
  height: 13px;
  flex: 0 0 auto;
  position: relative;
  border: 1.5px solid currentColor;
  border-radius: 2px;
}
.cii-mention-icon::after {
  content: "";
  position: absolute;
  top: -1.5px;
  right: -1.5px;
  width: 4px;
  height: 4px;
  border-left: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  background: var(--cii-color-textarea-surface);
}
.cii-mention-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cii-mention-remove {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: currentColor;
  cursor: pointer;
  font: 14px/1 system-ui, sans-serif;
  opacity: 0.65;
}
.cii-mention-remove:hover {
  background: rgba(20, 121, 201, 0.18);
  opacity: 1;
}
.cii-editor-pinned .cii-mention,
.cii-mention-static {
  width: 100%;
  max-width: 100%;
  margin: 0;
  padding: 4px 6px;
  border-radius: 6px;
  background: transparent;
  color: #1479c9;
  font-size: 14px;
  white-space: nowrap;
  cursor: default;
}
.cii-editor-pinned .cii-mention:hover {
  background: #f3f7fb;
}
.cii-editor-pinned .cii-mention-icon {
  width: 14px;
  height: 17px;
  border-radius: 3px;
}
.cii-editor-pinned .cii-mention-text {
  flex: 1 1 auto;
}
`;

/**
 * Install the dialog reference attachment stylesheet into a UI root.
 *
 * Purpose: applies the Codex-like source attachment treatment after the base shadow-root styles are installed.
 * Boundary: `root` must support `appendChild`; passing `null`, an ordinary object, or a detached value without that
 * method skips installation and the dialog falls back to the base textarea and chip styles.
 *
 * @param {ShadowRoot | Element | null | undefined} root UI root that receives the supplemental style element.
 * @returns {HTMLStyleElement | null} The appended style element, or `null` when `root` cannot receive children.
 */
export function installDialogReferenceStyle(root) {
    if (!root || typeof root.appendChild !== 'function') {
        return null;
    }

    const style = document.createElement('style');
    style.textContent = DIALOG_REFERENCE_STYLE_TEXT;
    root.appendChild(style);
    return style;
}
