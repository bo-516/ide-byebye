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
  width: min(960px, calc(100vw - 32px));
  height: calc(100vh - 32px);
  min-width: 560px;
  min-height: 420px;
  pointer-events: auto;
  font-family: Geist, Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  color: #dae2fd;
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
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 18px;
  background: #09090b;
  color: #ffffff;
  font: 700 20px/1 JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace;
  cursor: grab;
  box-shadow: 0 22px 64px rgba(0,0,0,0.46), inset 0 1px 0 rgba(255,255,255,0.06);
}
.cii-codex-orb:active { cursor: grabbing; }
.cii-codex-shell {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 24px;
  background: #09090b;
  box-shadow: 0 28px 82px rgba(0,0,0,0.48);
}
.cii-codex-icon-btn,
.cii-codex-send {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 999px;
  background: rgba(255,255,255,0.07);
  color: #dae2fd;
  cursor: pointer;
  font: 600 14px/1 system-ui, sans-serif;
}
.cii-codex-icon-btn:hover:not(:disabled),
.cii-codex-send:hover:not(:disabled) {
  background: rgba(255,255,255,0.13);
  color: #ffffff;
}
.cii-codex-icon-btn:disabled,
.cii-codex-send:disabled {
  opacity: 0.45;
  cursor: default;
}
.cii-codex-main {
  min-height: 0;
  height: 100%;
  overflow: hidden;
  flex: 1;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
}
.cii-codex-main-sidebar-collapsed {
  grid-template-columns: 52px minmax(0, 1fr);
}
.cii-codex-sidebar {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid rgba(255,255,255,0.05);
  background: #09090b;
}
.cii-codex-sidebar-brand {
  flex: 0 0 auto;
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px 14px;
  cursor: grab;
  user-select: none;
}
.cii-codex-sidebar-brand:active { cursor: grabbing; }
.cii-codex-sidebar-title {
  min-width: 0;
  overflow: hidden;
  color: #ffffff;
  font: 700 18px/24px Geist, Inter, system-ui, sans-serif;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cii-codex-sidebar-controls {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.cii-codex-sidebar-icon-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
  font: 700 17px/1 system-ui, sans-serif;
}
.cii-codex-sidebar-icon-btn:hover:not(:disabled) {
  background: rgba(255,255,255,0.05);
  color: #ffffff;
}
.cii-codex-sidebar-icon-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.cii-codex-sidebar-toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px 22px;
}
.cii-codex-new-chat {
  flex: 1;
  height: 38px;
  margin: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #ffffff;
  cursor: pointer;
  font: 500 14px/20px Geist, Inter, system-ui, sans-serif;
  text-align: left;
  padding: 0 12px;
}
.cii-codex-new-chat:hover { background: rgba(255,255,255,0.05); }
.cii-codex-sidebar-toggle,
.cii-codex-sidebar-rail-btn {
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
  font: 700 16px/1 system-ui, sans-serif;
}
.cii-codex-sidebar-toggle:hover,
.cii-codex-sidebar-rail-btn:hover {
  background: rgba(255,255,255,0.05);
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
  background: #89ceff;
  color: #001e2f;
  padding: 0 4px;
  font: 700 9px/1 system-ui, sans-serif;
}
.cii-codex-sidebar-heading {
  padding: 0 16px 8px;
  color: #a1a1aa;
  font: 600 11px/14px JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.cii-codex-session-list {
  min-height: 0;
  height: 100%;
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 8px 16px;
  scrollbar-color: transparent transparent;
  scrollbar-width: thin;
}
.cii-codex-session-list:hover {
  scrollbar-color: #3f3f46 transparent;
}
.cii-codex-session-list::-webkit-scrollbar {
  width: 4px;
}
.cii-codex-session-list::-webkit-scrollbar-track {
  background: transparent;
}
.cii-codex-session-list::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: transparent;
}
.cii-codex-session-list:hover::-webkit-scrollbar-thumb {
  background: #3f3f46;
}
.cii-codex-project-group {
  min-height: 0;
  margin: 0 0 14px;
}
.cii-codex-project-heading {
  min-width: 0;
  min-height: 28px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 10px 8px;
  color: #a1a1aa;
  font: 500 17px/22px Geist, Inter, system-ui, sans-serif;
}
.cii-codex-project-icon {
  position: relative;
  width: 16px;
  height: 11px;
  flex: 0 0 auto;
  border: 1.5px solid currentColor;
  border-radius: 3px;
  transform: translateY(1px);
}
.cii-codex-project-icon::before {
  content: "";
  position: absolute;
  left: 1px;
  top: -4px;
  width: 8px;
  height: 4px;
  border: 1.5px solid currentColor;
  border-bottom: 0;
  border-radius: 3px 3px 0 0;
}
.cii-codex-project-icon::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 2px;
  border-top: 1.5px solid currentColor;
  opacity: 0.85;
}
.cii-codex-project-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cii-codex-session-stack {
  --cii-session-visible: 5;
  overflow: hidden;
  max-height: calc(var(--cii-session-visible) * 36px);
  transition: max-height 260ms cubic-bezier(.22,1,.36,1);
  will-change: max-height;
}
.cii-codex-session {
  width: 100%;
  height: 36px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
  padding: 0 10px;
  text-align: left;
}
.cii-codex-session:hover {
  background: rgba(255,255,255,0.05);
  color: #ffffff;
}
.cii-codex-session-active,
.cii-codex-session-active:hover {
  background: rgba(255,255,255,0.10);
  color: #ffffff;
}
.cii-codex-session-title {
  grid-column: 1;
  min-width: 0;
  overflow: hidden;
  font: 500 13px/18px Geist, Inter, system-ui, sans-serif;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cii-codex-session-meta {
  grid-column: 2;
  color: rgba(161,161,170,0.72);
  font: 500 12px/16px JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
}
.cii-codex-session-more {
  height: 30px;
  margin: 4px 0 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
  padding: 0 10px;
  text-align: left;
  font: 500 12px/16px Geist, Inter, system-ui, sans-serif;
  transition: background-color 150ms cubic-bezier(.2,.8,.2,1), color 150ms cubic-bezier(.2,.8,.2,1), transform 150ms cubic-bezier(.2,.8,.2,1);
}
.cii-codex-session-more:hover {
  background: rgba(255,255,255,0.05);
  color: #ffffff;
  transform: translateX(1px);
}
.cii-codex-session-empty {
  padding: 8px 12px;
  color: #a1a1aa;
  font: 13px/18px Geist, Inter, system-ui, sans-serif;
}
.cii-codex-session-empty-detail {
  display: block;
  margin-top: 6px;
  color: rgba(161,161,170,0.70);
  font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow-wrap: anywhere;
}
.cii-codex-chat {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  overflow: hidden;
  background: #09090b;
}
.cii-codex-env-panel {
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  background: #09090b;
  cursor: grab;
  user-select: none;
}
.cii-codex-env-panel:active { cursor: grabbing; }
.cii-codex-env-model,
.cii-codex-env-right,
.cii-codex-run-state {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.cii-codex-env-model {
  color: #a1a1aa;
  font: 500 12px/16px JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace;
}
.cii-codex-env-model strong {
  min-width: 0;
  overflow: hidden;
  color: #ffffff;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cii-codex-env-right {
  justify-content: flex-end;
  color: #a1a1aa;
  font: 500 12px/16px JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace;
}
.cii-codex-run-state {
  color: #ffffff;
}
.cii-codex-run-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: #10b981;
  box-shadow: 0 0 0 3px rgba(16,185,129,0.14);
  animation: cii-codex-pulse 1.55s ease-in-out infinite;
}
.cii-codex-env-meter {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #a1a1aa;
  white-space: nowrap;
}
.cii-codex-env-meter-track {
  width: 64px;
  height: 6px;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255,255,255,0.10);
}
.cii-codex-env-meter-fill {
  display: block;
  height: 100%;
  min-width: 0;
  border-radius: inherit;
  background: #3b82f6;
}
.cii-codex-messages {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 24px 24px 14px;
  scrollbar-color: #3f3f46 transparent;
  scrollbar-width: thin;
}
.cii-codex-messages::-webkit-scrollbar {
  width: 6px;
}
.cii-codex-messages::-webkit-scrollbar-track {
  background: transparent;
}
.cii-codex-messages::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: #3f3f46;
}
.cii-codex-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #dae2fd;
  font: 600 20px/28px Geist, Inter, system-ui, sans-serif;
}
.cii-codex-msg {
  position: relative;
  max-width: 85%;
  margin: 0 0 14px;
  padding: 14px 16px;
  border: 1px solid transparent;
  border-radius: 16px;
  background: transparent;
  color: #dae2fd;
  font: 14px/20px Geist, Inter, system-ui, sans-serif;
  overflow-wrap: anywhere;
}
.cii-codex-prompt-action {
  position: absolute;
  left: -42px;
  top: 50%;
  z-index: 4;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-50%);
  transition: opacity 120ms ease;
}
.cii-codex-msg-user:hover .cii-codex-prompt-action,
.cii-codex-msg-user:focus-within .cii-codex-prompt-action,
.cii-codex-prompt-action:hover {
  opacity: 1;
  pointer-events: auto;
}
.cii-codex-prompt-button {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 999px;
  background: #18181b;
  color: #dae2fd;
  cursor: pointer;
  box-shadow: 0 10px 26px rgba(0,0,0,0.26);
}
.cii-codex-prompt-button:hover,
.cii-codex-prompt-button:focus-visible {
  outline: 0;
  border-color: rgba(137,206,255,0.38);
  background: #27272a;
  color: #ffffff;
}
.cii-codex-prompt-button-icon {
  position: relative;
  width: 14px;
  height: 16px;
  border: 1.5px solid currentColor;
  border-radius: 3px;
}
.cii-codex-prompt-button-icon::before,
.cii-codex-prompt-button-icon::after {
  content: "";
  position: absolute;
  left: 3px;
  right: 3px;
  height: 1.5px;
  border-radius: 999px;
  background: currentColor;
}
.cii-codex-prompt-button-icon::before { top: 5px; }
.cii-codex-prompt-button-icon::after { top: 9px; }
.cii-codex-prompt-popover {
  position: absolute;
  left: 0;
  top: 30px;
  width: min(440px, calc(100vw - 96px));
  max-height: 320px;
  display: none;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 12px;
  background: #18181b;
  color: #e2e6f3;
  box-shadow: 0 20px 60px rgba(0,0,0,0.42);
}
.cii-codex-prompt-action:hover .cii-codex-prompt-popover,
.cii-codex-prompt-action:focus-within .cii-codex-prompt-popover {
  display: block;
}
.cii-codex-prompt-popover-title {
  border-bottom: 1px solid rgba(255,255,255,0.08);
  padding: 9px 11px;
  color: #c8ccd7;
  font: 650 12px/16px JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace;
}
.cii-codex-prompt-popover pre {
  max-height: 268px;
  overflow: auto;
  margin: 0;
  padding: 11px;
  color: #e2e6f3;
  white-space: pre-wrap;
  font: 12px/18px JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace;
}
.cii-codex-msg-user {
  margin-bottom: 20px;
}
.cii-codex-msg-assistant,
.cii-codex-msg-message,
.cii-codex-msg-status {
  margin-bottom: 8px;
}
.cii-codex-msg-text {
  white-space: pre-wrap;
}
.cii-codex-msg-assistant,
.cii-codex-msg-message {
  border: 0;
  background: transparent;
  padding: 0 4px;
  color: #e2e6f3;
}
.cii-codex-msg-status {
  border: 0;
  background: transparent;
  padding: 0 4px;
  color: #c8ccd7;
}
.cii-codex-msg-user {
  margin-left: auto;
  border-color: rgba(255,255,255,0.10);
  border-radius: 16px 16px 4px 16px;
  background: #27272a;
  color: #ffffff;
  box-shadow: 0 8px 22px rgba(0,0,0,0.18);
}
.cii-codex-msg-tool,
.cii-codex-msg-file-change {
  border-color: rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.05);
  color: #a1a1aa;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.cii-codex-msg-failed {
  background: rgba(147,0,10,0.22);
  border-color: rgba(255,180,171,0.22);
  color: #ffdad6;
}
.cii-codex-msg-status,
.cii-codex-status {
  font-size: 12px;
}
.cii-codex-status {
  flex: 0 0 auto;
  min-height: 20px;
  padding: 0 24px 8px;
  color: #a1a1aa;
}
.cii-codex-status[hidden] { display: none; }
.cii-codex-composer {
  flex: 0 0 auto;
  margin: 0 24px 24px;
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 24px;
  background: #18181b;
  box-shadow: 0 18px 50px rgba(0,0,0,0.28);
  overflow: visible;
  transition: border-color 140ms ease;
}
.cii-codex-composer:focus-within {
  border-color: rgba(255,255,255,0.20);
}
.cii-codex-attachments {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 14px 16px 0;
}
.cii-codex-attachments:empty {
  display: none;
}
.cii-codex-textarea {
  width: 100%;
  min-height: 58px;
  max-height: 160px;
  resize: none;
  border: 0;
  outline: 0;
  background: transparent;
  color: #ffffff;
  padding: 12px 16px 8px;
  font: 15px/22px Geist, Inter, system-ui, sans-serif;
  scrollbar-width: thin;
}
.cii-codex-textarea::placeholder { color: #a1a1aa; }
.cii-codex-ref-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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
  border: 1px solid rgba(59,130,246,0.30);
  border-radius: 8px;
  background: rgba(59,130,246,0.14);
  color: #89ceff;
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
  background: #18181b;
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
  background: rgba(137,206,255,0.16);
  opacity: 1;
}
.cii-codex-shot-preview {
  gap: 10px;
  padding: 0;
}
.cii-codex-shot-preview .cii-screenshot-thumb {
  width: 56px;
  height: 56px;
  border-color: rgba(255,255,255,0.10);
  border-radius: 8px;
  background: rgba(0,0,0,0.50);
}
.cii-codex-composer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 42px;
  padding: 6px 12px 10px;
}
.cii-codex-tool-row,
.cii-codex-send-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.cii-codex-send-row {
  justify-content: flex-end;
}
.cii-codex-model-picker {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.cii-codex-model-icon {
  position: relative;
  width: 16px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  background: transparent;
}
.cii-codex-model-icon::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 2px;
  width: 11px;
  height: 15px;
  background: #facc15;
  clip-path: polygon(55% 0, 18% 52%, 43% 52%, 33% 100%, 82% 38%, 54% 38%);
  transform: translateY(-50%);
}
.cii-codex-model-trigger {
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #ffffff;
  cursor: pointer;
  padding: 0 7px;
  font: 650 13px/18px Geist, Inter, system-ui, sans-serif;
  transition: background-color 150ms cubic-bezier(.2,.8,.2,1);
}
.cii-codex-model-trigger:hover,
.cii-codex-model-trigger[aria-expanded="true"] {
  background: rgba(255,255,255,0.06);
}
.cii-codex-model-trigger-text {
  max-width: 148px;
  display: inline-flex;
  align-items: center;
  height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cii-codex-model-chevron {
  color: #ffffff;
  width: 14px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  line-height: 18px;
}
.cii-codex-model-menu,
.cii-codex-model-submenu {
  position: absolute;
  z-index: 5;
  bottom: 40px;
  min-width: 248px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 16px;
  background: #2b2b2c;
  box-shadow: 0 20px 60px rgba(0,0,0,0.38);
  padding: 10px 8px;
  color: #f4f4f5;
  transform-origin: 50% 100%;
  animation: cii-codex-menu-pop 150ms cubic-bezier(.16,1,.3,1);
}
.cii-codex-model-menu {
  right: 264px;
}
.cii-codex-model-submenu {
  left: calc(100% + 8px);
  bottom: 0;
  transform-origin: 0 100%;
}
.cii-codex-menu-title {
  color: #a1a1aa;
  padding: 0 10px 8px;
  font: 500 13px/18px Geist, Inter, system-ui, sans-serif;
}
.cii-codex-menu-separator {
  height: 1px;
  margin: 7px 10px;
  background: rgba(255,255,255,0.10);
}
.cii-codex-menu-item {
  width: 100%;
  min-height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #ffffff;
  cursor: pointer;
  padding: 5px 10px;
  text-align: left;
  font: 500 13px/18px Geist, Inter, system-ui, sans-serif;
  transition: background-color 130ms cubic-bezier(.2,.8,.2,1);
}
.cii-codex-menu-item:hover,
.cii-codex-menu-item-active {
  background: rgba(255,255,255,0.10);
}
.cii-codex-menu-item-text {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}
.cii-codex-menu-item-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cii-codex-menu-item-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.cii-codex-menu-item-icon {
  position: relative;
  width: 16px;
  height: 18px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: transparent;
  font-size: 0;
}
.cii-codex-menu-item-icon::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 2px;
  width: 11px;
  height: 15px;
  background: #facc15;
  clip-path: polygon(55% 0, 18% 52%, 43% 52%, 33% 100%, 82% 38%, 54% 38%);
  transform: translateY(-50%);
}
.cii-codex-menu-check,
.cii-codex-menu-item-chevron {
  flex: 0 0 auto;
  color: #d4d4d8;
  font-size: 15px;
  line-height: 18px;
}
.cii-codex-menu-detail {
  display: block;
  min-width: 0;
  color: #a1a1aa;
  overflow: hidden;
  padding: 1px 0 0;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: 500 12px/16px Geist, Inter, system-ui, sans-serif;
}
.cii-codex-composer .cii-icon-btn {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #a1a1aa;
}
.cii-codex-composer .cii-icon-btn:hover:not(:disabled),
.cii-codex-composer .cii-icon-btn-active {
  background: rgba(255,255,255,0.08);
  color: #ffffff;
}
.cii-codex-composer .cii-screenshot-menu {
  left: 0;
  right: auto;
  background: #18181b;
  border-color: rgba(255,255,255,0.10);
  color: #ffffff;
}
.cii-codex-composer .cii-screenshot-choice {
  color: #ffffff;
}
.cii-codex-composer .cii-screenshot-choice:hover,
.cii-codex-composer .cii-choice-active {
  background: rgba(255,255,255,0.08);
}
.cii-codex-composer .cii-choice-mark {
  color: #89ceff;
}
.cii-codex-send {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 999px;
  background: #e4e4e7;
  color: #000000;
  font-size: 18px;
}
.cii-codex-send:hover:not(:disabled) {
  background: #ffffff;
  color: #000000;
}
.cii-codex-msg-attachments {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  margin-top: 10px;
}
.cii-codex-msg-shot {
  width: 72px;
  height: 54px;
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 8px;
  background: rgba(0,0,0,0.50);
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
  top: 18px;
  width: 8px;
  height: calc(100% - 34px);
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
.cii-codex-progress-card {
  width: fit-content;
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 12px;
  background: rgba(255,255,255,0.05);
  padding: 10px 12px;
  color: #ffffff;
}
.cii-codex-progress-title {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: #ffffff;
  font: 600 14px/20px Geist, Inter, system-ui, sans-serif;
}
.cii-codex-progress-card-live {
  width: min(620px, 100%);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}
.cii-codex-progress-log {
  display: grid;
  gap: 7px;
  min-width: 0;
}
.cii-codex-progress-entry {
  min-width: 0;
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  color: #c8ccd7;
}
.cii-codex-progress-kind {
  color: #8ea0bd;
  font: 600 11px/18px JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: uppercase;
}
.cii-codex-progress-body {
  min-width: 0;
  max-height: 92px;
  overflow: hidden;
  color: #e2e6f3;
  white-space: pre-wrap;
  font: 12px/18px JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace;
}
.cii-codex-progress-entry-reasoning .cii-codex-progress-kind {
  color: #c4b5fd;
}
.cii-codex-progress-entry-tool .cii-codex-progress-kind {
  color: #93c5fd;
}
.cii-codex-progress-entry-file-change .cii-codex-progress-kind {
  color: #86efac;
}
.cii-codex-progress-entry-failed .cii-codex-progress-kind {
  color: #fca5a5;
}
.cii-codex-spinner {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  border: 2px solid rgba(96,165,250,0.28);
  border-top-color: #60a5fa;
  border-radius: 999px;
  animation: cii-codex-spin 900ms linear infinite;
}
@keyframes cii-codex-spin {
  to { transform: rotate(360deg); }
}
@keyframes cii-codex-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
@keyframes cii-codex-menu-pop {
  from {
    opacity: 0;
    transform: translateY(5px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
@media (max-width: 720px) {
  .cii-codex-dock {
    min-width: 0;
    min-height: 0;
    width: calc(100vw - 24px) !important;
    height: calc(100vh - 24px) !important;
  }
  .cii-codex-main {
    grid-template-columns: minmax(0, 1fr);
  }
  .cii-codex-main-sidebar-collapsed {
    grid-template-columns: minmax(0, 1fr);
  }
  .cii-codex-sidebar {
    display: none;
  }
  .cii-codex-env-panel {
    min-height: 52px;
    flex-wrap: wrap;
    gap: 6px 12px;
    padding: 8px 14px;
  }
  .cii-codex-env-model {
    flex: 1 1 120px;
  }
  .cii-codex-env-right {
    flex: 1 1 150px;
    justify-content: flex-end;
  }
  .cii-codex-env-meter-track {
    width: 56px;
  }
  .cii-codex-messages {
    padding: 16px;
  }
  .cii-codex-msg {
    max-width: 100%;
  }
  .cii-codex-composer {
    margin: 0 12px 12px;
  }
  .cii-codex-composer-footer {
    flex-wrap: wrap;
  }
  .cii-codex-tool-row,
  .cii-codex-send-row {
    flex: 1 1 100%;
    justify-content: space-between;
  }
  .cii-codex-model-trigger-text {
    max-width: 126px;
  }
  .cii-codex-model-menu {
    right: -38px;
    min-width: min(248px, calc(100vw - 52px));
  }
  .cii-codex-model-submenu {
    left: auto;
    right: 0;
    bottom: calc(100% + 8px);
    min-width: min(248px, calc(100vw - 52px));
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
