import { DIALOG_Z_INDEX } from '../../shared/constants.js';

/**
 * Recording controls, recording editor, and pinned-dialog orb presentation.
 *
 * Boundary: Requires shell defaults and shared button styles; preserve its position after capture-tool rules to retain recording overrides.
 * @type {string} CSS fragment composed into the shadow-root stylesheet in its original cascade order.
 */
export const RECORDING_STYLE = `
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
`;
