/**
 * Reference chips, screenshot previews, and image-lightbox presentation.
 *
 * Boundary: Requires the shell stylesheet reset and dialog context; using these rules alone loses shared sizing and inherited typography.
 * @type {string} CSS fragment composed into the shadow-root stylesheet in its original cascade order.
 */
export const PREVIEWS_STYLE = `
.cii-reference-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 10px;
}
.cii-reference-preview[hidden] { display: none; }
.cii-code-ref-chip {
  max-width: 100%;
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 6px 0 10px;
  border: 1px solid currentColor;
  border-radius: 999px;
  color: inherit;
  opacity: 0.78;
}
.cii-code-ref-link,
.cii-code-ref-remove {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.cii-code-ref-link {
  max-width: min(260px, 70vw);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  text-decoration: underline;
}
.cii-code-ref-remove {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 999px;
  font: 16px/1 system-ui, sans-serif;
}

.cii-screenshot-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: 12px;
}
.cii-screenshot-preview[hidden] { display: none; }
.cii-screenshot-thumb {
  position: relative;
  width: 116px;
  height: 82px;
  padding: 0;
  border: 1px solid #e0e3e5;
  border-radius: 8px;
  background: #f7f9fb;
  overflow: hidden;
  cursor: pointer;
}
.cii-thumb-media {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #eceef0;
}
.cii-thumb-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cii-thumb-loading {
  width: 42px;
  height: 42px;
  border-radius: 999px;
  border: 3px solid rgba(80, 95, 118, 0.2);
  border-top-color: #505f76;
  animation: cii-spin 800ms linear infinite;
}
.cii-thumb-remove {
  width: 24px;
  height: 24px;
  position: absolute;
  top: 5px;
  right: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.86);
  color: #424754;
  font: 18px/1 system-ui, sans-serif;
  cursor: pointer;
}
.cii-thumb-remove:hover { background: #ffffff; color: #191c1e; }
.cii-thumb-pending { opacity: 0.78; }
@keyframes cii-spin { to { transform: rotate(360deg); } }

.cii-image-lightbox {
  position: fixed;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.64);
}
.cii-image-frame {
  position: relative;
  max-width: min(92vw, 1100px);
  max-height: 86vh;
}
.cii-image-frame img {
  display: block;
  max-width: 100%;
  max-height: 86vh;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 20px 60px rgba(0,0,0,0.35);
}
.cii-image-close {
  position: absolute;
  top: -12px;
  right: -12px;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: #ffffff;
  color: #191c1e;
  font: 20px/1 system-ui, sans-serif;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(0,0,0,0.18);
}
`;
