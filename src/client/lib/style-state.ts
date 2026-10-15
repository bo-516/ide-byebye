/**
 * Component-state tool: its footer icon, the popover's start button, the state chips, and the accent recolour of the
 * shared floating pill while watching.
 *
 * Boundary: builds on the capture-tool rules (`cii-screenshot-menu`, `cii-screenshot-choice`, `cii-style-chip`) and the
 * recording pill (`cii-rec-indicator`), so it must come after CAPTURE_STYLE and RECORDING_STYLE. Watching is not
 * alarming like recording, so it uses the accent colour where recording uses danger; the pill is dark in both themes,
 * so its dot uses `--cii-pill-accent`, a lighter accent that reads on it.
 * @type {string} CSS fragment composed into the shadow-root stylesheet.
 */
export const STATE_STYLE = `
.cii-state-icon {
  width: 18px;
  height: 18px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-activity);
  mask: var(--cii-mask-activity);
}
.cii-state-toggle:hover:not(:disabled),
.cii-state-picker:has(> .cii-state-menu:not([hidden])) > .cii-state-toggle { color: var(--cii-accent); }
.cii-screenshot-menu.cii-state-menu { width: 220px; padding: 6px; }
.cii-state-start {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 34px;
  margin-top: 6px;
  border: 0;
  border-radius: 8px;
  background: var(--cii-accent);
  color: var(--cii-on-accent);
  font: 600 13px/1 var(--cii-font);
  cursor: pointer;
  transition: filter 120ms ease;
}
.cii-state-start:hover { filter: brightness(1.08); }
.cii-state-chip { margin-right: 6px; cursor: default; }
.cii-state-chip-icon {
  flex: none;
  width: 15px;
  height: 15px;
  background: var(--cii-accent);
  -webkit-mask: var(--cii-mask-activity);
  mask: var(--cii-mask-activity);
}
.cii-state-indicator .cii-rec-indicator-dot {
  background: var(--cii-pill-accent);
  box-shadow: 0 0 0 4px var(--cii-accent-soft);
}
.cii-state-indicator .cii-rec-indicator-stop::before { background: var(--cii-accent); }
`;
