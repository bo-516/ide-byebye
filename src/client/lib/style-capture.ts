/**
 * Style-capture controls, property picker, and selected-style preview presentation.
 *
 * Boundary: Requires shell textarea variables and shared capture-tool rules; missing either leaves focus feedback or picker controls incomplete.
 * @type {string} CSS fragment composed into the shadow-root stylesheet in its original cascade order.
 */
export const CAPTURE_STYLE = `
/* Style-capture footer button + dropdown panel. */
.cii-style-picker { position: relative; }
.cii-style-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 18px;
}
.cii-style-icon::before {
  content: "{ }";
  font: 700 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: -1px;
}
.cii-style-panel {
  width: 340px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: min(440px, 68vh);
}
.cii-style-panel-title { font-size: 12px; font-weight: 600; color: #334155; padding: 0 2px; }
.cii-style-scope-label { font-size: 11px; font-weight: 600; color: #64748b; padding: 0 2px; }
.cii-style-scope {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 3px;
  background: #eef2f6;
  border-radius: 8px;
}
.cii-style-scope-btn {
  flex: 1 1 40%;
  min-width: 96px;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #475569;
  font: 12px/1.2 system-ui, sans-serif;
  font-weight: 600;
  cursor: pointer;
}
.cii-style-scope-btn:hover:not(.cii-style-scope-active) { background: #e2e8f0; }
.cii-style-scope-active { background: #ffffff; color: #0058be; box-shadow: 0 1px 3px rgba(15,23,42,0.12); }
.cii-style-nodes {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px;
}
.cii-style-nodes[hidden] { display: none; }
.cii-style-nodes-label { font-size: 11px; font-weight: 600; color: #64748b; }
.cii-style-nodes-stepper {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px;
  background: #eef2f6;
  border-radius: 8px;
}
.cii-style-nodes-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: #ffffff;
  color: #0058be;
  font: 15px/1 system-ui, sans-serif;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 1px 2px rgba(15,23,42,0.12);
}
.cii-style-nodes-btn:hover { background: #f2f4f6; }
.cii-style-nodes-value {
  min-width: 22px;
  text-align: center;
  font: 12px/1 system-ui, sans-serif;
  font-weight: 600;
  color: #334155;
}
.cii-style-search {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid #e0e3e5;
  border-radius: 8px;
  background: #ffffff;
  color: #0f172a;
  font: 13px/1.4 system-ui, sans-serif;
}
.cii-style-search:focus {
  outline: 0;
  border-color: var(--cii-color-textarea-border-focus);
  box-shadow: var(--cii-shadow-textarea-focus);
}
.cii-style-search::placeholder { color: var(--cii-color-textarea-placeholder); }
.cii-style-list {
  flex: 1 1 auto;
  min-height: 60px;
  overflow-y: auto;
  scrollbar-width: thin;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.cii-style-opt {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #191c1e;
  text-align: left;
  cursor: pointer;
}
.cii-style-opt:hover { background: #f2f4f6; }
.cii-style-opt.cii-choice-active { background: #f2f4f6; }
.cii-style-opt-label {
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cii-style-empty { padding: 12px 8px; color: #94a3b8; font-size: 12px; text-align: center; }
.cii-style-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 2px;
  border-top: 1px solid #eef2f6;
}
.cii-style-count { font-size: 12px; color: #64748b; }
.cii-style-foot-actions { display: flex; align-items: center; gap: 2px; }
.cii-style-action {
  border: 0;
  background: transparent;
  color: #0058be;
  font: 12px/1 system-ui, sans-serif;
  font-weight: 600;
  cursor: pointer;
  padding: 6px 4px;
}
.cii-style-action:hover { text-decoration: underline; }
.cii-style-preview[hidden] { display: none; }
.cii-style-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 6px 8px 6px 12px;
  border: 1px solid #e0e3e5;
  border-radius: 999px;
  background: #f7f9fb;
  color: #334155;
}
.cii-style-chip-icon {
  width: 14px; height: 12px;
  flex: 0 0 auto;
  display: inline-flex; align-items: center; justify-content: center;
}
.cii-style-chip-icon::before {
  content: "{ }";
  font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: -1px;
  color: #0058be;
}
.cii-style-chip-text {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cii-style-chip-remove {
  width: 20px; height: 20px;
  flex: 0 0 auto;
  display: inline-flex; align-items: center; justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #64748b;
  font: 15px/1 system-ui, sans-serif;
  cursor: pointer;
}
.cii-style-chip-remove:hover { background: #e2e8f0; color: #191c1e; }

`;
