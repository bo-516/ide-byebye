import { DIALOG_Z_INDEX } from '../../shared/constants.js';

/**
 * Toolbar icon buttons, their tooltips, and the shared dropdown-menu presentation (screenshot, recording scope, style).
 *
 * Boundary: requires the tokens, icon masks, and shared button styles; keep after footer rules so capture controls
 * retain their cascade. Icons are painted through masks on the existing glyph spans, so no controller markup changes.
 * Menus open upward by default; `placeDropdownPanel` flips and clamps them inline, which is why their entrance
 * animation may transform freely (placement reads `offsetWidth/offsetHeight`, not the transformed box).
 * @type {string} CSS fragment composed into the shadow-root stylesheet in its original cascade order.
 */
export const TOOLS_STYLE = `
.cii-screenshot-picker { position: relative; }
.cii-icon-btn {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--cii-text-muted);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.cii-icon-btn:hover:not(:disabled) { background: var(--cii-fill); color: var(--cii-text); }
.cii-icon-btn-active,
.cii-icon-btn-active:hover:not(:disabled) { background: var(--cii-accent-soft); color: var(--cii-accent-text); }
.cii-icon-btn:disabled { opacity: 0.45; cursor: default; }
/* A tool whose dropdown is open reads as pressed (an already-active tool keeps its accent). */
.cii-screenshot-picker:has(> .cii-screenshot-menu:not([hidden])) > .cii-icon-btn:not(.cii-icon-btn-active) {
  background: var(--cii-fill-strong);
  color: var(--cii-text);
}
.cii-code-ref-icon,
.cii-shot-icon,
.cii-style-icon {
  width: 18px;
  height: 18px;
  background: currentColor;
}
.cii-code-ref-icon { -webkit-mask: var(--cii-mask-at); mask: var(--cii-mask-at); }
.cii-shot-icon { -webkit-mask: var(--cii-mask-capture); mask: var(--cii-mask-capture); }
.cii-style-icon { -webkit-mask: var(--cii-mask-palette); mask: var(--cii-mask-palette); }

/* --- Tooltips ---
   A compact bubble driven by \`data-cii-tip\`, replacing the native title= tooltip on icon controls: same look everywhere
   and no ~1s browser delay. It opens upward out of the toolbar (the panel is overflow:visible) and is suppressed while
   that control's own dropdown is open so it can never sit on top of the menu. */
[data-cii-tip] { position: relative; }
[data-cii-tip]::after {
  content: attr(data-cii-tip);
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  z-index: ${DIALOG_Z_INDEX};
  padding: 5px 8px;
  border-radius: 7px;
  background: var(--cii-tip-bg);
  color: var(--cii-tip-text);
  font: 500 11.5px/1.3 var(--cii-font);
  white-space: nowrap;
  box-shadow: 0 6px 18px -4px rgba(0, 0, 0, 0.35);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translate(-50%, 3px);
  transition: opacity 120ms ease, transform 120ms ease, visibility 0s linear 120ms;
}
[data-cii-tip]:hover::after,
[data-cii-tip]:focus-visible::after {
  opacity: 1;
  visibility: visible;
  transform: translate(-50%, 0);
  transition-delay: 180ms;
}
/* Header tips open downward and right-aligned: upward would leave the viewport when the panel hugs the top edge. */
.cii-header [data-cii-tip]::after { top: calc(100% + 8px); bottom: auto; left: auto; right: 0; transform: translateY(-3px); }
.cii-header [data-cii-tip]:hover::after,
.cii-header [data-cii-tip]:focus-visible::after { transform: none; }
/* An open dropdown hides its trigger's tooltip. Higher specificity than the :hover rule, so it wins. */
.cii-screenshot-picker:has(> .cii-screenshot-menu:not([hidden])) > [data-cii-tip]::after {
  opacity: 0;
  visibility: hidden;
}

.cii-screenshot-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 5;
  width: 212px;
  padding: 4px;
  background: var(--cii-surface-raised);
  color: var(--cii-text);
  border-radius: 12px;
  box-shadow: var(--cii-shadow-pop);
  animation: cii-pop 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.cii-screenshot-menu[hidden] { display: none; }
.cii-screenshot-choice {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px 7px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--cii-text);
  font: 500 13px/1.25 var(--cii-font);
  text-align: left;
  cursor: pointer;
}
.cii-screenshot-choice:hover { background: var(--cii-fill); }
/* Multi-select rows show a checkbox; the active one fills with the accent and a check glyph (the text ✓ is hidden). */
.cii-choice-mark {
  flex: none;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  box-shadow: inset 0 0 0 1.5px var(--cii-line-strong);
  color: #ffffff;
  font-size: 0;
  transition: background 120ms ease, box-shadow 120ms ease;
}
.cii-choice-active .cii-choice-mark { background: var(--cii-accent); box-shadow: none; }
.cii-choice-active .cii-choice-mark::before {
  content: "";
  width: 12px;
  height: 12px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-check);
  mask: var(--cii-mask-check);
}
`;
