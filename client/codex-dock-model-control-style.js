/**
 * CODEX_DOCK_MODEL_CONTROL_STYLE_TEXT: corrective source style for the Codex dock model control.
 * Purpose: keeps the right-side model picker aligned with the composer action row by pairing the visual `-8px` top
 * offset with an equal bottom margin, and renders the chevron from `>` plus a rotation transform without editing the
 * generated `client.js` bundle or the oversized base stylesheet.
 * Boundary: this stylesheet is appended after the base shadow-root stylesheet and only targets the dock model picker;
 * injecting it before the base stylesheet lets later rules override the offset, while injecting it outside the shadow
 * root has no visual effect.
 * @type {string} CSS text appended to the plugin shadow root.
 */
export const CODEX_DOCK_MODEL_CONTROL_STYLE_TEXT = `
.cii-codex-model-picker {
  margin-top: -8px;
  margin-bottom: 8px;
}
.cii-codex-model-chevron {
  position: relative;
  color: transparent;
  font-size: 0;
}
.cii-codex-model-chevron::before {
  content: ">";
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font: 650 15px/18px Geist, Inter, system-ui, sans-serif;
  transform: rotate(90deg);
  transform-origin: 50% 50%;
}
`;

/**
 * Install the Codex dock model-control alignment stylesheet into a UI root.
 * Purpose: applies the source-owned alignment patch once the plugin shadow root exists.
 * Boundary: `root` must be the shadow root returned by `createUi`; passing `null`, an ordinary object, or a detached
 * value without `appendChild` skips installation and the model picker falls back to the base vertical alignment.
 *
 * @param {ShadowRoot | Element | null | undefined} root UI root that receives the supplemental style element.
 * @returns {HTMLStyleElement | null} The appended style element, or `null` when `root` cannot receive children.
 */
export function installCodexDockModelControlStyle(root) {
    if (!root || typeof root.appendChild !== 'function')
        return null;
    const style = document.createElement('style');
    style.textContent = CODEX_DOCK_MODEL_CONTROL_STYLE_TEXT;
    root.appendChild(style);
    return style;
}
