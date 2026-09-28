/**
 * Session-menu styles appended after the main dialog sheet: the agent key's session caret, the stored-target dot, the
 * target line under the editor, and the session menu itself.
 *
 * Boundary: the dialog becomes a size container so a menu opened below 420px can span the dialog. Rules here must not
 * restyle unrelated footer buttons; the caret follows its key's state through sibling selectors (`.cii-agent-last +`,
 * `.cii-agent-unavailable +`), so it must stay the element right after the main button. Explicit hidden rules must
 * override flex display, otherwise unsupported agents expose a caret. Status dots are out of flow so selected targets
 * cannot change a key's width. Custom labels truncate inside the main button; its title keeps the full description.
 *
 * @type {string}
 */
export const SESSION_PICKER_STYLE = `
.cii-dialog { container-type: inline-size; }
.cii-session-caret {
  position: relative;
  flex: 0 0 30px;
  width: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 0 10px 10px 0;
  background: transparent;
  color: var(--cii-text-faint);
  font-size: 0;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.cii-session-caret::before {
  content: "";
  width: 14px;
  height: 14px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-chevron-down);
  mask: var(--cii-mask-chevron-down);
}
.cii-session-caret::after {
  content: "";
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 1px;
  background: var(--cii-line-strong);
}
.cii-session-caret[hidden], .cii-session-dot[hidden] { display: none; }
.cii-session-caret:hover:not(:disabled) { background: var(--cii-fill); color: var(--cii-text); }
.cii-session-caret:active:not(:disabled) { background: var(--cii-fill-strong); }
.cii-session-caret:focus-visible { z-index: 1; }
.cii-session-caret:disabled { opacity: 0.5; cursor: default; }
.cii-agent-last + .cii-session-caret {
  background: linear-gradient(180deg, var(--cii-ink-top), var(--cii-ink));
  color: var(--cii-on-ink);
}
.cii-agent-last + .cii-session-caret::after { background: var(--cii-on-ink-soft); }
.cii-agent-last + .cii-session-caret:hover:not(:disabled) { background: var(--cii-ink-hover); color: var(--cii-on-ink); }
.cii-agent-last.cii-agent-unavailable + .cii-session-caret { background: var(--cii-fill); color: var(--cii-text-muted); }
.cii-agent-last.cii-agent-unavailable + .cii-session-caret::after { background: var(--cii-line-strong); }
.cii-agent-last.cii-agent-unavailable + .cii-session-caret:hover:not(:disabled) {
  background: var(--cii-fill-strong);
  color: var(--cii-text);
}
.cii-session-dot {
  position: absolute;
  top: 8px;
  right: 7px;
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--cii-accent);
}

.cii-session-target {
  flex: 1 1 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 5px 5px 5px 10px;
  border-radius: 9px;
  background: var(--cii-accent-softer);
  box-shadow: inset 0 0 0 1px var(--cii-accent-soft);
  color: var(--cii-accent-text);
  font: 500 12.5px/1.4 var(--cii-font);
}
.cii-session-target::before {
  content: "";
  flex: none;
  width: 14px;
  height: 14px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-corner-down-right);
  mask: var(--cii-mask-corner-down-right);
}
.cii-session-target[hidden] { display: none; }
.cii-session-target-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cii-session-target-clear {
  flex: none;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 0;
  opacity: 0.7;
  cursor: pointer;
}
.cii-session-target-clear::before {
  content: "";
  width: 10px;
  height: 10px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-x);
  mask: var(--cii-mask-x);
}
.cii-session-target-clear:hover { background: var(--cii-accent-soft); opacity: 1; }

.cii-session-menu {
  position: absolute; right: 12px; bottom: 64px; z-index: 6;
  width: min(360px, calc(100% - 24px)); max-height: 340px; overflow: auto;
  padding: 6px;
  background: var(--cii-surface-raised); color: var(--cii-text);
  border-radius: 12px; box-shadow: var(--cii-shadow-pop);
  font: 13px/1.4 var(--cii-font);
  scrollbar-width: thin;
  animation: cii-pop 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.cii-session-menu[hidden] { display: none; }
.cii-session-menu-head { display: flex; align-items: center; gap: 8px; padding: 2px 2px 6px 8px; }
.cii-session-menu-title {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--cii-text-muted); font: 600 12px/1.4 var(--cii-font);
}
.cii-session-refresh {
  flex: none; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 7px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: var(--cii-text-faint); font-size: 0; cursor: pointer;
}
.cii-session-refresh::before {
  content: ""; width: 14px; height: 14px; background: currentColor;
  -webkit-mask: var(--cii-mask-refresh); mask: var(--cii-mask-refresh);
}
.cii-session-refresh:hover { background: var(--cii-fill); color: var(--cii-text); }
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
  display: block; width: 100%; padding: 7px 8px; border: 0; border-radius: 8px;
  background: transparent; color: inherit; text-align: left; cursor: pointer;
  font: 500 13px/1.35 var(--cii-font);
}
.cii-session-new { display: flex; align-items: center; gap: 8px; color: var(--cii-accent-text); }
.cii-session-new::before {
  content: ""; flex: none; width: 14px; height: 14px; background: currentColor;
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
  .cii-session-menu-title, .cii-session-row-title, .cii-session-target-label {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
}
`;
