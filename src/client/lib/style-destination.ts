/**
 * Destination picker: the quiet trigger beside Send ("where the prompt goes") and its "Send to" menu.
 *
 * Boundary: the menu reuses the dropdown shell from TOOLS_STYLE (`.cii-screenshot-menu`), so this must be composed
 * after it. Each row is a flex container of a main button (choose) and, for agents that list sessions, a trailing
 * button (open sessions); hover and keyboard highlight paint the whole row so the two read as one item. Destination
 * kinds (`data-kind`) only swap the icon mask. `[hidden]` rules must beat the flex displays here, or a page without
 * destinations would still show an empty trigger.
 * @type {string} CSS fragment composed into the shadow-root stylesheet after TOOLS_STYLE.
 */
export const DESTINATION_STYLE = `
.cii-agent-picker { position: relative; min-width: 0; }
.cii-agent-picker[hidden] { display: none; }
.cii-agent-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 300px;
  height: 32px;
  padding: 0 7px 0 9px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--cii-text-muted);
  font: 500 13px/1 var(--cii-font);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.cii-agent-pill:hover:not(:disabled),
.cii-agent-picker:has(> .cii-agent-menu:not([hidden])) > .cii-agent-pill { background: var(--cii-fill); color: var(--cii-text); }
.cii-agent-pill:disabled { opacity: 0.5; cursor: default; }
.cii-agent-pill-label { flex: none; white-space: nowrap; }
.cii-agent-pill-session {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--cii-text-faint);
  font-weight: 400;
}
.cii-agent-pill-session::before { content: "/"; margin-right: 7px; opacity: 0.7; }
.cii-agent-pill-session[hidden] { display: none; }
.cii-agent-pill-caret {
  flex: none;
  width: 14px;
  height: 14px;
  background: currentColor;
  opacity: 0.6;
  -webkit-mask: var(--cii-mask-chevron-down);
  mask: var(--cii-mask-chevron-down);
}
.cii-agent-pill-unavailable { color: var(--cii-text-faint); }
.cii-agent-pill-unavailable .cii-agent-kind { color: var(--cii-warning); }

.cii-agent-kind {
  flex: none;
  width: 16px;
  height: 16px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-app);
  mask: var(--cii-mask-app);
}
.cii-agent-kind[data-kind="ide"] { -webkit-mask: var(--cii-mask-ide); mask: var(--cii-mask-ide); }
.cii-agent-kind[data-kind="terminal"] { -webkit-mask: var(--cii-mask-terminal); mask: var(--cii-mask-terminal); }
.cii-agent-kind[data-kind="custom"] { -webkit-mask: var(--cii-mask-custom); mask: var(--cii-mask-custom); }

.cii-screenshot-menu.cii-agent-menu { width: 280px; padding: 6px; }
.cii-menu-caption { padding: 6px 8px 8px; color: var(--cii-text-faint); font: 600 11.5px/1.2 var(--cii-font); }
.cii-agent-row { display: flex; align-items: stretch; border-radius: 8px; }
.cii-agent-row:hover,
.cii-agent-row-active { background: var(--cii-fill); }
.cii-agent-row-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--cii-text);
  text-align: left;
  cursor: pointer;
}
.cii-agent-row-main .cii-agent-kind { color: var(--cii-text-muted); }
.cii-agent-row-selected .cii-agent-row-main .cii-agent-kind { color: var(--cii-accent); }
.cii-agent-row-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.cii-agent-row-label,
.cii-agent-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cii-agent-row-label { font: 500 13px/1.3 var(--cii-font); }
.cii-agent-row-sub { color: var(--cii-text-faint); font: 12px/1.3 var(--cii-font); }
.cii-agent-row-session { color: var(--cii-accent-text); }
.cii-agent-row-session::before {
  content: "";
  display: inline-block;
  width: 11px;
  height: 11px;
  margin-right: 4px;
  vertical-align: -1px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-corner-down-right);
  mask: var(--cii-mask-corner-down-right);
}
.cii-agent-row-unavailable .cii-agent-row-label { color: var(--cii-text-muted); }
.cii-agent-row-unavailable .cii-agent-row-main .cii-agent-kind { opacity: 0.5; }
.cii-agent-row-check { flex: none; width: 16px; height: 16px; }
.cii-agent-row-selected .cii-agent-row-check {
  background: var(--cii-accent);
  -webkit-mask: var(--cii-mask-check);
  mask: var(--cii-mask-check);
}
.cii-agent-row-sessions {
  flex: none;
  width: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 0 8px 8px 0;
  background: transparent;
  color: var(--cii-text-faint);
  cursor: pointer;
}
.cii-agent-row-sessions::before {
  content: "";
  width: 15px;
  height: 15px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-chevron-right);
  mask: var(--cii-mask-chevron-right);
}
.cii-agent-row-sessions:hover { background: var(--cii-fill-strong); color: var(--cii-text); }
`;
