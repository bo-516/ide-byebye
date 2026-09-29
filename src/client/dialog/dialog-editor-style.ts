/**
 * DIALOG_EDITOR_STYLE_TEXT: layout of the dialog's intent field (the pinned context-chip row and the contenteditable
 * editor under it).
 *
 * Purpose: gives the `.cii-field`, `.cii-editor-pinned`, and `.cii-editor` nodes built by `createDialogEditor` their
 * layout, placeholder, and disabled look. The editor is a visible input well: outlined in the light theme, sunken in
 * the dark one, with a firmer neutral edge and shadow while focused. Without the well, the placeholder read as a
 * caption under the context chip and users missed that they could type there. The chips inside the field are styled
 * by `DIALOG_REFERENCE_STYLE_TEXT`.
 * Boundary: `installDialogReferenceStyle` installs this text ahead of the mention rules, inside the plugin shadow root
 * after `STYLE_TEXT`, because it reads the design tokens declared there (the well colours are the `--cii-field*`
 * group); used alone every `var()` is unresolved.
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
/* The contenteditable is the well itself, so :focus needs no wrapper. The edge is a real border, not an inset shadow,
   because overflow clips inside the border and scrolled text therefore never paints over the edge. */
.cii-editor {
  position: relative;
  min-height: 76px;
  max-height: 240px;
  margin-top: 8px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 10px 12px;
  border: 1px solid var(--cii-field-line);
  border-radius: 12px;
  background: var(--cii-field);
  color: var(--cii-text);
  caret-color: var(--cii-accent);
  font: 15px/1.6 var(--cii-font);
  outline: 0;
  cursor: text;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  scrollbar-width: thin;
  scrollbar-color: var(--cii-line-strong) transparent;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.cii-editor:not(.cii-editor-disabled):hover {
  border-color: var(--cii-field-line-hover);
}
/* Focus is neutral (firmer edge, light lift or dark inset); the accent is left to the caret. Forced-colours mode drops
   the shadow and paints the otherwise invisible transparent outline instead, so focus stays visible there. */
.cii-editor:not(.cii-editor-disabled):focus {
  border-color: var(--cii-field-line-focus);
  box-shadow: var(--cii-field-shadow-focus);
  outline: 2px solid transparent;
  outline-offset: 2px;
}
/* Without a context chip (a cold restore that lost its selection) the well still starts where it would below the chip
   row (28px row + 8px gap), so the header controls keep that row instead of sitting on the well's top edge. */
.cii-editor-pinned[hidden] + .cii-editor {
  margin-top: 36px;
}
.cii-editor.cii-editor-empty::before {
  content: attr(data-placeholder);
  position: absolute;
  top: 10px;
  left: 12px;
  right: 12px;
  color: var(--cii-text-faint);
  pointer-events: none;
  white-space: pre-wrap;
}
.cii-editor-disabled {
  opacity: 0.55;
  cursor: default;
}
`;
