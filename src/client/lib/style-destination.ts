/**
 * Destination picker: the quiet trigger beside Send ("where the prompt goes") and its "Send to" menu.
 *
 * Boundary: the menu reuses the dropdown shell from TOOLS_STYLE (`.cii-screenshot-menu`), so this must be composed
 * after it. Each row is a flex container of a main button (choose) and, for agents that list sessions, a trailing
 * button (open sessions); hover and keyboard highlight paint the whole row so the two read as one item. The trailing
 * button keeps the full row height as its hit area but draws a small chip behind its chevron (`::before`, with the
 * chevron in `::after`), so it still reads as a control of its own on a row that is not highlighted. Destination
 * kinds (`data-kind`) swap the generic glyph; brand marks per agent (`data-agent`) come from AGENT_ICONS_STYLE, composed
 * right after this. An unavailable destination's icon is desaturated rather than recoloured, because a logo cannot be
 * tinted. `[hidden]` rules must beat the flex displays here, or a page without destinations would still show an empty
 * trigger. The trigger chevron is painted on `::after` so a hairline on the element is not clipped by the glyph mask.
 * That stroke is inset from the pill's top and bottom and shows only while the trigger is hovered or its menu is open.
 * A full-height stroke reads as a cut through the rounded chip. The fill stays unchanged.
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
  position: relative;
  flex: none;
  align-self: stretch;
  width: 14px;
  margin-left: 4px;
}
/* Glyph on ::after: a mask on this element would clip the divider into the chevron shape. */
.cii-agent-pill-caret::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 0;
  width: 14px;
  height: 14px;
  margin-top: -7px;
  background: currentColor;
  opacity: 0.6;
  -webkit-mask: var(--cii-mask-chevron-down);
  mask: var(--cii-mask-chevron-down);
}
/* Inset so the seam stays inside the rounded pill. left is the middle of the gap in front of the caret. */
.cii-agent-pill-caret::before {
  content: "";
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: -6px;
  width: 1px;
  background: var(--cii-line-bold);
  opacity: 0;
  transition: opacity 120ms ease;
}
.cii-agent-pill:hover:not(:disabled) .cii-agent-pill-caret::before,
.cii-agent-picker:has(> .cii-agent-menu:not([hidden])) > .cii-agent-pill:not(:disabled) .cii-agent-pill-caret::before {
  opacity: 1;
}
.cii-agent-pill-unavailable { color: var(--cii-text-faint); }
.cii-agent-pill-unavailable .cii-agent-kind,
.cii-agent-row-unavailable .cii-agent-row-main .cii-agent-kind { filter: grayscale(1); opacity: 0.5; }

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
.cii-agent-row-main .cii-agent-kind { width: 18px; height: 18px; color: var(--cii-text-muted); }
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
.cii-agent-row-state { color: var(--cii-text-faint); font: 12px/1.3 var(--cii-font); }
.cii-agent-row-check { flex: none; width: 16px; height: 16px; }
.cii-agent-row-selected .cii-agent-row-check {
  background: var(--cii-accent);
  -webkit-mask: var(--cii-mask-check);
  mask: var(--cii-mask-check);
}
.cii-agent-row-sessions {
  position: relative;
  flex: none;
  width: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 0 8px 8px 0;
  background: transparent;
  color: var(--cii-text-muted);
  cursor: pointer;
}
.cii-agent-row-sessions::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 4px;
  right: 4px;
  height: 24px;
  margin-top: -12px;
  border-radius: 7px;
  background: var(--cii-fill);
}
.cii-agent-row-sessions::after {
  content: "";
  position: relative;
  width: 14px;
  height: 14px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-chevron-right);
  mask: var(--cii-mask-chevron-right);
}
.cii-agent-row-sessions:hover { color: var(--cii-text); }
.cii-agent-row-sessions:hover::before { background: var(--cii-fill-strong); }
`;
