import { DIALOG_Z_INDEX } from '../../shared/constants.js';

/**
 * Footer capture icons, their tooltips, and screenshot-menu presentation.
 *
 * Boundary: Requires shell defaults and shared button styles; keep after footer rules so capture controls retain their existing cascade.
 * @type {string} CSS fragment composed into the shadow-root stylesheet in its original cascade order.
 */
export const TOOLS_STYLE = `
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
}`;
