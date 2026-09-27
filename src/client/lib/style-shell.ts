import { OVERLAY_Z_INDEX, DIALOG_Z_INDEX } from '../../shared/constants.js';

/**
 * Shadow-root defaults, inspection highlights, dialog shell, and intent editor presentation.
 *
 * Boundary: Inject first so later component rules inherit its reset and textarea variables; outside the shadow root these rules could alter the host page.
 * @type {string} CSS fragment composed into the shadow-root stylesheet in its original cascade order.
 */
export const SHELL_STYLE = `
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
`;
