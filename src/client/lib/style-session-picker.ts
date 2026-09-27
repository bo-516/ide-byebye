/**
 * Session-menu styles appended after the main dialog sheet.
 *
 * Boundary: the dialog becomes a size container so a menu opened below 420px can span the dialog. Rules here must not
 * restyle unrelated footer buttons; the split radius applies only while `.cii-agent-split-on` is present. Explicit
 * hidden rules must override flex display, otherwise unsupported agents expose a caret with a broken rounded seam.
 * Each split fills one footer grid cell; status dots are out of flow so selected targets cannot change its width.
 * Custom labels truncate inside the main button; its existing title keeps the full action description available.
 *
 * @type {string}
 */
export const SESSION_PICKER_STYLE = `
.cii-dialog { container-type: inline-size; }
.cii-agent-split { position: relative; display: flex; align-items: stretch; min-width: 0; }
.cii-agent-split > .cii-agent-action { flex: 1; display: block; overflow: hidden; text-overflow: ellipsis; }
.cii-agent-split-on > .cii-agent-action { border-radius: 8px 0 0 8px; }
.cii-session-caret {
  position: relative;
  display: inline-flex; align-items: center; justify-content: center;
  flex: 0 0 30px; width: 30px; padding: 0; border: 0; border-radius: 0 8px 8px 0;
  border-left: 1px solid rgba(255,255,255,0.22);
  background: #0058be; color: #fff; font: 13px/1 system-ui, sans-serif; cursor: pointer;
  transition: background 120ms ease;
}
.cii-session-caret[hidden], .cii-session-dot[hidden] { display: none; }
.cii-session-caret:hover:not(:disabled) { background: #0966d1; }
.cii-session-caret:active:not(:disabled) { background: #004a9f; }
.cii-agent-unavailable + .cii-session-caret { background: #64748b; }
.cii-agent-unavailable + .cii-session-caret:hover:not(:disabled) { background: #475569; }
.cii-session-caret:disabled { opacity: 0.5; cursor: default; }
.cii-session-dot {
  position: absolute; top: 6px; right: 5px;
  width: 4px; height: 4px; border-radius: 999px; background: currentColor;
}
.cii-session-target {
  display: flex; align-items: center; gap: 8px;
  margin: 0 16px 8px; padding: 6px 10px; border-radius: 8px;
  background: #eef3fb; color: #1e3a5f; font: 12px/1.4 system-ui, sans-serif;
}
.cii-session-target[hidden] { display: none; }
.cii-session-target-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cii-session-target-clear {
  border: 0; background: transparent; color: #64748b; cursor: pointer; font: 14px/1 system-ui, sans-serif;
}
.cii-session-menu {
  position: absolute; right: 12px; bottom: 64px; z-index: 6;
  width: min(380px, calc(100% - 24px)); max-height: 320px; overflow: auto;
  background: #fff; color: #0f172a; border-radius: 10px;
  box-shadow: 0 12px 40px rgba(15,23,42,0.18); padding: 8px;
}
.cii-session-menu[hidden] { display: none; }
.cii-session-menu-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.cii-session-menu-title {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font: 600 12px/1.4 system-ui, sans-serif;
}
.cii-session-refresh, .cii-session-retry {
  border: 0; background: transparent; color: #0058be; cursor: pointer; font: 12px system-ui, sans-serif;
}
.cii-session-refreshing { display: inline-block; animation: cii-session-spin 0.8s linear infinite; }
@keyframes cii-session-spin { to { transform: rotate(360deg); } }
.cii-session-menu-list { position: relative; }
.cii-session-loading {
  position: absolute; inset: 0; z-index: 1;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.72);
  color: #64748b; font: 12px/1.4 system-ui, sans-serif;
  border-radius: 8px;
}
.cii-session-row, .cii-session-new {
  display: block; width: 100%; text-align: left; border: 0; background: transparent;
  border-radius: 8px; padding: 6px 8px; cursor: pointer; color: inherit; font: 13px/1.35 system-ui, sans-serif;
}
.cii-session-row:hover:not(:disabled), .cii-session-new:hover, .cii-session-row.cii-session-active, .cii-session-new.cii-session-active {
  background: #f1f5f9;
}
.cii-session-row:disabled { color: #94a3b8; cursor: default; }
.cii-session-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cii-session-row-meta { color: #64748b; font-size: 11px; }
.cii-session-marker-working { color: #15803d; }
.cii-session-marker-waiting { color: #b45309; }
.cii-session-marker-idle, .cii-session-marker-closed { color: #64748b; }
.cii-session-empty, .cii-session-note { color: #64748b; font: 12px/1.4 system-ui, sans-serif; padding: 4px 8px; }
@container (max-width: 419px) {
  .cii-session-menu { left: 0; right: 0; width: 100%; }
  .cii-session-menu-title, .cii-session-row-title, .cii-session-target-label {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
}
`;
