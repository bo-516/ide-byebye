import { OVERLAY_Z_INDEX } from '../../shared/constants.js';

/**
 * Page-picking highlight: the box that hugs the hovered element and the floating tag that names its source.
 *
 * Purpose: the box takes the element's own corner radius (set inline by `Overlay`) so rounded cards and pills are
 * outlined along their real edge; the tag reads `tag  file:line  W × H` on a saturated chip that stays legible over
 * any page. Both fade in when the highlight appears and glide together (`.cii-glide`) only when it switches elements.
 * Boundary: composed after the tokens (it reads `--cii-pick*`) and the shell (it reuses `cii-fade-in`); position, size,
 * radius, and visibility are inline runtime values owned by `Overlay`, so none are declared here. The `:empty` rule
 * hides the line suffix in the unmapped state, so the tag needs no extra class per part.
 * @type {string} CSS fragment composed into the shadow-root stylesheet.
 */
export const OVERLAY_STYLE = `
.cii-overlay,
.cii-label {
  position: fixed;
  pointer-events: none;
  z-index: ${OVERLAY_Z_INDEX};
  animation: cii-fade-in 120ms ease-out;
}
.cii-overlay.cii-glide {
  transition-property: left, top, width, height, border-radius;
  transition-duration: 110ms;
  transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
}
.cii-label.cii-glide {
  transition-property: left, top;
  transition-duration: 110ms;
  transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
}

.cii-overlay {
  border: 1.5px solid var(--cii-pick-line);
  background: var(--cii-pick-fill);
  box-shadow: var(--cii-pick-glow);
}
.cii-overlay.cii-nomap {
  border-style: dashed;
  border-color: var(--cii-nomap-line);
  background: var(--cii-nomap-fill);
  box-shadow: none;
}

.cii-label {
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: calc(100vw - 8px);
  height: 22px;
  padding: 0 8px 0 3px;
  border-radius: 7px;
  background: var(--cii-pick-tag);
  color: var(--cii-on-pick-tag);
  box-shadow: var(--cii-pick-tag-shadow);
  font: 500 11.5px/1 var(--cii-font);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  white-space: nowrap;
}
.cii-label.cii-nomap { background: var(--cii-nomap-tag); }
.cii-label-tag {
  flex: none;
  height: 16px;
  padding: 0 5px;
  border-radius: 5px;
  background: var(--cii-on-pick-tag-chip);
  font: 600 10.5px/16px var(--cii-mono);
  letter-spacing: 0;
}
.cii-label-loc { display: flex; min-width: 0; }
.cii-label-file { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.cii-nomap .cii-label-file { font-weight: 500; }
.cii-label-line { flex: none; color: var(--cii-on-pick-tag-muted); }
.cii-label-line:empty { display: none; }
.cii-label-size {
  flex: none;
  padding-left: 7px;
  border-left: 1px solid var(--cii-on-pick-tag-rule);
  color: var(--cii-on-pick-tag-muted);
  line-height: 12px;
}
`;
