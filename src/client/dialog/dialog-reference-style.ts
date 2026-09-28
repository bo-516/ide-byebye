/**
 * DIALOG_REFERENCE_STYLE_TEXT: source-owned styles for the dialog mention editor.
 *
 * Purpose: turns the intent field into a borderless composer: the click-selected element is a pinned, non-removable
 * context chip (dimmed directory, emphasized file name, line-range tag) and supplementary `@code` references are inline
 * atomic mentions (file name + range only; the full path stays in the chip's title) that keep their position in the
 * typed text.
 * Boundary: this stylesheet must be appended after `STYLE_TEXT` inside the plugin shadow root, because it reads the
 * design tokens and icon masks declared there; installing it elsewhere has no effect, and installing it alone leaves
 * every `var()` unresolved. The `.cii-mention-*` part classes come from `createMentionElement` in `dialog-editor`.
 *
 * @type {string} CSS text appended to the plugin shadow root.
 */
export const DIALOG_REFERENCE_STYLE_TEXT = `
.cii-field {
  position: relative;
  flex: 1 1 100%;
  min-width: 0;
}
.cii-editor-pinned {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-height: 96px;
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 60px;
  scrollbar-width: thin;
}
.cii-editor-pinned[hidden] {
  display: none;
}
.cii-editor {
  position: relative;
  min-height: 76px;
  max-height: 240px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 10px 2px 4px;
  color: var(--cii-text);
  caret-color: var(--cii-accent);
  font: 15px/1.6 var(--cii-font);
  outline: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  scrollbar-width: thin;
  scrollbar-color: var(--cii-line-strong) transparent;
}
/* Without a context chip (a cold restore that lost its selection) the first line would run under the header controls. */
.cii-editor-pinned[hidden] + .cii-editor {
  padding-right: 64px;
}
.cii-editor.cii-editor-empty::before {
  content: attr(data-placeholder);
  position: absolute;
  top: 10px;
  left: 2px;
  right: 2px;
  color: var(--cii-text-faint);
  pointer-events: none;
  white-space: pre-wrap;
}
.cii-editor-disabled {
  opacity: 0.55;
  cursor: default;
}

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
  background: var(--cii-surface-sunken);
  box-shadow: inset 0 0 0 1px var(--cii-line);
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
 * Install the dialog reference attachment stylesheet into a UI root.
 *
 * Purpose: applies the composer and mention treatment after the base shadow-root styles are installed.
 * Boundary: `root` must support `appendChild`; passing `null`, an ordinary object, or a detached value without that
 * method skips installation and the dialog falls back to unstyled editor and chip markup.
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
