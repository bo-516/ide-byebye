/**
 * Style-capture panel (scope segmented control, node stepper, property filter and checklist) and its preview chip.
 *
 * Boundary: the panel reuses the dropdown shell and checkbox marks from TOOLS_STYLE, so it must be composed after it;
 * missing either leaves the panel without a surface or its rows without state. `[hidden]` rules must keep beating the
 * flex display rules here, otherwise the node-limit row shows for the single-node `self` scope.
 * @type {string} CSS fragment composed into the shadow-root stylesheet in its original cascade order.
 */
export const CAPTURE_STYLE = `
.cii-style-picker { position: relative; }
.cii-style-panel {
  width: 320px;
  max-width: calc(100vw - 24px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  max-height: min(460px, 70vh);
}
/* Only the property list may give up height when the panel is capped; every other row keeps its natural size. */
.cii-style-panel > * { flex-shrink: 0; }
.cii-style-panel-title { padding: 0 2px; color: var(--cii-text); font: 600 13px/1.3 var(--cii-font); }
.cii-style-scope-label,
.cii-style-nodes-label { padding: 0 2px; color: var(--cii-text-faint); font: 500 11.5px/1.2 var(--cii-font); }
.cii-style-scope-label { margin-bottom: -4px; }
.cii-style-scope {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  padding: 2px;
  background: var(--cii-fill);
  border-radius: 9px;
}
.cii-style-scope-btn {
  min-width: 0;
  padding: 6px 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--cii-text-muted);
  font: 500 12px/1.25 var(--cii-font);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.cii-style-scope-btn:hover:not(.cii-style-scope-active) { color: var(--cii-text); }
.cii-style-scope-active {
  background: var(--cii-surface-raised);
  color: var(--cii-text);
  box-shadow: 0 0 0 1px var(--cii-line), 0 1px 2px rgba(0, 0, 0, 0.08);
}
.cii-style-nodes { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cii-style-nodes[hidden] { display: none; }
.cii-style-nodes-stepper {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: var(--cii-fill);
  border-radius: 8px;
}
.cii-style-nodes-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: var(--cii-surface-raised);
  color: var(--cii-text);
  font: 500 15px/1 var(--cii-font);
  box-shadow: 0 0 0 1px var(--cii-line), 0 1px 2px rgba(0, 0, 0, 0.08);
  cursor: pointer;
}
.cii-style-nodes-btn:hover { color: var(--cii-accent-text); }
.cii-style-nodes-value {
  min-width: 26px;
  text-align: center;
  color: var(--cii-text);
  font: 600 12px/1 var(--cii-mono);
  font-variant-numeric: tabular-nums;
}
.cii-style-search {
  width: 100%;
  height: 32px;
  padding: 0 10px 0 32px;
  border: 0;
  border-radius: 8px;
  background: var(--cii-image-search) 10px center / 15px 15px no-repeat, var(--cii-fill);
  color: var(--cii-text);
  font: 13px/1.4 var(--cii-font);
  transition: box-shadow 120ms ease, background-color 120ms ease;
}
.cii-style-search:focus {
  outline: 0;
  box-shadow: 0 0 0 1px var(--cii-accent), 0 0 0 4px var(--cii-accent-soft);
}
.cii-style-search::placeholder { color: var(--cii-text-faint); }
.cii-style-panel > .cii-style-list {
  flex: 1 1 auto;
  min-height: 60px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--cii-line-strong) transparent;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.cii-style-opt {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 5px 6px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--cii-text-muted);
  text-align: left;
  cursor: pointer;
}
.cii-style-opt:hover { background: var(--cii-fill); color: var(--cii-text); }
.cii-style-opt.cii-choice-active { color: var(--cii-text); }
.cii-style-opt-label {
  font: 12px/1.4 var(--cii-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cii-style-empty { padding: 16px 8px; color: var(--cii-text-faint); font-size: 12px; text-align: center; }
.cii-style-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px solid var(--cii-line);
}
.cii-style-count { color: var(--cii-text-muted); font: 500 12px/1 var(--cii-font); }
.cii-style-foot-actions { display: flex; align-items: center; gap: 2px; }
.cii-style-action {
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--cii-accent-text);
  font: 500 12px/1 var(--cii-font);
  cursor: pointer;
}
.cii-style-action:hover { background: var(--cii-accent-softer); }

.cii-style-preview[hidden] { display: none; }
.cii-style-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  height: 30px;
  padding: 0 4px 0 10px;
  border-radius: 9px;
  background: var(--cii-fill);
  color: var(--cii-text-muted);
  font: 500 12.5px/1 var(--cii-font);
}
.cii-style-chip-icon {
  flex: none;
  width: 15px;
  height: 15px;
  background: var(--cii-accent);
  -webkit-mask: var(--cii-mask-palette);
  mask: var(--cii-mask-palette);
}
.cii-style-chip-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cii-style-chip-remove {
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
  color: var(--cii-text-faint);
  font-size: 0;
  cursor: pointer;
}
.cii-style-chip-remove::before {
  content: "";
  width: 10px;
  height: 10px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-x);
  mask: var(--cii-mask-x);
}
.cii-style-chip-remove:hover { background: var(--cii-fill); color: var(--cii-text); }
`;
