/**
 * DIALOG_EDITOR_STYLE_TEXT: layout of the dialog's intent field (the pinned context-chip row and the contenteditable
 * editor under it).
 *
 * Purpose: gives the `.cii-field`, `.cii-editor-pinned`, and `.cii-editor` nodes built by `createDialogEditor` their
 * layout, placeholder, and disabled look. The chips inside them are styled by `DIALOG_REFERENCE_STYLE_TEXT`.
 * Boundary: `installDialogReferenceStyle` installs this text ahead of the mention rules, inside the plugin shadow root
 * after `STYLE_TEXT`, because it reads the design tokens declared there; used alone every `var()` is unresolved.
 * It must stay a plain exported template listed in the build's CSS-template modules, or the client build leaves it
 * unminified.
 *
 * @type {string} CSS text installed ahead of the mention rules.
 */
export const DIALOG_EDITOR_STYLE_TEXT = `
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
`;
