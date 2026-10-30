import { DIALOG_Z_INDEX } from '../../shared/constants.js';

/**
 * Shadow-root defaults and the dialog shell (scrim, panel, header controls, body). The page-picking highlight lives in
 * `style-overlay.ts`.
 *
 * Boundary: composed right after the tokens so every component rule inherits its reset, control font inheritance, and
 * focus ring. The panel is `overflow: visible` so tooltips and dropdowns can escape it; its entrance animation touches
 * opacity only, because `Dialog` measures the panel with `getBoundingClientRect()` while positioning and a transform
 * would skew that measurement. Outside the shadow root these rules could alter the host page.
 * @type {string} CSS fragment composed into the shadow-root stylesheet in its original cascade order.
 */
export const SHELL_STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
button, input { font: inherit; color: inherit; letter-spacing: inherit; }
button:focus-visible, [role="button"]:focus-visible {
  outline: 2px solid var(--cii-accent);
  outline-offset: 2px;
}

.cii-backdrop {
  position: fixed;
  inset: 0;
  z-index: ${DIALOG_Z_INDEX};
  pointer-events: auto;
  padding: 0;
  background: var(--cii-scrim);
  color: var(--cii-text);
  font: 13px/1.45 var(--cii-font);
  animation: cii-fade-in 160ms ease-out;
}
/* Drags and wheel scrolls on a full-screen layer must not scroll the page under it. touch-action stops touch pans that
   start on the layer or on panel chrome. A wheel ignores touch-action and chains on to the page unless the layer is a
   scroll container that contains it, hence overflow: hidden (the layer is viewport-sized, so it clips nothing visible).
   Every scroll area inside resets touch-action so its own content stays scrollable, and once that content hits its end
   (or never overflowed) the gesture chains on to the page; contain on each one cuts that chain. touch-action: none on
   the scroll areas themselves would freeze them. The recording viewer sits outside the scrim, so it is listed too. */
.cii-backdrop, .cii-recording-lightbox { touch-action: none; overflow: hidden; overscroll-behavior: contain; }
.cii-backdrop *, .cii-recording-lightbox * { overscroll-behavior: contain; }

.cii-dialog {
  position: absolute;
  width: min(560px, calc(100vw - 24px));
  max-height: min(86vh, calc(100vh - 24px));
  display: flex;
  flex-direction: column;
  background: var(--cii-surface);
  color: var(--cii-text);
  border-radius: 18px;
  box-shadow: var(--cii-shadow-panel);
  overflow: visible;
  animation: cii-fade-in 180ms ease-out;
}
/* Pin + close sit inside the panel's top-right corner, level with the context chip that opens the body. */
.cii-header {
  position: absolute; top: 12px; right: 12px; z-index: 3;
  display: flex; align-items: center; gap: 2px;
}
.cii-pin-btn,
.cii-close-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px;
  background: transparent; color: var(--cii-text-faint); cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.cii-pin-btn:hover,
.cii-close-btn:hover { background: var(--cii-fill); color: var(--cii-text); }

/* Body: editor on its own row; attachment previews flow side by side; the session target line takes a full row. */
.cii-body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-height: 0;
  padding: 12px 16px 10px;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--cii-line-strong) transparent;
}

/* Forced-colours mode (Windows High Contrast) repaints backgrounds with Canvas, which would erase every icon drawn as a
   masked background; opt the icon slots out and paint them in the text colour instead. New icon slots belong here. */
@media (forced-colors: active) {
  .cii-code-ref-icon, .cii-shot-icon, .cii-style-icon, .cii-style-chip-icon, .cii-mention-icon, .cii-pin-orb-icon,
  .cii-rec-icon, .cii-state-icon, .cii-state-chip-icon, .cii-agent-kind, .cii-agent-pill-caret::after, .cii-agent-row-selected .cii-agent-row-check,
  .cii-agent-row-sessions::after, .cii-agent-row-session::before, .cii-copy-label::before,
  .cii-choice-active .cii-choice-mark::before, .cii-session-new::before, .cii-session-refresh::before,
  .cii-session-back::before, .cii-mention-remove::before, .cii-thumb-remove::before, .cii-style-chip-remove::before,
  .cii-image-close::before, .cii-rv-close::before, .cii-rv-seg-x::before, .cii-recording-thumb .cii-thumb-media::before {
    forced-color-adjust: none;
    background: CanvasText;
  }
}

@keyframes cii-fade-in { from { opacity: 0; } }
@keyframes cii-pop { from { opacity: 0; transform: translateY(4px) scale(0.98); } }
@keyframes cii-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; }
}
`;
