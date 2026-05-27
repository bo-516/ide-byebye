import { OVERLAY_Z_INDEX, DIALOG_Z_INDEX, PLUGIN_NODE_ATTR } from '../shared/constants.js';

/**
 * STYLE_TEXT: Complete stylesheet for the plugin UI inside its shadow root.
 * Purpose: centralizes dialog, picker, and textarea presentation; textarea colors, focus, and scrollbar styling use
 * host-level CSS variables so interaction colors do not keep spreading through local rules.
 * Boundary: only injected into the plugin shadow root and does not affect the host page; missing variables make the
 * textarea focus or scrollbar fall back to browser defaults.
 * @type {string} CSS text written into style.textContent.
 */
export const STYLE_TEXT = `
:host {
  all: initial;
  --cii-color-textarea-surface: #ffffff;
  --cii-color-textarea-text: #0f172a;
  --cii-color-textarea-border: #e0e3e5;
  --cii-color-textarea-border-focus: #c8ced6;
  --cii-color-textarea-placeholder: rgba(66, 71, 84, 0.55);
  --cii-color-textarea-scrollbar-track: transparent;
  --cii-color-textarea-scrollbar-thumb: rgba(66, 71, 84, 0.18);
  --cii-color-textarea-scrollbar-thumb-hover: rgba(66, 71, 84, 0.28);
  --cii-shadow-textarea-focus: 0 0 0 3px rgba(66, 71, 84, 0.10);
  --cii-size-textarea-scrollbar: 10px;
}
* { box-sizing: border-box; }

.cii-overlay {
  position: fixed;
  pointer-events: none;
  z-index: ${OVERLAY_Z_INDEX};
  border: 2px solid #4f8cff;
  background: rgba(79, 140, 255, 0.12);
  border-radius: 3px;
  transition: all 60ms ease-out;
}
.cii-overlay.cii-nomap {
  border: 2px dashed #f59e0b;
  background: rgba(245, 158, 11, 0.10);
}

.cii-label {
  position: fixed;
  pointer-events: none;
  z-index: ${OVERLAY_Z_INDEX};
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  background: #111827;
  color: #f9fafb;
  padding: 3px 7px;
  border-radius: 4px;
  white-space: nowrap;
  max-width: 80vw;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}
.cii-label .cii-tag { color: #93c5fd; }
.cii-label .cii-loc { color: #fcd34d; }
.cii-label.cii-nomap { background: #92400e; }

.cii-backdrop {
  position: fixed;
  inset: 0;
  z-index: ${DIALOG_Z_INDEX};
  pointer-events: auto;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(4px);
  padding: 0;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}

.cii-dialog {
  position: absolute;
  background: #ffffff;
  color: #0f172a;
  width: min(560px, 94vw);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.35);
  overflow: hidden;
}

.cii-body { padding: 18px; overflow: auto; }
.cii-field { margin: 0; }
.cii-field label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 5px; color: #334155; }

.cii-textarea {
  width: 100%;
  min-height: 112px;
  resize: none;
  font: 15px/1.5 system-ui, sans-serif;
  padding: 12px 16px;
  overflow-y: auto;
  overflow-x: hidden;
  border: 1px solid var(--cii-color-textarea-border);
  border-radius: 8px;
  color: var(--cii-color-textarea-text);
  background: var(--cii-color-textarea-surface);
  scrollbar-color: var(--cii-color-textarea-scrollbar-thumb) var(--cii-color-textarea-scrollbar-track);
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.cii-textarea::placeholder { color: var(--cii-color-textarea-placeholder); }
.cii-textarea:focus {
  outline: 0;
  border-color: var(--cii-color-textarea-border-focus);
  box-shadow: var(--cii-shadow-textarea-focus);
}
.cii-textarea::-webkit-scrollbar {
  width: var(--cii-size-textarea-scrollbar);
}
.cii-textarea::-webkit-scrollbar-track {
  background: var(--cii-color-textarea-scrollbar-track);
}
.cii-textarea::-webkit-scrollbar-thumb {
  min-height: 32px;
  border: 3px solid var(--cii-color-textarea-surface);
  border-radius: 999px;
  background-color: var(--cii-color-textarea-scrollbar-thumb);
}
.cii-textarea::-webkit-scrollbar-thumb:hover {
  background-color: var(--cii-color-textarea-scrollbar-thumb-hover);
}

.cii-reference-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 10px;
}
.cii-reference-preview[hidden] { display: none; }
.cii-code-ref-chip {
  max-width: 100%;
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 6px 0 10px;
  border: 1px solid currentColor;
  border-radius: 999px;
  color: inherit;
  opacity: 0.78;
}
.cii-code-ref-link,
.cii-code-ref-remove {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.cii-code-ref-link {
  max-width: min(260px, 70vw);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-decoration: underline;
}
.cii-code-ref-remove {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 999px;
  font: 16px/1 system-ui, sans-serif;
}

.cii-screenshot-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: 12px;
}
.cii-screenshot-preview[hidden] { display: none; }
.cii-screenshot-thumb {
  position: relative;
  width: 116px;
  height: 82px;
  padding: 0;
  border: 1px solid #e0e3e5;
  border-radius: 8px;
  background: #f7f9fb;
  overflow: hidden;
  cursor: pointer;
}
.cii-thumb-media {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #eceef0;
}
.cii-thumb-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cii-thumb-loading {
  width: 42px;
  height: 42px;
  border-radius: 999px;
  border: 3px solid rgba(80, 95, 118, 0.2);
  border-top-color: #505f76;
  animation: cii-spin 800ms linear infinite;
}
.cii-thumb-remove {
  width: 24px;
  height: 24px;
  position: absolute;
  top: 5px;
  right: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.86);
  color: #424754;
  font: 18px/1 system-ui, sans-serif;
  cursor: pointer;
}
.cii-thumb-remove:hover { background: #ffffff; color: #191c1e; }
.cii-thumb-pending { opacity: 0.78; }
@keyframes cii-spin { to { transform: rotate(360deg); } }

.cii-image-lightbox {
  position: fixed;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.64);
}
.cii-image-frame {
  position: relative;
  max-width: min(92vw, 1100px);
  max-height: 86vh;
}
.cii-image-frame img {
  display: block;
  max-width: 100%;
  max-height: 86vh;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 20px 60px rgba(0,0,0,0.35);
}
.cii-image-close {
  position: absolute;
  top: -12px;
  right: -12px;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: #ffffff;
  color: #191c1e;
  font: 20px/1 system-ui, sans-serif;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(0,0,0,0.18);
}

.cii-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  padding: 12px 24px;
  border-top: 1px solid #e0e3e5;
  background: #f7f9fb;
}
.cii-btn {
  font: 13px system-ui, sans-serif;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
}
.cii-btn:disabled { opacity: 0.5; cursor: default; }
.cii-btn-secondary { background: transparent; color: #505f76; border-color: transparent; }
.cii-btn-secondary:hover:not(:disabled) { background: #f2f4f6; }
.cii-btn-primary { background: #0058be; color: #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.10); }
.cii-btn-primary:hover:not(:disabled) { background: #2170e4; box-shadow: 0 4px 8px rgba(0,0,0,0.12); }
.cii-btn-primary:active:not(:disabled) { transform: translateY(1px); }
.cii-action-buttons {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  max-width: 100%;
}
.cii-agent-action {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}
.cii-agent-last::after {
  content: "";
  width: 6px;
  height: 6px;
  margin-left: 8px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.85;
}
.cii-agent-unavailable { background: #64748b; }
.cii-agent-unavailable:hover:not(:disabled) { background: #475569; }
.cii-screenshot-picker { position: relative; }
.cii-icon-btn {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #424754;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.cii-icon-btn:hover:not(:disabled),
.cii-icon-btn-active {
  background: #f2f4f6;
  color: #191c1e;
}
.cii-icon-btn:disabled { opacity: 0.5; cursor: default; }
.cii-code-ref-icon {
  font: 700 20px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.cii-code-ref-icon::before { content: "@"; }
.cii-shot-icon {
  position: relative;
  width: 20px;
  height: 16px;
  border: 2px solid currentColor;
  border-radius: 4px;
}
.cii-shot-icon::before,
.cii-shot-icon::after {
  content: "";
  position: absolute;
  width: 5px;
  height: 5px;
  border-color: currentColor;
}
.cii-shot-icon::before {
  top: -4px;
  left: -4px;
  border-top: 2px solid currentColor;
  border-left: 2px solid currentColor;
}
.cii-shot-icon::after {
  right: -4px;
  bottom: -4px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
}
.cii-screenshot-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  width: 192px;
  padding: 8px;
  background: #ffffff;
  border: 1px solid #e0e3e5;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.16);
  z-index: 1;
}
.cii-screenshot-menu[hidden] { display: none; }
.cii-screenshot-choice {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #191c1e;
  font: 13px/1 system-ui, sans-serif;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}
.cii-screenshot-choice:hover { background: #f2f4f6; }
.cii-choice-active { background: #f2f4f6; }
.cii-choice-mark {
  width: 16px;
  color: #0058be;
  font-weight: 700;
  text-align: center;
}

.cii-codex-dock {
  position: fixed;
  z-index: ${DIALOG_Z_INDEX};
  width: min(760px, calc(100vw - 32px));
  height: min(620px, calc(100vh - 32px));
  min-width: 560px;
  min-height: 420px;
  pointer-events: auto;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  color: #eceff1;
}
.cii-codex-dock-collapsed {
  min-width: 0;
  min-height: 0;
  width: 56px;
  height: 56px;
}
.cii-codex-orb {
  width: 56px;
  height: 56px;
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 18px;
  background: rgba(18,20,22,0.78);
  backdrop-filter: blur(22px) saturate(1.18);
  -webkit-backdrop-filter: blur(22px) saturate(1.18);
  color: #f4f7f8;
  font: 700 20px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  cursor: grab;
  box-shadow: 0 18px 54px rgba(0,0,0,0.34), inset 0 1px 0 rgba(255,255,255,0.08);
}
.cii-codex-orb:active { cursor: grabbing; }
.cii-codex-shell {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 22px;
  background: rgba(15,17,19,0.84);
  backdrop-filter: blur(26px) saturate(1.18);
  -webkit-backdrop-filter: blur(26px) saturate(1.18);
  box-shadow: 0 28px 82px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.06);
}
.cii-codex-header {
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid rgba(255,255,255,0.10);
  background: rgba(24,26,29,0.66);
  cursor: grab;
  user-select: none;
}
.cii-codex-header:active { cursor: grabbing; }
.cii-codex-title {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}
.cii-codex-title strong {
  font-size: 13px;
  line-height: 1;
  letter-spacing: 0;
}
.cii-codex-title span {
  max-width: 180px;
  overflow: hidden;
  color: #879099;
  font-size: 12px;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cii-codex-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cii-codex-icon-btn,
.cii-codex-send {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 12px;
  background: rgba(35,38,43,0.78);
  color: #d9dee2;
  cursor: pointer;
  font: 600 14px/1 system-ui, sans-serif;
}
.cii-codex-icon-btn:hover:not(:disabled),
.cii-codex-send:hover:not(:disabled) {
  background: rgba(51,55,61,0.92);
  color: #ffffff;
}
.cii-codex-icon-btn:disabled,
.cii-codex-send:disabled {
  opacity: 0.45;
  cursor: default;
}
.cii-codex-main {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
}
.cii-codex-main-sidebar-collapsed {
  grid-template-columns: 52px minmax(0, 1fr);
}
.cii-codex-sidebar {
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(168, 190, 198, 0.10);
  background: linear-gradient(180deg, rgba(32, 57, 66, 0.94), rgba(27, 48, 55, 0.96));
}
.cii-codex-sidebar-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 8px;
}
.cii-codex-new-chat {
  flex: 1;
  height: 38px;
  margin: 0;
  border: 1px solid rgba(174, 198, 207, 0.12);
  border-radius: 12px;
  background: rgba(42, 68, 77, 0.62);
  color: #e7eef1;
  cursor: pointer;
  font: 600 13px/1 system-ui, sans-serif;
  text-align: left;
  padding: 0 12px;
}
.cii-codex-new-chat:hover { background: rgba(57, 84, 94, 0.78); }
.cii-codex-sidebar-toggle,
.cii-codex-sidebar-rail-btn {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  border: 1px solid rgba(174, 198, 207, 0.12);
  border-radius: 12px;
  background: rgba(42, 68, 77, 0.56);
  color: #c4d0d5;
  cursor: pointer;
  font: 700 16px/1 system-ui, sans-serif;
}
.cii-codex-sidebar-toggle:hover,
.cii-codex-sidebar-rail-btn:hover {
  background: rgba(57, 84, 94, 0.78);
  color: #ffffff;
}
.cii-codex-sidebar-collapsed {
  align-items: center;
  gap: 8px;
  padding: 10px 0;
}
.cii-codex-sidebar-collapsed .cii-codex-sidebar-rail-btn {
  width: 34px;
  height: 34px;
}
.cii-codex-rail-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 17px;
  height: 17px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(16,18,20,0.92);
  border-radius: 999px;
  background: #7fb7ff;
  color: #0b1117;
  padding: 0 4px;
  font: 700 9px/1 system-ui, sans-serif;
}
.cii-codex-sidebar-heading {
  padding: 8px 12px 12px;
  color: rgba(205, 216, 221, 0.55);
  font: 500 15px/1.1 system-ui, sans-serif;
}
.cii-codex-session-list {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 0 8px 14px;
}
.cii-codex-project-group {
  margin: 0 0 12px;
}
.cii-codex-project-heading {
  min-width: 0;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  color: rgba(220, 228, 232, 0.74);
  font: 500 13px/1 system-ui, sans-serif;
}
.cii-codex-project-icon {
  position: relative;
  width: 17px;
  height: 12px;
  flex: 0 0 auto;
  border: 1.5px solid rgba(215, 225, 229, 0.76);
  border-radius: 4px;
}
.cii-codex-project-icon::before {
  content: "";
  position: absolute;
  left: 1px;
  top: -6px;
  width: 9px;
  height: 5px;
  border: 1.5px solid rgba(215, 225, 229, 0.76);
  border-bottom: 0;
  border-radius: 4px 4px 0 0;
}
.cii-codex-project-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cii-codex-session {
  width: 100%;
  min-height: 30px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(233, 240, 243, 0.88);
  cursor: pointer;
  padding: 0 8px 0 35px;
  text-align: left;
}
.cii-codex-session:hover {
  background: rgba(59, 86, 96, 0.52);
  color: #ffffff;
}
.cii-codex-session-active,
.cii-codex-session-active:hover {
  background: rgba(68, 97, 108, 0.74);
  color: #ffffff;
}
.cii-codex-session-title {
  grid-column: 1;
  min-width: 0;
  overflow: hidden;
  font: 650 13px/1.2 system-ui, sans-serif;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cii-codex-session-meta {
  grid-column: 2;
  color: rgba(203, 214, 219, 0.66);
  font: 500 12px/1 system-ui, sans-serif;
}
.cii-codex-session-shortcut {
  grid-column: 2;
  min-width: 26px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(69, 96, 107, 0.80);
  color: rgba(226, 236, 240, 0.76);
  font: 600 12px/1 system-ui, sans-serif;
}
.cii-codex-session:hover .cii-codex-session-shortcut,
.cii-codex-session-active .cii-codex-session-shortcut {
  background: rgba(82, 112, 124, 0.90);
  color: rgba(247, 250, 251, 0.92);
}
.cii-codex-session-more {
  height: 30px;
  margin: 3px 0 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(205, 216, 221, 0.62);
  cursor: pointer;
  padding: 0 8px 0 35px;
  text-align: left;
  font: 500 13px/1 system-ui, sans-serif;
}
.cii-codex-session-more:hover {
  background: rgba(59, 86, 96, 0.38);
  color: rgba(238, 244, 246, 0.86);
}
.cii-codex-session-empty {
  padding: 0 8px 0 35px;
  color: rgba(205, 216, 221, 0.60);
  font: 13px/1.4 system-ui, sans-serif;
}
.cii-codex-session-empty-detail {
  display: block;
  margin-top: 6px;
  color: rgba(205, 216, 221, 0.44);
  font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow-wrap: anywhere;
}
.cii-codex-chat {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: rgba(12,14,16,0.48);
}
.cii-codex-env-panel {
  margin: 12px 14px 0;
  padding: 12px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 18px;
  background: rgba(41,43,46,0.58);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
}
.cii-codex-env-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #f1f3f4;
  font: 600 12px/1 system-ui, sans-serif;
}
.cii-codex-env-dot {
  color: #929ba3;
  font-weight: 500;
}
.cii-codex-env-rows {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px 12px;
  margin-top: 11px;
}
.cii-codex-env-row {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #cbd2d7;
  font: 12px/1.2 system-ui, sans-serif;
}
.cii-codex-env-label {
  color: #8c949b;
}
.cii-codex-env-value {
  min-width: 0;
  overflow: hidden;
  color: #e3e7ea;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cii-codex-env-meter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(255,255,255,0.08);
  color: #9aa3aa;
  font: 12px/1 system-ui, sans-serif;
}
.cii-codex-messages {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 14px 18px 18px;
}
.cii-codex-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #e7ebee;
  font-size: 24px;
}
.cii-codex-msg {
  max-width: 92%;
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 15px;
  background: rgba(28,31,34,0.76);
  color: #dce2e6;
  font: 13px/1.5 system-ui, sans-serif;
  overflow-wrap: anywhere;
}
.cii-codex-msg-text {
  white-space: pre-wrap;
}
.cii-codex-msg-user {
  margin-left: auto;
  background: rgba(32,49,47,0.82);
  border-color: rgba(104, 211, 187, 0.18);
}
.cii-codex-msg-tool,
.cii-codex-msg-file-change {
  background: rgba(22,26,32,0.78);
  color: #b6c0c8;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.cii-codex-msg-failed {
  background: rgba(47,29,29,0.82);
  border-color: rgba(255, 120, 120, 0.22);
  color: #ffd2d2;
}
.cii-codex-msg-status,
.cii-codex-status {
  color: #8f989f;
  font-size: 12px;
}
.cii-codex-status {
  min-height: 24px;
  padding: 0 18px 8px;
}
.cii-codex-status[hidden] { display: none; }
.cii-codex-composer {
  margin: 0 14px 14px;
  border: 1px solid rgba(255,255,255,0.13);
  border-radius: 24px;
  background: rgba(36,39,43,0.86);
  box-shadow: 0 16px 44px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.05);
  overflow: visible;
}
.cii-codex-attachments {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 0;
}
.cii-codex-attachments:empty {
  display: none;
}
.cii-codex-textarea {
  width: 100%;
  min-height: 84px;
  max-height: 160px;
  resize: none;
  border: 0;
  outline: 0;
  background: transparent;
  color: #f4f7f8;
  padding: 12px 14px 8px;
  font: 14px/1.45 system-ui, sans-serif;
  scrollbar-width: thin;
}
.cii-codex-textarea::placeholder { color: #737b83; }
.cii-codex-ref-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cii-codex-ref-row[hidden],
.cii-codex-shot-preview[hidden] {
  display: none;
}
.cii-codex-ref-chip {
  max-width: 100%;
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  overflow: hidden;
  border: 1px solid rgba(122, 177, 255, 0.34);
  border-radius: 999px;
  background: rgba(122, 177, 255, 0.13);
  color: #aad0ff;
  padding: 4px 7px 4px 9px;
  font: 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.cii-codex-ref-chip-static {
  padding-right: 9px;
}
.cii-codex-ref-icon {
  width: 13px;
  height: 15px;
  flex: 0 0 auto;
  border: 1.5px solid currentColor;
  border-radius: 3px;
  position: relative;
  opacity: 0.95;
}
.cii-codex-ref-icon::after {
  content: "";
  position: absolute;
  top: -1.5px;
  right: -1.5px;
  width: 5px;
  height: 5px;
  border-left: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  background: rgba(34,48,65,0.96);
}
.cii-codex-ref-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cii-codex-ref-remove {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: currentColor;
  cursor: pointer;
  font: 15px/1 system-ui, sans-serif;
  opacity: 0.72;
}
.cii-codex-ref-remove:hover {
  background: rgba(159, 203, 255, 0.16);
  opacity: 1;
}
.cii-codex-shot-preview {
  gap: 8px;
  padding: 0;
}
.cii-codex-shot-preview .cii-screenshot-thumb {
  width: 96px;
  height: 72px;
  border-color: rgba(255,255,255,0.16);
  border-radius: 14px;
  background: rgba(17,19,21,0.86);
}
.cii-codex-composer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 42px;
  padding: 6px 8px 8px;
}
.cii-codex-tool-row {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.cii-codex-mode-toggle {
  height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 13px;
  background: rgba(17,19,21,0.52);
}
.cii-codex-mode-option {
  height: 26px;
  min-width: 48px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #9aa3aa;
  cursor: pointer;
  padding: 0 9px;
  font: 600 12px/1 system-ui, sans-serif;
}
.cii-codex-mode-option-active {
  background: rgba(255,255,255,0.12);
  color: #f4f7f8;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
}
.cii-codex-model {
  height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 13px;
  background: rgba(17,19,21,0.34);
  color: #b9c1c7;
  padding: 0 6px 0 8px;
}
.cii-codex-model-icon {
  font-size: 14px;
  line-height: 1;
}
.cii-codex-model select {
  max-width: 142px;
  border: 0;
  outline: 0;
  background: transparent;
  color: #d9dee2;
  font: 600 13px/1 system-ui, sans-serif;
  cursor: pointer;
}
.cii-codex-model select option {
  background: #202327;
  color: #edf1f3;
}
.cii-codex-composer .cii-icon-btn {
  color: #b9c1c7;
}
.cii-codex-composer .cii-icon-btn:hover:not(:disabled),
.cii-codex-composer .cii-icon-btn-active {
  background: rgba(51,55,61,0.92);
  color: #ffffff;
}
.cii-codex-composer .cii-screenshot-menu {
  background: rgba(32,35,39,0.96);
  border-color: rgba(255,255,255,0.12);
  color: #edf1f3;
}
.cii-codex-composer .cii-screenshot-choice {
  color: #edf1f3;
}
.cii-codex-composer .cii-screenshot-choice:hover,
.cii-codex-composer .cii-choice-active {
  background: rgba(51,55,61,0.92);
}
.cii-codex-composer .cii-choice-mark {
  color: #68d3bb;
}
.cii-codex-send {
  border-radius: 999px;
  background: #e8ecef;
  color: #101112;
}
.cii-codex-send:hover:not(:disabled) {
  background: #ffffff;
  color: #101112;
}
.cii-codex-msg-attachments {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 8px;
}
.cii-codex-msg-shot {
  width: 82px;
  height: 62px;
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 12px;
  background: rgba(15,17,19,0.86);
  padding: 0;
  overflow: hidden;
  cursor: pointer;
}
.cii-codex-msg-shot img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}
.cii-codex-resize {
  position: absolute;
  z-index: 2;
}
.cii-codex-resize-left,
.cii-codex-resize-right {
  top: 42px;
  width: 8px;
  height: calc(100% - 54px);
  cursor: ew-resize;
}
.cii-codex-resize-left {
  left: 0;
}
.cii-codex-resize-right {
  right: 0;
}
.cii-codex-resize-bottom {
  left: 16px;
  right: 16px;
  bottom: 0;
  height: 10px;
  cursor: ns-resize;
}
.cii-codex-resize-bottom-left,
.cii-codex-resize-bottom-right {
  bottom: 0;
  width: 22px;
  height: 22px;
}
.cii-codex-resize-bottom-left {
  left: 0;
  cursor: nesw-resize;
}
.cii-codex-resize-bottom-right {
  right: 0;
  cursor: nwse-resize;
}
.cii-codex-resize-bottom-left::after,
.cii-codex-resize-bottom-right::after {
  content: "";
  position: absolute;
  right: 7px;
  bottom: 7px;
  width: 7px;
  height: 7px;
  border-right: 1px solid rgba(255,255,255,0.26);
  border-bottom: 1px solid rgba(255,255,255,0.26);
  opacity: 0.72;
}
.cii-codex-resize-bottom-left::after {
  right: auto;
  left: 7px;
  transform: scaleX(-1);
}
@media (max-width: 720px) {
  .cii-codex-dock {
    min-width: 0;
    min-height: 0;
    width: calc(100vw - 24px) !important;
    height: calc(100vh - 24px) !important;
  }
  .cii-codex-main {
    grid-template-columns: 150px minmax(0, 1fr);
  }
  .cii-codex-main-sidebar-collapsed {
    grid-template-columns: 48px minmax(0, 1fr);
  }
  .cii-codex-env-rows {
    grid-template-columns: minmax(0, 1fr);
  }
  .cii-codex-model select {
    max-width: 96px;
  }
  .cii-codex-empty {
    font-size: 18px;
  }
}
`;
/**
 * Create an isolated shadow-DOM host for all plugin UI so page CSS cannot leak
 * in and our styles cannot leak out. The host carries the marker attribute so
 * the picker never selects our own UI.
 */
