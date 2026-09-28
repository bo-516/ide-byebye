/**
 * Session-menu styles appended after the main dialog sheet: the menu the destination picker opens for agents that
 * can continue an existing session.
 *
 * Boundary: the dialog becomes a size container so a menu opened below 420px can span the dialog (the action bar's
 * narrow-width rules use the same container). The menu is anchored in JS at the destination trigger; these rules only
 * style it. `[hidden]` must beat the menu's display so a closed menu never lingers. The back button exists only when
 * the menu was opened from the destination list.
 *
 * @type {string}
 */
export const SESSION_PICKER_STYLE = `
.cii-dialog { container-type: inline-size; }
.cii-session-menu {
  position: absolute; right: 12px; bottom: 56px; z-index: 6;
  width: min(340px, calc(100% - 24px)); max-height: 340px; overflow: auto;
  padding: 6px;
  background: var(--cii-surface-raised); color: var(--cii-text);
  border-radius: 12px; box-shadow: var(--cii-shadow-pop);
  font: 13px/1.4 var(--cii-font);
  scrollbar-width: thin;
  animation: cii-pop 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.cii-session-menu[hidden] { display: none; }
.cii-session-menu-head { display: flex; align-items: center; gap: 4px; padding: 0 0 6px; }
.cii-session-menu-title {
  flex: 1; min-width: 0; padding-left: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--cii-text-muted); font: 600 12px/1.4 var(--cii-font);
}
.cii-session-back + .cii-session-menu-title { padding-left: 0; }
.cii-session-back, .cii-session-refresh {
  flex: none; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: var(--cii-text-faint); font-size: 0; cursor: pointer;
}
.cii-session-back::before, .cii-session-refresh::before {
  content: ""; width: 15px; height: 15px; background: currentColor;
  -webkit-mask: var(--cii-mask-chevron-left); mask: var(--cii-mask-chevron-left);
}
.cii-session-refresh::before { width: 14px; height: 14px; -webkit-mask: var(--cii-mask-refresh); mask: var(--cii-mask-refresh); }
.cii-session-back:hover, .cii-session-refresh:hover { background: var(--cii-fill); color: var(--cii-text); }
.cii-session-refreshing::before { animation: cii-spin 0.8s linear infinite; }
.cii-session-retry {
  border: 0; border-radius: 6px; padding: 4px 8px; margin-left: 2px;
  background: transparent; color: var(--cii-accent-text); font: 500 12px/1.4 var(--cii-font); cursor: pointer;
}
.cii-session-retry:hover { background: var(--cii-accent-softer); }
.cii-session-menu-list { position: relative; }
.cii-session-loading {
  position: absolute; inset: 0; z-index: 1;
  display: flex; align-items: center; justify-content: center;
  background: var(--cii-surface-veil);
  color: var(--cii-text-muted); font: 12px/1.4 var(--cii-font);
  border-radius: 8px;
}
.cii-session-row, .cii-session-new {
  display: block; width: 100%; padding: 8px; border: 0; border-radius: 8px;
  background: transparent; color: inherit; text-align: left; cursor: pointer;
  font: 500 13px/1.35 var(--cii-font);
}
.cii-session-new { display: flex; align-items: center; gap: 8px; color: var(--cii-accent-text); }
.cii-session-new::before {
  content: ""; flex: none; width: 15px; height: 15px; background: currentColor;
  -webkit-mask: var(--cii-mask-plus); mask: var(--cii-mask-plus);
}
.cii-session-row:hover:not(:disabled), .cii-session-new:hover, .cii-session-row.cii-session-active, .cii-session-new.cii-session-active {
  background: var(--cii-fill);
}
.cii-session-row:disabled { opacity: 0.5; cursor: default; }
.cii-session-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cii-session-row-meta { margin-top: 2px; color: var(--cii-text-faint); font: 11.5px/1.35 var(--cii-font); }
.cii-session-marker-working { color: var(--cii-success); }
.cii-session-marker-waiting { color: var(--cii-warning); }
.cii-session-marker-idle, .cii-session-marker-closed { color: var(--cii-text-muted); }
.cii-session-empty, .cii-session-note { padding: 6px 8px; color: var(--cii-text-faint); font: 12px/1.45 var(--cii-font); }
@container (max-width: 419px) {
  .cii-session-menu { left: 0; right: 0; width: 100%; }
  .cii-session-menu-title, .cii-session-row-title {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
}
`;
