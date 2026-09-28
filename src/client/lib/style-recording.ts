import { DIALOG_Z_INDEX } from '../../shared/constants.js';

/**
 * Record tool and its scope/start popover, recording thumbnails, the floating recording pill, and the pinned-dialog
 * orb. The recording editor lives in RECORDING_EDITOR_STYLE.
 *
 * Boundary: requires the tokens, icon masks, and shared button/menu styles; keep it after the capture-tool rules. The
 * record tool stays a neutral glyph like its neighbours and only turns red on intent (hover, open, recording), so the
 * bar has no permanent alarm colour. The pill and orb are direct children of the shadow root rather than of the
 * scrim, so each sets its own colours (fonts come from the tokens' top-level rule). The pill centres itself with the
 * `translate` property, leaving `transform` free for its entrance animation; the orb animates opacity only because
 * its drag handler measures `getBoundingClientRect()`.
 * @type {string} CSS fragment composed into the shadow-root stylesheet in its original cascade order.
 */
export const RECORDING_STYLE = `
.cii-rec-icon {
  width: 18px;
  height: 18px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-record);
  mask: var(--cii-mask-record);
}
.cii-rec-toggle:hover:not(:disabled),
.cii-rec-picker:has(> .cii-rec-menu:not([hidden])) > .cii-rec-toggle { color: var(--cii-danger); }
.cii-rec-toggle.cii-rec-active { background: var(--cii-danger-soft); color: var(--cii-danger); }
.cii-rec-toggle.cii-rec-active .cii-rec-icon { animation: cii-rec-pulse 1.2s ease-in-out infinite; }
@keyframes cii-rec-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.cii-screenshot-menu.cii-rec-menu { width: 220px; padding: 6px; }
/* Single-select scope: a bare check marks the active row instead of a checkbox. */
.cii-rec-menu .cii-choice-mark,
.cii-rec-menu .cii-choice-active .cii-choice-mark { background: none; box-shadow: none; color: var(--cii-accent); }
.cii-rec-start {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 34px;
  margin-top: 6px;
  border: 0;
  border-radius: 8px;
  background: var(--cii-danger);
  color: #ffffff;
  font: 600 13px/1 var(--cii-font);
  cursor: pointer;
  transition: filter 120ms ease;
}
.cii-rec-start::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.cii-rec-start:hover { filter: brightness(1.08); }

.cii-recording-preview[hidden] { display: none; }
/* Wider than a screenshot thumb so the "scope · duration" badge fits without truncating the duration. */
.cii-screenshot-thumb.cii-recording-thumb { width: 128px; cursor: pointer; }
.cii-recording-thumb .cii-thumb-media::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 26px;
  height: 26px;
  margin: -13px 0 0 -13px;
  border-radius: 50%;
  background: rgba(18, 18, 22, 0.62);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18);
}
.cii-recording-thumb .cii-thumb-media::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 1;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -5px;
  background: #ffffff;
  -webkit-mask: var(--cii-mask-play);
  mask: var(--cii-mask-play);
}
.cii-rec-duration {
  position: absolute;
  left: 4px;
  bottom: 4px;
  max-width: calc(100% - 8px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 5px;
  border-radius: 5px;
  background: rgba(18, 18, 22, 0.66);
  color: #ffffff;
  font: 500 10px/1.3 var(--cii-font);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.cii-rec-indicator {
  position: fixed;
  left: 50%;
  bottom: 24px;
  translate: -50% 0;
  z-index: ${DIALOG_Z_INDEX};
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 6px 6px 14px;
  border-radius: 999px;
  background: rgba(24, 24, 29, 0.88);
  color: #ffffff;
  backdrop-filter: blur(16px) saturate(1.4);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.10), 0 14px 36px -10px rgba(0, 0, 0, 0.5);
  font: 500 13px/1 var(--cii-font);
  animation: cii-pop 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.cii-rec-indicator-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff5257;
  box-shadow: 0 0 0 4px rgba(255, 82, 87, 0.22);
  animation: cii-rec-pulse 1.2s ease-in-out infinite;
}
.cii-rec-indicator-text { font-variant-numeric: tabular-nums; }
.cii-rec-indicator-stop {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 12px 0 10px;
  border: 0;
  border-radius: 999px;
  background: #ffffff;
  color: #18181d;
  font: 600 12.5px/1 var(--cii-font);
  cursor: pointer;
}
.cii-rec-indicator-stop::before { content: ""; width: 9px; height: 9px; border-radius: 2px; background: #e5484d; }
.cii-rec-indicator-stop:hover { background: #ececf0; }

.cii-pin-orb {
  position: fixed;
  z-index: ${DIALOG_Z_INDEX};
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: linear-gradient(180deg, var(--cii-ink-top), var(--cii-ink));
  color: var(--cii-on-ink);
  box-shadow: var(--cii-shadow-ink), 0 0 0 4px var(--cii-accent-soft);
  cursor: grab;
  pointer-events: auto;
  transition: box-shadow 160ms ease;
  animation: cii-fade-in 200ms ease-out;
}
.cii-pin-orb:hover { box-shadow: var(--cii-shadow-ink), 0 0 0 6px var(--cii-accent-soft); }
.cii-pin-orb:active { cursor: grabbing; }
.cii-pin-orb-icon {
  width: 20px;
  height: 20px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-pin);
  mask: var(--cii-mask-pin);
}
`;
