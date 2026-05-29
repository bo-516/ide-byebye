/**
 * DIALOG_REFERENCE_STYLE_TEXT: source-owned styles for dialog code-reference attachments.
 *
 * Purpose: makes normal intent-dialog references look and behave like Codex composer attachments while leaving the
 * base stylesheet and generated bundle untouched.
 * Boundary: this stylesheet must be appended after `STYLE_TEXT` inside the plugin shadow root; installing it elsewhere
 * has no effect, and installing it before the base rules lets the old textarea/chip borders win.
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
.cii-field .cii-textarea {
  min-height: 112px;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.cii-field .cii-textarea:focus {
  border-color: transparent;
  box-shadow: none;
}
.cii-field-has-references .cii-textarea {
  min-height: 92px;
  padding-top: 10px;
}
.cii-field .cii-reference-preview {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 96px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 14px 16px 0;
  scrollbar-width: thin;
}
.cii-field .cii-reference-preview[hidden] {
  display: none;
}
.cii-field .cii-code-ref-chip {
  width: 100%;
  max-width: 100%;
  min-height: 28px;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #1479c9;
  padding: 2px 4px;
  opacity: 1;
}
.cii-field .cii-code-ref-chip:hover {
  background: #f3f7fb;
}
.cii-reference-file-icon {
  width: 15px;
  height: 18px;
  flex: 0 0 auto;
  position: relative;
  border: 1.5px solid currentColor;
  border-radius: 3px;
}
.cii-reference-file-icon::after {
  content: "";
  position: absolute;
  top: -1.5px;
  right: -1.5px;
  width: 5px;
  height: 5px;
  border-left: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  background: var(--cii-color-textarea-surface);
}
.cii-field .cii-code-ref-link {
  flex: 1 1 auto;
  min-width: 0;
  max-width: none;
  overflow: hidden;
  padding: 0;
  border: 0;
  background: transparent;
  color: currentColor;
  cursor: default;
  font: 15px/22px ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: left;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cii-field .cii-code-ref-remove {
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #424754;
  cursor: pointer;
  font: 18px/1 system-ui, sans-serif;
  opacity: 0.62;
}
.cii-field .cii-code-ref-remove:hover {
  background: #e8eef6;
  color: #191c1e;
  opacity: 1;
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
