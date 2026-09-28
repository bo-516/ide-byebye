import { DIALOG_Z_INDEX } from '../../shared/constants.js';

/**
 * Recording editor lightbox: player stage, transport, cut timeline, and actions.
 *
 * Boundary: the lightbox is mounted on the shadow root (not inside the dialog scrim), so it sets its own font, colours,
 * and stacking. The timeline keeps its semantic colours: kept segments use the accent, the pending cut selection uses
 * danger, and the playhead is neutral so it never reads as either. Requires the tokens, icon masks, and `.cii-btn`
 * styles from FOOTER_STYLE for the action row.
 * @type {string} CSS fragment composed into the shadow-root stylesheet after RECORDING_STYLE.
 */
export const RECORDING_EDITOR_STYLE = `
.cii-recording-lightbox {
  position: fixed; left: 0; top: 0; width: 100vw; height: 100vh;
  z-index: ${DIALOG_Z_INDEX};
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  background: var(--cii-scrim-strong);
  backdrop-filter: blur(6px);
  color: var(--cii-text);
  font: 13px/1.45 var(--cii-font);
  animation: cii-fade-in 160ms ease-out;
}
.cii-recording-frame {
  position: relative; flex: none;
  display: flex; flex-direction: column; gap: 14px;
  max-width: 94vw; max-height: 92vh; overflow: auto;
  padding: 16px 18px 18px;
  background: var(--cii-surface); color: var(--cii-text);
  border-radius: 18px;
  box-shadow: var(--cii-shadow-panel);
  animation: cii-pop 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.cii-rv-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.cii-rv-title { color: var(--cii-text); font: 600 15px/1.3 var(--cii-font); }
.cii-rv-close {
  width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: var(--cii-text-faint); font-size: 0; cursor: pointer;
}
.cii-rv-close::before {
  content: ""; width: 14px; height: 14px; background: currentColor;
  -webkit-mask: var(--cii-mask-x); mask: var(--cii-mask-x);
}
.cii-rv-close:hover { background: var(--cii-fill); color: var(--cii-text); }
.cii-recording-stage {
  flex: none; align-self: center;
  background: #ffffff; border-radius: 12px; overflow: hidden;
  box-shadow: 0 0 0 1px var(--cii-line), 0 10px 28px -14px rgba(0, 0, 0, 0.35);
}
.cii-rv-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cii-rv-actions { justify-content: flex-end; gap: 8px; }
.cii-rv-btn {
  flex: none; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--cii-ink); color: var(--cii-on-ink); box-shadow: var(--cii-shadow-ink);
  font-size: 12px; line-height: 1; cursor: pointer;
}
.cii-rv-btn:hover { background: var(--cii-ink-hover); }
.cii-rv-seek { flex: 1; min-width: 180px; accent-color: var(--cii-accent); }
.cii-rv-time { min-width: 96px; color: var(--cii-text-muted); font: 500 12px/1.3 var(--cii-mono); font-variant-numeric: tabular-nums; }
.cii-rv-hint { max-width: 80ch; color: var(--cii-text-muted); font-size: 12px; line-height: 1.55; }
.cii-rv-track {
  position: relative; height: 44px; border-radius: 10px; overflow: hidden; cursor: crosshair;
  background: var(--cii-surface-sunken); box-shadow: inset 0 0 0 1px var(--cii-line);
}
.cii-rv-seg {
  position: absolute; top: 5px; bottom: 5px; border-radius: 7px;
  background: var(--cii-accent-soft); box-shadow: inset 0 0 0 1.5px var(--cii-accent);
}
.cii-rv-seg-x {
  position: absolute; top: 4px; right: 4px; width: 16px; height: 16px; padding: 0; border: 0; border-radius: 5px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--cii-surface-raised); color: var(--cii-danger); font-size: 0; cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}
.cii-rv-seg-x::before {
  content: ""; width: 9px; height: 9px; background: currentColor;
  -webkit-mask: var(--cii-mask-x); mask: var(--cii-mask-x);
}
.cii-rv-sel {
  position: absolute; top: 0; bottom: 0; z-index: 1; pointer-events: none;
  background: var(--cii-danger-soft); border: 1.5px dashed var(--cii-danger); border-radius: 8px;
}
.cii-rv-playhead {
  position: absolute; top: 0; bottom: 0; z-index: 2; width: 2px; margin-left: -1px; pointer-events: none;
  border-radius: 2px; background: var(--cii-text);
}
.cii-rv-segbar { font-size: 12px; }
/* The kept-time summary shares the time class but reads as a sentence, so only the transport clock stays monospace. */
.cii-rv-segbar .cii-rv-time { font-family: var(--cii-font); }
.cii-rv-chip-btn {
  height: 30px; padding: 0 12px; border: 0; border-radius: 8px;
  background: var(--cii-key); color: var(--cii-text); box-shadow: var(--cii-shadow-key);
  font: 500 12.5px/1 var(--cii-font); cursor: pointer;
  transition: box-shadow 120ms ease, opacity 120ms ease;
}
.cii-rv-chip-btn:hover:not(:disabled) { box-shadow: var(--cii-shadow-key-hover); }
.cii-rv-chip-btn:disabled { opacity: 0.45; cursor: default; }
.cii-rv-actions .cii-btn { height: 36px; padding: 0 16px; }
`;
