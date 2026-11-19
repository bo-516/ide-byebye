/**
 * Destination menu sections: pinned rows on top, the rest folded under a one-line "More agents" toggle, a pin button
 * per row, and the dismissible pin tip.
 *
 * Boundary: composed right after DESTINATION_STYLE, whose row, check, and sessions-button rules it extends; it must
 * stay after TOOLS_STYLE so `display: flex` on the open menu beats the dropdown shell (`:not([hidden])` keeps a closed
 * menu hidden). The folded region opens by animating `grid-template-rows` from `0fr` to `1fr`, so its height tracks
 * the content with no script measuring; the menu is rebuilt only when rows change, never to toggle, or the transition
 * would not play. Below the toggle by default (menus open upward, so the toggle stays under the pointer while the
 * region grows above it); `.cii-agent-menu-down` moves the region and tip below the toggle for a menu that opened
 * downward. The list's `max-height` comes from `--cii-agent-more-max`, set by `fitAgentMenu` to the room left in the
 * viewport; its 288px fallback must equal `AGENT_MORE_LIST_MAX` (dialog-agent-fit.ts). Reduced motion is handled
 * globally in SHELL_STYLE.
 * @type {string} CSS fragment composed into the shadow-root stylesheet after DESTINATION_STYLE.
 */
export const DESTINATION_MORE_STYLE = `
.cii-screenshot-menu.cii-agent-menu:not([hidden]) { display: flex; flex-direction: column; }
.cii-agent-menu > * { flex: none; }
.cii-agent-menu-down > .cii-agent-more-region { order: 1; }
.cii-agent-menu-down > .cii-agent-tip { order: 2; }
.cii-menu-sep { height: 1px; margin: 5px 8px; background: var(--cii-line); }

.cii-agent-row-pin {
  position: relative;
  flex: none;
  width: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--cii-text-faint);
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, color 120ms ease;
}
.cii-agent-row-pin:last-child { border-radius: 0 8px 8px 0; }
.cii-agent-row-pin::after {
  content: "";
  width: 14px;
  height: 14px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-pin);
  mask: var(--cii-mask-pin);
}
.cii-agent-row:hover .cii-agent-row-pin,
.cii-agent-row-active .cii-agent-row-pin,
.cii-agent-row-pin:focus-visible { opacity: 1; }
@media (hover: none) { .cii-agent-row-pin { opacity: 1; } }
.cii-agent-row-pin:hover { color: var(--cii-text); }
.cii-agent-row-pinned .cii-agent-row-pin { color: var(--cii-accent); }
.cii-agent-row-pinned .cii-agent-row-pin:hover { color: var(--cii-accent-text); }
.cii-agent-row-pin + .cii-agent-row-sessions { width: 28px; }

.cii-agent-more .cii-agent-row-main { padding: 6px 8px; }
.cii-agent-more .cii-agent-row-label { color: var(--cii-text-muted); }
.cii-agent-more-caret {
  flex: none;
  width: 18px;
  height: 14px;
  background: var(--cii-text-faint);
  -webkit-mask: var(--cii-mask-chevron-down);
  mask: var(--cii-mask-chevron-down);
  transform: rotate(180deg);
  transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.cii-agent-menu-expanded .cii-agent-more-caret,
.cii-agent-menu-down .cii-agent-more-caret { transform: rotate(0deg); }
.cii-agent-menu-down.cii-agent-menu-expanded .cii-agent-more-caret { transform: rotate(180deg); }
.cii-agent-more-count {
  flex: none;
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--cii-fill);
  color: var(--cii-text-faint);
  font: 500 11px/16px var(--cii-font);
  text-align: center;
}

.cii-agent-more-region {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: grid-template-rows 240ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 180ms ease;
}
.cii-agent-menu-expanded > .cii-agent-more-region { grid-template-rows: 1fr; opacity: 1; }
.cii-agent-more-inner { min-height: 0; overflow: hidden; }
.cii-agent-more-list {
  max-height: var(--cii-agent-more-max, 288px);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

.cii-agent-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 4px 2px 0;
  padding: 6px 4px 2px 8px;
  border-top: 1px solid var(--cii-line);
  color: var(--cii-text-faint);
  font: 11.5px/1.45 var(--cii-font);
}
.cii-agent-tip-text { flex: 1 1 auto; min-width: 0; }
.cii-agent-tip code { font: 11px/1 var(--cii-mono); color: var(--cii-text-muted); }
.cii-agent-tip-pin {
  display: inline-block;
  width: 11px;
  height: 11px;
  vertical-align: -1px;
  background: var(--cii-accent);
  -webkit-mask: var(--cii-mask-pin);
  mask: var(--cii-mask-pin);
}
.cii-agent-tip-close {
  flex: none;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--cii-text-faint);
  cursor: pointer;
}
.cii-agent-tip-close::before {
  content: "";
  width: 11px;
  height: 11px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-x);
  mask: var(--cii-mask-x);
}
.cii-agent-tip-close:hover { background: var(--cii-fill-strong); color: var(--cii-text); }
`;
