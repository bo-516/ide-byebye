/**
 * Destination notice: the sticky warning card the picker shows above the action bar when the Enter target has a
 * caveat (WorkBuddy groups), with "Dismiss" and "Don't show again" buttons.
 *
 * Boundary: the card is a flex item of `.cii-dialog` between `.cii-body` and `.cii-footer`, so it never overlaps the
 * editor or the destination menu; `flex: none` keeps the scrolling body as the part that shrinks on a short viewport.
 * The `[hidden]` rule must beat the flex display, or a dismissed card would stay on screen. The icon reads the
 * `--cii-mask-alert` mask from ICONS_STYLE and the warning tokens from TOKENS_STYLE. Reduced motion is handled globally
 * in SHELL_STYLE.
 * @type {string} CSS fragment composed into the shadow-root stylesheet after DESTINATION_MORE_STYLE.
 */
export const AGENT_NOTICE_STYLE = `
.cii-agent-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex: none;
  margin: 0 12px 6px;
  padding: 9px 10px 8px;
  border: 1px solid var(--cii-warning-line);
  border-radius: 12px;
  background: var(--cii-warning-soft);
  color: var(--cii-text);
  font: 12px/1.5 var(--cii-font);
  animation: cii-pop 160ms ease-out;
}
.cii-agent-notice[hidden] { display: none; }
.cii-agent-notice-icon {
  flex: none;
  width: 15px;
  height: 15px;
  margin-top: 1px;
  background: var(--cii-warning);
  -webkit-mask: var(--cii-mask-alert);
  mask: var(--cii-mask-alert);
}
.cii-agent-notice-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
}
.cii-agent-notice-title { font-weight: 600; }
.cii-agent-notice-text { color: var(--cii-text-muted); }
.cii-agent-notice-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 4px;
}
.cii-agent-notice-btn {
  height: 24px;
  padding: 0 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--cii-text-muted);
  font: 500 11.5px/1 var(--cii-font);
  cursor: pointer;
}
.cii-agent-notice-btn:hover { background: var(--cii-fill-strong); color: var(--cii-text); }
.cii-agent-notice-btn-strong { background: var(--cii-fill); color: var(--cii-text); }
`;
