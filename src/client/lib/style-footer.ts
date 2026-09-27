/**
 * Footer layout and shared action-button presentation inside the inspector shadow root.
 * Boundary: copy occupies its own grid row; app cells keep equal, label-independent widths. Container queries
 * reduce the column count on narrow dialogs without shrinking labels or changing the order of configured agents.
 * Both copy labels remain in the same cell so confirmation cannot resize the footer. Requires the dialog's
 * inline-size container from SESSION_PICKER_STYLE; without it, narrow layouts retain three columns.
 * @type {string} CSS composed into STYLE_TEXT before session-control overrides.
 */
export const FOOTER_STYLE = `
.cii-footer {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  flex: 0 0 auto;
  gap: 12px;
  padding: 12px 18px 16px;
  border-top: 1px solid #e0e3e5;
  background: #f7f9fb;
  border-radius: 0 0 12px 12px;
}
.cii-btn {
  font: 600 13px/1.3 system-ui, sans-serif;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.cii-btn:disabled { opacity: 0.5; cursor: default; }
.cii-btn:focus-visible, .cii-session-caret:focus-visible {
  position: relative;
  z-index: 1;
  outline: 2px solid #0058be;
  outline-offset: 3px;
}
.cii-btn-secondary { background: transparent; color: #505f76; border-color: transparent; }
.cii-btn-secondary:hover:not(:disabled) { background: #f2f4f6; }
.cii-btn-primary { background: #0058be; color: #fff; }
.cii-btn-primary:hover:not(:disabled) { background: #0966d1; }
.cii-btn-primary:active:not(:disabled) { background: #004a9f; }
.cii-action-buttons {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 196px));
  justify-content: center;
  gap: 8px;
  width: 100%;
}
.cii-action-buttons:empty { display: none; }
.cii-footer-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.cii-agent-action {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 38px;
  white-space: nowrap;
}
/* The remembered-agent marker is out of flow so switching the Enter target never moves a label or a grid cell. */
.cii-agent-last::after {
  content: "";
  position: absolute;
  right: 6px;
  top: 6px;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.85;
}
.cii-agent-clipboard {
  grid-column: 1 / -1;
  display: inline-grid;
  place-items: center;
  margin-bottom: 4px;
  background: #fff;
  color: #475569;
  border-color: #dce2e9;
}
.cii-agent-clipboard:hover:not(:disabled) { background: #f0f5fc; border-color: #b8cce7; color: #0058be; }
.cii-agent-clipboard:active:not(:disabled) { background: #e8f0fb; }
.cii-copy-label { grid-area: 1 / 1; display: inline-flex; align-items: center; gap: 8px; }
.cii-copy-idle::before {
  content: "";
  width: 10px;
  height: 11px;
  margin: 2px 0 0 2px;
  border: 1.4px solid currentColor;
  border-radius: 2px;
  box-shadow: -3px -3px 0 -1px #fff, -3px -3px 0 0 currentColor;
}
.cii-copy-done,
.cii-agent-copied > .cii-copy-idle { visibility: hidden; }
.cii-agent-copied > .cii-copy-done { visibility: visible; }
.cii-agent-clipboard.cii-agent-copied,
.cii-agent-clipboard.cii-agent-copied:hover:not(:disabled) {
  color: #15803d; border-color: #bbdec8; background: #f4fbf6;
}
.cii-agent-unavailable { background: #64748b; }
.cii-agent-unavailable:hover:not(:disabled) { background: #475569; }
@container (max-width: 539px) {
  .cii-action-buttons { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container (max-width: 359px) {
  .cii-action-buttons { grid-template-columns: minmax(0, 1fr); }
}
`;
