import { DIALOG_EDITOR_STYLE_TEXT } from './dialog-editor-style.js';

/**
 * DIALOG_REFERENCE_STYLE_TEXT: source-owned styles for the dialog's mention chips.
 *
 * Purpose: the click-selected element is a pinned, non-removable context chip (dimmed directory, emphasized file name,
 * line-range tag) and supplementary `@code` references are inline atomic mentions (file name + range only; the full
 * path stays in the chip's title) that keep their position in the typed text.
 * Boundary: `installDialogReferenceStyle` appends this after `DIALOG_EDITOR_STYLE_TEXT`, inside the plugin shadow root
 * after `STYLE_TEXT`, because it reads the design tokens and icon masks declared there; installing it elsewhere has no
 * effect, and installing it alone leaves every `var()` unresolved. The `.cii-mention-*` part classes come from
 * `createMentionElement` in `dialog-editor`.
 *
 * @type {string} CSS text appended to the plugin shadow root.
 */
export const DIALOG_REFERENCE_STYLE_TEXT = `
.cii-mention {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  margin: 0 1px;
  padding: 0 3px 0 5px;
  border-radius: 6px;
  background: var(--cii-accent-soft);
  color: var(--cii-accent-text);
  font: 500 13.5px/1.55 var(--cii-font);
  vertical-align: bottom;
  white-space: nowrap;
  user-select: none;
  cursor: default;
}
.cii-mention-icon {
  flex: none;
  width: 13px;
  height: 13px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-code);
  mask: var(--cii-mask-code);
}
.cii-mention-text {
  display: inline-flex;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.cii-mention-dir {
  display: none;
}
.cii-mention-file {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cii-mention-range {
  flex: none;
  font: 500 11px/1 var(--cii-mono);
  opacity: 0.75;
}
.cii-mention-remove {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: currentColor;
  font-size: 0;
  cursor: pointer;
  opacity: 0.6;
}
.cii-mention-remove::before {
  content: "";
  width: 10px;
  height: 10px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-x);
  mask: var(--cii-mask-x);
}
.cii-mention-remove:hover {
  background: var(--cii-accent-soft);
  opacity: 1;
}

/* Context chip: the element this intent is about. The directory gives way first so the file name survives truncation. */
.cii-editor-pinned .cii-mention {
  height: 28px;
  margin: 0;
  padding: 0 5px 0 8px;
  gap: 7px;
  border-radius: 8px;
  background: var(--cii-fill);
  color: var(--cii-text);
  font: 500 12.5px/1 var(--cii-font);
}
.cii-editor-pinned .cii-mention-icon {
  width: 14px;
  height: 14px;
  color: var(--cii-accent);
}
.cii-editor-pinned .cii-mention-dir {
  display: block;
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--cii-text-faint);
  font-weight: 400;
}
/* The file name never shrinks (any shrink, even sub-pixel, would trigger its ellipsis) unless it alone is too wide. */
.cii-editor-pinned .cii-mention-file {
  flex: none;
  max-width: 100%;
}
.cii-editor-pinned .cii-mention-range {
  padding: 4px 5px;
  border-radius: 5px;
  background: var(--cii-fill);
  color: var(--cii-text-muted);
  opacity: 1;
}
`;

/**
 * Install the dialog's intent-field stylesheet (editor layout, then mention chips) into a UI root.
 *
 * Purpose: applies the editor and mention treatment after the base shadow-root styles are installed.
 * Boundary: the editor rules go first and the mention rules second, in one style element. `root` must support
 * `appendChild`; passing `null`, an ordinary object, or a detached value without that method skips installation and
 * the dialog falls back to unstyled editor and chip markup.
 *
 * @param {ShadowRoot | Element | null | undefined} root UI root that receives the supplemental style element.
 * @returns {HTMLStyleElement | null} The appended style element, or `null` when `root` cannot receive children.
 */
export function installDialogReferenceStyle(root: ShadowRoot | Element | null | undefined): HTMLStyleElement | null {
    if (!root || typeof root.appendChild !== 'function') {
        return null;
    }

    const style = document.createElement('style');
    style.textContent = DIALOG_EDITOR_STYLE_TEXT + DIALOG_REFERENCE_STYLE_TEXT;
    root.appendChild(style);
    return style;
}