export function createUi() {
    const host = document.createElement('div');
    host.setAttribute(PLUGIN_NODE_ATTR, '');
    host.setAttribute('popover', 'manual');
    host.style.cssText = [
        'all: initial',
        'position: fixed',
        'inset: 0',
        'width: 100vw',
        'height: 100vh',
        'margin: 0',
        'padding: 0',
        'border: 0',
        'background: transparent',
        'overflow: visible',
        'pointer-events: none',
        `z-index: ${DIALOG_Z_INDEX}`,
    ].join(';');
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE_TEXT;
    root.appendChild(style);
    document.body.appendChild(host);
    if (!showUiHost(host))
        keepUiHostLast(host);
    return { host, root };
}

function showUiHost(host) {
    if (typeof host.showPopover !== 'function')
        return false;
    try {
        if (!host.matches(':popover-open'))
            host.showPopover();
        return host.matches(':popover-open');
    }
    catch {
        // Fall back to the fixed z-index host when the Popover API is unavailable or blocked.
        return false;
    }
}

function keepUiHostLast(host) {
    const ensureLast = () => {
        if (host.parentNode === document.body && document.body.lastElementChild !== host)
            document.body.appendChild(host);
    };
    ensureLast();
    new MutationObserver(ensureLast).observe(document.body, { childList: true });
}
