import { OVERLAY_Z_INDEX } from '../../shared/constants.js';

/**
 * Floating pick button faces and the glass of touch pick mode.
 *
 * Purpose: the pin orb (`style-recording.ts`) doubles as the pick button on touch screens. Idle, it rests
 * semi-transparent against a side edge; pressed, picking, holding a pinned dialog or hovered with a mouse it is opaque.
 * Its glyph says what a tap does: inspect → pick, × on the accent colour → cancel, pin with a badge → resume the
 * pinned dialog. The glass sits
 * under the page highlight and the button, so the highlight shows through it and the button can still cancel, and it
 * blocks page scrolling by touch and by wheel, like the dialog scrim.
 * Boundary: composed after `RECORDING_STYLE`, whose `.cii-pin-orb` rules these override at equal specificity. The
 * button position is inline (owned by `DialogPin`); only its snap transition lives here, and it is off while dragging.
 * @type {string} CSS fragment composed into the shadow-root stylesheet.
 */
export const PICK_STYLE = `
.cii-pick-btn {
  opacity: 0.6;
  transition: opacity 160ms ease, box-shadow 160ms ease,
    left 220ms cubic-bezier(0.2, 0.8, 0.2, 1), top 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.cii-pick-btn.cii-pressed,
.cii-pick-btn.cii-picking,
.cii-pick-btn.cii-pinned,
.cii-pick-btn:focus-visible { opacity: 1; }
@media (hover: hover) {
  .cii-pick-btn:hover { opacity: 1; }
}
.cii-pick-btn.cii-dragging { transition: opacity 160ms ease, box-shadow 160ms ease; }
.cii-pick-btn .cii-pin-orb-icon { -webkit-mask: var(--cii-mask-inspect); mask: var(--cii-mask-inspect); }
.cii-pick-btn.cii-picking {
  background: var(--cii-accent);
  color: var(--cii-on-accent);
}
.cii-pick-btn.cii-picking .cii-pin-orb-icon { -webkit-mask: var(--cii-mask-x); mask: var(--cii-mask-x); }
.cii-pick-btn.cii-pinned .cii-pin-orb-icon { -webkit-mask: var(--cii-mask-pin); mask: var(--cii-mask-pin); }
.cii-pick-btn.cii-pinned::after {
  content: "";
  position: absolute;
  top: 2px;
  right: 2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--cii-accent);
  box-shadow: 0 0 0 2px var(--cii-ink);
}

.cii-pick-glass {
  position: fixed;
  inset: 0;
  z-index: ${OVERLAY_Z_INDEX - 1};
  pointer-events: auto;
  /* Pick mode does not scroll: no touch pan, and a wheel over the glass stops here instead of chaining to the page. */
  touch-action: none;
  overflow: hidden;
  overscroll-behavior: contain;
  cursor: crosshair;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
}
.cii-pick-hint {
  position: absolute;
  top: 16px;
  left: 50%;
  translate: -50% 0;
  max-width: calc(100% - 32px);
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--cii-ink);
  color: var(--cii-on-ink);
  box-shadow: var(--cii-shadow-ink);
  font: 500 13px/1.3 var(--cii-font);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  transition: opacity 160ms ease;
  animation: cii-pop 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.cii-pick-pressed .cii-pick-hint { opacity: 0; }
`;
