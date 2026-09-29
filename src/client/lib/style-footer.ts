/**
 * Action bar (capture tools left; Copy, destination picker, and Send right) and the shared `.cii-btn` buttons.
 *
 * Boundary: Send is the only filled control in the dialog; everything else stays a quiet ghost button so the eye goes
 * to the text and the one action. Hover feedback is only a scale to 1.06 over 120ms; the fill stays the resting
 * gradient. Do not transition `background` onto a solid hover colour: that shorthand resets `background-color` through
 * transparent and flashes the surface. Both Copy labels share one grid cell and render as icons, so the confirmation only
 * swaps glyphs and never shifts the bar. The rule is `button.cii-agent-clipboard` because `.cii-icon-btn` is composed
 * later at the same class specificity and would set `display: inline-flex`, laying the hidden confirmation beside the
 * glyph and shifting the icon left of the button and of its centered tip. With no destination offered the dialog hides
 * Send and Copy is promoted to
 * the filled circle (`:has()`; without it Copy simply stays a ghost button). Tips in the send group align to the right
 * edge so they never leave a panel parked at the viewport's right margin. Copy is the exception while a destination
 * sits to its right: its tip is centered on the icon, because a right-edge tip on that narrow control hangs left over
 * the composer. When Send is hidden, Copy is the rightmost control and keeps the right-edge tip. Requires the tokens
 * and icon masks.
 * @type {string} CSS composed into STYLE_TEXT before session-control overrides.
 */
export const FOOTER_STYLE = `
.cii-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: 0 0 auto;
  padding: 4px 10px 10px 12px;
}
.cii-footer-tools {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.cii-send-group {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  margin-left: auto;
}
.cii-send-group [data-cii-tip]::after { left: auto; right: 0; transform: translateY(3px); }
.cii-send-group [data-cii-tip]:hover::after,
.cii-send-group [data-cii-tip]:focus-visible::after { transform: none; }
/* Copy sits left of the destination pill. A right-edge tip on the 32px icon hangs over the composer, so center it.
   The -50% has to live here: the rule above replaces the shared tooltip's translate(-50%). When Send is hidden, Copy
   is the rightmost control and keeps the right-edge tip so the bubble stays inside the panel. */
.cii-send-group .cii-agent-clipboard[data-cii-tip]::after { left: 50%; right: auto; transform: translate(-50%, 3px); }
.cii-send-group .cii-agent-clipboard[data-cii-tip]:hover::after,
.cii-send-group .cii-agent-clipboard[data-cii-tip]:focus-visible::after { transform: translate(-50%, 0); }
.cii-footer:has(.cii-send-btn[hidden]) .cii-agent-clipboard[data-cii-tip]::after { left: auto; right: 0; transform: translateY(3px); }
.cii-footer:has(.cii-send-btn[hidden]) .cii-agent-clipboard[data-cii-tip]:hover::after,
.cii-footer:has(.cii-send-btn[hidden]) .cii-agent-clipboard[data-cii-tip]:focus-visible::after { transform: none; }

.cii-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 14px;
  border: 0;
  border-radius: 10px;
  font: 500 13px/1 var(--cii-font);
  white-space: nowrap;
  cursor: pointer;
  transition: background 120ms ease, box-shadow 120ms ease, color 120ms ease, opacity 120ms ease;
}
.cii-btn:disabled { opacity: 0.5; cursor: default; }
.cii-btn-primary {
  background: linear-gradient(180deg, var(--cii-ink-top), var(--cii-ink));
  color: var(--cii-on-ink);
  box-shadow: var(--cii-shadow-ink);
}
.cii-btn-primary:hover:not(:disabled) { background: var(--cii-ink-hover); }
.cii-btn-secondary { background: var(--cii-key); color: var(--cii-text); box-shadow: var(--cii-shadow-key); }
.cii-btn-secondary:hover:not(:disabled) { box-shadow: var(--cii-shadow-key-hover); }

/* .cii-icon-btn later sets display: inline-flex. Without the element selector the idle and copied labels sit in a
   row, the hidden one still takes 17px, and the visible glyph lands left of the button center. */
button.cii-agent-clipboard { display: inline-grid; place-items: center; }
.cii-copy-label { grid-area: 1 / 1; display: inline-flex; font-size: 0; }
.cii-copy-label::before {
  content: "";
  width: 17px;
  height: 17px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-copy);
  mask: var(--cii-mask-copy);
}
.cii-copy-done::before { -webkit-mask: var(--cii-mask-check); mask: var(--cii-mask-check); }
.cii-copy-done,
.cii-agent-copied > .cii-copy-idle { visibility: hidden; }
.cii-agent-copied > .cii-copy-done { visibility: visible; }
.cii-agent-clipboard.cii-agent-copied,
.cii-agent-clipboard.cii-agent-copied:hover:not(:disabled) { background: var(--cii-success-soft); color: var(--cii-success); }

.cii-send-btn {
  position: relative;
  flex: none;
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: linear-gradient(180deg, var(--cii-ink-top), var(--cii-ink));
  color: var(--cii-on-ink);
  box-shadow: var(--cii-shadow-ink);
  cursor: pointer;
  transition: transform 120ms ease, opacity 120ms ease;
}
.cii-send-btn:hover:not(:disabled):not(.cii-send-unavailable) { transform: scale(1.06); }
.cii-send-btn[hidden] { display: none; }
.cii-send-btn svg { display: block; }
/* Press wins over the hover scale. The hover rule is more specific, so :active alone would lose while the pointer is still inside. */
.cii-send-btn:active:not(:disabled),
.cii-send-btn:hover:active:not(:disabled) { transform: scale(0.94); }
.cii-send-btn:disabled { opacity: 0.45; cursor: default; }
.cii-send-btn.cii-send-unavailable { background: var(--cii-fill-strong); color: var(--cii-text-muted); box-shadow: none; }
/* An app handoff in flight: the arrow gives way to a spinner (drawn on ::before; ::after carries the tooltip). */
.cii-sending .cii-send-btn:disabled { opacity: 1; }
.cii-sending .cii-send-btn svg { visibility: hidden; }
.cii-sending .cii-send-btn::before {
  content: "";
  position: absolute;
  inset: 9px;
  border-radius: 50%;
  border: 2px solid var(--cii-on-ink-soft);
  border-top-color: var(--cii-on-ink);
  animation: cii-spin 700ms linear infinite;
}
/* Clipboard-only setups have no destination, so Copy takes Send's place and look. */
.cii-footer:has(.cii-send-btn[hidden]) .cii-agent-clipboard:not(.cii-agent-copied) {
  border-radius: 50%;
  background: linear-gradient(180deg, var(--cii-ink-top), var(--cii-ink));
  color: var(--cii-on-ink);
  box-shadow: var(--cii-shadow-ink);
}
`;
