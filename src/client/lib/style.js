import { OVERLAY_Z_INDEX, DIALOG_Z_INDEX, PLUGIN_NODE_ATTR } from '../../shared/constants.js';

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
  width: min(640px, 94vw);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.35);
  overflow: visible;
}
/* Top controls (pin + close): a minimal icon tab that grows out of the dialog's top-right edge (flush right). Its bottom
   overlaps into the dialog so the white merges seamlessly and the rounded corner is covered — no floating-pill seam. */
.cii-header {
  position: absolute; bottom: calc(100% - 10px); right: 0; z-index: 3;
  display: flex; align-items: center; gap: 1px;
  padding: 5px; border-radius: 12px 12px 0 0;
  background: #ffffff;
  box-shadow: 0 -6px 14px rgba(15,23,42,0.06);
}
.cii-header-div { width: 1px; height: 16px; background: #e2e8f0; }
.cii-pin-btn,
.cii-close-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 28px; border: none; background: transparent;
  border-radius: 7px; cursor: pointer;
}
.cii-pin-btn { color: #0058be; }
.cii-close-btn { color: #94a3b8; }
.cii-pin-btn:hover,
.cii-close-btn:hover { background: #f1f5f9; }
.cii-close-btn:hover { color: #334155; }
.cii-pin-ico { display: block; }

.cii-body { padding: 16px 18px 18px 18px; overflow: auto; }
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
  border-radius: 0 0 12px 12px;
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
.cii-footer-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
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

/* --- Footer control tooltips ---
   A dark hover bubble (with a downward caret) that replaces the browser's native title= tooltip on the capture/record
   icons: same look everywhere, no ~1s browser delay, and readable text instead of a system pill. Driven purely by a
   \`data-cii-tip\` attribute so any control can opt in. The bubble opens upward out of the footer (the dialog is
   overflow:visible, so it is not clipped) and is suppressed while that control's own dropdown is open so it can never
   sit on top of the menu. */
[data-cii-tip] { position: relative; }
[data-cii-tip]::after,
[data-cii-tip]::before {
  position: absolute;
  left: 50%;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 110ms ease;
  z-index: ${DIALOG_Z_INDEX};
}
[data-cii-tip]::after {
  content: attr(data-cii-tip);
  bottom: calc(100% + 7px);
  transform: translateX(-50%);
  padding: 5px 9px;
  border-radius: 7px;
  background: #26292e;
  color: #fff;
  font: 550 11.5px/1.35 system-ui, -apple-system, sans-serif;
  white-space: nowrap;
  box-shadow: 0 3px 10px rgba(0,0,0,0.20), 0 1px 2px rgba(0,0,0,0.14);
}
/* Caret: a small rotated square whose centre is pushed ~2px up into the bubble body, so the bubble paints over its
   top half and the two read as one seamless shape (the earlier version only touched at a point and split apart). */
[data-cii-tip]::before {
  content: "";
  bottom: calc(100% + 4px);
  width: 8px;
  height: 8px;
  background: #26292e;
  border-radius: 1.5px;
  transform: translateX(-50%) rotate(45deg);
}
[data-cii-tip]:hover::after,
[data-cii-tip]:hover::before,
[data-cii-tip]:focus-visible::after,
[data-cii-tip]:focus-visible::before {
  opacity: 1;
  visibility: visible;
  transition-delay: 70ms;
}
/* While a footer dropdown (screenshot / style / recording-scope) is open it also opens upward — hide that control's
   tooltip so the bubble does not overlap the menu. Higher specificity than the :hover rule, so it wins. */
.cii-screenshot-picker:has(> .cii-screenshot-menu:not([hidden])) > [data-cii-tip]::after,
.cii-screenshot-picker:has(> .cii-screenshot-menu:not([hidden])) > [data-cii-tip]::before {
  opacity: 0;
  visibility: hidden;
}
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
/* Record key: a thin red ring around a solid red core (camera-style record button) rather than a bare dot, so the control reads as deliberate and sits calmly among the icon buttons. */
.cii-rec-dot {
  width: 18px; height: 18px; border-radius: 50%;
  border: 2px solid #f0c2bd; box-sizing: border-box;
  display: inline-flex; align-items: center; justify-content: center;
}
.cii-rec-dot::after {
  content: ""; width: 9px; height: 9px; border-radius: 50%;
  background: #d92d20; transition: border-radius 120ms ease, background 120ms ease;
}
.cii-rec-toggle:hover:not(:disabled) .cii-rec-dot { border-color: #ea9b94; }
.cii-rec-toggle:hover:not(:disabled) .cii-rec-dot::after { background: #c4271c; }
.cii-rec-toggle.cii-rec-active { background: #fdecec; }
.cii-rec-toggle.cii-rec-active .cii-rec-dot::after {
  border-radius: 2px;
  animation: cii-rec-pulse 1.2s ease-in-out infinite;
}
@keyframes cii-rec-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.cii-recording-preview[hidden] { display: none; }
.cii-rec-duration {
  position: absolute; right: 4px; bottom: 4px;
  background: rgba(0,0,0,0.65); color: #fff; font-size: 10px;
  line-height: 1.4; padding: 0 5px; border-radius: 8px; pointer-events: none;
}
/* Recording editor (light theme). */
.cii-recording-lightbox {
  position: fixed; left: 0; top: 0; width: 100vw; height: 100vh;
  z-index: ${DIALOG_Z_INDEX};
  display: flex; align-items: center; justify-content: center;
  padding: 24px; background: rgba(15,23,42,0.45);
}
.cii-recording-frame {
  position: relative; flex: none;
  display: flex; flex-direction: column; gap: 12px;
  max-width: 94vw; max-height: 92vh; overflow: auto;
  background: #ffffff; color: #0f172a; padding: 16px; border-radius: 14px;
  box-shadow: 0 24px 60px rgba(15,23,42,0.35);
}
.cii-rv-header { display: flex; align-items: center; justify-content: space-between; }
.cii-rv-title { font-size: 14px; font-weight: 600; color: #0f172a; }
.cii-rv-close {
  width: 30px; height: 30px; border-radius: 8px; border: none; background: #f1f5f9;
  color: #475569; font-size: 20px; line-height: 1; cursor: pointer;
}
.cii-rv-close:hover { background: #e2e8f0; color: #0f172a; }
.cii-recording-stage {
  flex: none; align-self: center;
  background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;
}
.cii-rv-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cii-rv-actions { justify-content: flex-end; }
.cii-rv-btn {
  flex: none; width: 36px; height: 30px; border-radius: 8px; cursor: pointer;
  border: 1px solid #cbd5e1; background: #fff; color: #334155; font-size: 14px;
}
.cii-rv-btn:hover { background: #f1f5f9; }
.cii-rv-seek { flex: 1; min-width: 180px; accent-color: #0058be; }
.cii-rv-time { font-size: 12px; color: #475569; min-width: 96px; }
.cii-rv-chip-btn {
  border: 1px solid #cbd5e1; background: #fff; color: #334155;
  border-radius: 8px; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.cii-rv-chip-btn:hover:not(:disabled) { background: #f1f5f9; }
.cii-rv-chip-btn:disabled { opacity: 0.5; cursor: default; }
/* timeline track */
.cii-rv-track {
  position: relative; height: 40px; border-radius: 8px;
  background: #eef2f6; border: 1px solid #e2e8f0; cursor: crosshair; overflow: hidden;
}
.cii-rv-seg {
  position: absolute; top: 0; bottom: 0;
  background: rgba(34,197,94,0.30); border-left: 2px solid #16a34a; border-right: 2px solid #16a34a;
}
.cii-rv-seg-x {
  position: absolute; top: 2px; right: 2px; width: 16px; height: 16px; border-radius: 4px;
  border: none; background: rgba(255,255,255,0.85); color: #b42318; font-size: 12px; line-height: 1; cursor: pointer;
}
.cii-rv-sel {
  position: absolute; top: 0; bottom: 0;
  background: rgba(0,88,190,0.16); border: 1px dashed #0058be; pointer-events: none;
}
.cii-rv-playhead { position: absolute; top: -2px; bottom: -2px; width: 2px; background: #ef4444; pointer-events: none; }
.cii-rv-segbar { font-size: 12px; }
.cii-rv-hint { font-size: 12px; line-height: 1.5; color: #64748b; }
/* keep both bottom action buttons the same size; only the emphasis differs */
.cii-rv-actions .cii-btn { padding: 9px 18px; font-size: 13px; font-weight: 600; }
.cii-rv-done { border: 1px solid #cbd5e1; background: #fff; color: #334155; }
.cii-rv-done:hover { background: #f1f5f9; color: #0f172a; }
.cii-pin-orb {
  position: fixed; width: 44px; height: 44px; border-radius: 50%;
  border: none; cursor: grab; z-index: ${DIALOG_Z_INDEX};
  background: #0058be; color: #fff;
  box-shadow: 0 6px 18px rgba(0,0,0,0.28);
  display: flex; align-items: center; justify-content: center;
  pointer-events: auto;
}
.cii-pin-orb:hover { background: #2170e4; }
.cii-pin-orb:active { cursor: grabbing; }
.cii-pin-orb-icon { width: 20px; height: 20px; position: relative; }
.cii-pin-orb-icon::before {
  content: "📌"; font-size: 18px; line-height: 20px;
}
.cii-rec-controls { display: inline-flex; align-items: center; gap: 10px; }
/* Fence the recording group (scope + record key) off from the capture icons with a hairline — only when capture icons precede it, so a recording-only footer shows no stray divider. */
.cii-footer-tools > .cii-rec-controls:not(:first-child) {
  margin-left: 4px; padding-left: 14px;
  border-left: 1px solid #e0e3e5;
}
.cii-rec-scope-picker { position: relative; }
/* Footer scope trigger shares the ghost icon-button language (transparent until hover, no persistent border) so it reads as one of the icon buttons, not a separate boxed pill. */
.cii-rec-scope-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 36px; padding: 0 10px; border-radius: 8px;
  border: 0; background: transparent; color: #424754;
  font-size: 13px; cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.cii-rec-scope-btn:hover:not(:disabled) { background: #f2f4f6; color: #191c1e; }
.cii-rec-scope-btn:disabled { opacity: 0.5; cursor: default; }
.cii-rec-scope-caret { color: #94a3b8; font-size: 11px; }
.cii-rec-indicator {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  z-index: ${DIALOG_Z_INDEX};
  display: flex; align-items: center; gap: 10px;
  background: #111827; color: #fff; padding: 8px 12px; border-radius: 999px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.35);
}
.cii-rec-indicator-dot {
  width: 10px; height: 10px; border-radius: 50%; background: #d92d20;
  animation: cii-rec-pulse 1.2s ease-in-out infinite;
}
.cii-rec-indicator-text { font-size: 13px; }
.cii-rec-indicator-stop {
  border: none; cursor: pointer; border-radius: 6px;
  background: #d92d20; color: #fff; font-size: 12px; padding: 4px 12px;
}
.cii-rec-indicator-stop:hover { background: #b42318; }

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
