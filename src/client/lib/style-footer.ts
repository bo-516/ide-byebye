/**
 * Footer layout: the toolbar row (capture tools + Copy), the hand-off tray of agent keys, and shared buttons.
 *
 * Boundary: the tray is an auto-fit grid, so agent keys keep equal, label-independent widths and drop from three
 * columns to two or one as the dialog narrows without reordering. The Enter target (`.cii-agent-last`) is the only
 * filled key; its `↵` hint is inline, so switching targets shifts that key's label but never a grid cell. Both Copy
 * labels share one grid cell so the confirmation cannot resize the toolbar, and below 460px the button collapses to
 * its icon; that query needs the dialog's inline-size container from SESSION_PICKER_STYLE, without which Copy keeps
 * its label and wraps. Container-level key states use `:has()`; browsers without it still get the filled/dimmed button,
 * only the key's outer ring stays neutral. Requires the tokens and icon masks.
 * @type {string} CSS composed into STYLE_TEXT before session-control overrides.
 */
export const FOOTER_STYLE = `
.cii-footer {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
}
.cii-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 2px 12px 12px;
}
.cii-footer-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  min-width: 0;
}

.cii-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: 0;
  border-radius: 10px;
  font: 500 13px/1 var(--cii-font);
  white-space: nowrap;
  cursor: pointer;
  transition: background 120ms ease, box-shadow 120ms ease, color 120ms ease, opacity 120ms ease;
}
.cii-btn:disabled { opacity: 0.5; cursor: default; }
.cii-btn-primary {
  background: linear-gradient(180deg, var(--cii-ink-top), var(--cii-ink));
  color: var(--cii-on-ink);
  box-shadow: var(--cii-shadow-ink);
}
.cii-btn-primary:hover:not(:disabled) { background: var(--cii-ink-hover); }
.cii-btn-secondary { background: var(--cii-key); color: var(--cii-text); box-shadow: var(--cii-shadow-key); }
.cii-btn-secondary:hover:not(:disabled) { box-shadow: var(--cii-shadow-key-hover); }

.cii-agent-clipboard {
  display: inline-grid;
  place-items: center;
  height: 32px;
  margin-left: auto;
  padding: 0 12px 0 10px;
  border-radius: 9px;
  background: transparent;
  color: var(--cii-text-muted);
  box-shadow: inset 0 0 0 1px var(--cii-line-strong);
  font-size: 12.5px;
}
.cii-agent-clipboard:hover:not(:disabled) { background: var(--cii-fill); color: var(--cii-text); }
.cii-agent-clipboard:active:not(:disabled) { background: var(--cii-fill-strong); }
.cii-copy-label { grid-area: 1 / 1; display: inline-flex; align-items: center; gap: 7px; }
.cii-copy-label::before {
  content: "";
  flex: none;
  width: 14px;
  height: 14px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-copy);
  mask: var(--cii-mask-copy);
}
.cii-copy-done::before { -webkit-mask: var(--cii-mask-check); mask: var(--cii-mask-check); }
.cii-copy-done,
.cii-agent-copied > .cii-copy-idle { visibility: hidden; }
.cii-agent-copied > .cii-copy-done { visibility: visible; }
.cii-agent-clipboard.cii-agent-copied,
.cii-agent-clipboard.cii-agent-copied:hover:not(:disabled) {
  color: var(--cii-success);
  background: var(--cii-success-soft);
  box-shadow: inset 0 0 0 1px var(--cii-success-line);
}
/* A narrow panel keeps the toolbar on one row by collapsing Copy to its icon; the title still names the action. */
@container (max-width: 459px) {
  .cii-agent-clipboard { width: 32px; padding: 0; }
  .cii-copy-label { gap: 0; font-size: 0; }
}
/* Clipboard-only setups have no hand-off tray, so Copy is the one primary action left. */
.cii-footer:has(> .cii-action-buttons:empty) .cii-agent-clipboard:not(.cii-agent-copied) {
  background: linear-gradient(180deg, var(--cii-ink-top), var(--cii-ink));
  color: var(--cii-on-ink);
  box-shadow: var(--cii-shadow-ink);
}

.cii-action-buttons {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
  gap: 8px;
  padding: 12px;
  background: var(--cii-surface-sunken);
  border-top: 1px solid var(--cii-line);
  border-radius: 0 0 18px 18px;
}
.cii-action-buttons:empty { display: none; }
.cii-agent-split {
  position: relative;
  display: flex;
  align-items: stretch;
  min-width: 0;
  height: 38px;
  border-radius: 10px;
  background: var(--cii-key);
  box-shadow: var(--cii-shadow-key);
  transition: box-shadow 140ms ease, background 140ms ease;
}
.cii-agent-split:hover { box-shadow: var(--cii-shadow-key-hover); }
.cii-agent-split > .cii-agent-action {
  position: relative;
  display: block;
  flex: 1 1 auto;
  min-width: 0;
  height: auto;
  padding: 0 12px;
  border-radius: 10px;
  background: transparent;
  color: var(--cii-text);
  overflow: hidden;
  text-overflow: ellipsis;
}
.cii-agent-split-on > .cii-agent-action { border-radius: 10px 0 0 10px; }
.cii-agent-split > .cii-agent-action:hover:not(:disabled) { background: var(--cii-fill); }
.cii-agent-split > .cii-agent-action:active:not(:disabled) { background: var(--cii-fill-strong); }
.cii-agent-split > .cii-agent-action:focus-visible { z-index: 1; }

.cii-agent-split:has(> .cii-agent-last) { background: var(--cii-ink); box-shadow: var(--cii-shadow-ink); }
.cii-agent-split > .cii-agent-action.cii-agent-last {
  background: linear-gradient(180deg, var(--cii-ink-top), var(--cii-ink));
  color: var(--cii-on-ink);
}
.cii-agent-split > .cii-agent-action.cii-agent-last:hover:not(:disabled) { background: var(--cii-ink-hover); }
.cii-agent-last::after {
  content: "↵";
  display: inline-block;
  min-width: 18px;
  height: 18px;
  margin-left: 8px;
  padding: 0 4px;
  border-radius: 5px;
  background: var(--cii-on-ink-soft);
  font: 600 11px/18px var(--cii-font);
  text-align: center;
  vertical-align: 1px;
}

.cii-agent-split:has(> .cii-agent-unavailable) {
  background: transparent;
  box-shadow: none;
  outline: 1px dashed var(--cii-line-strong);
  outline-offset: -1px;
}
.cii-agent-split > .cii-agent-action.cii-agent-unavailable { color: var(--cii-text-faint); }
.cii-agent-split > .cii-agent-action.cii-agent-last.cii-agent-unavailable {
  background: var(--cii-fill);
  color: var(--cii-text-muted);
}
.cii-agent-split > .cii-agent-action.cii-agent-last.cii-agent-unavailable:hover:not(:disabled) {
  background: var(--cii-fill-strong);
}
.cii-agent-last.cii-agent-unavailable::after { background: var(--cii-fill-strong); }
`;
