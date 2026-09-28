/**
 * Attachment thumbnails (screenshots and recordings) and the full-size image lightbox.
 *
 * Boundary: requires the tokens, icon masks, and shell reset; used alone the thumbnails lose their surfaces and the
 * close glyphs paint as empty boxes. Preview rows are flex items of the dialog body, so screenshot, recording, and
 * style attachments line up in one wrapping row. Remove buttons reveal on hover/focus only where hover exists, so
 * touch users always see them.
 * @type {string} CSS fragment composed into the shadow-root stylesheet in its original cascade order.
 */
export const PREVIEWS_STYLE = `
.cii-screenshot-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.cii-screenshot-preview[hidden] { display: none; }
.cii-screenshot-thumb {
  position: relative;
  width: 96px;
  height: 68px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: var(--cii-surface-sunken);
  box-shadow: 0 0 0 1px var(--cii-line);
  overflow: hidden;
  cursor: zoom-in;
  transition: box-shadow 140ms ease;
}
.cii-screenshot-thumb:hover {
  box-shadow: 0 0 0 1px var(--cii-line-strong), 0 8px 18px -8px rgba(0, 0, 0, 0.35);
}
.cii-thumb-media {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--cii-surface-sunken);
}
.cii-thumb-media img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cii-thumb-loading {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 2px solid var(--cii-line-strong);
  border-top-color: var(--cii-accent);
  animation: cii-spin 700ms linear infinite;
}
.cii-thumb-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 1;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(18, 18, 22, 0.72);
  color: #ffffff;
  font-size: 0;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, background 120ms ease;
}
.cii-thumb-remove::before {
  content: "";
  width: 10px;
  height: 10px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-x);
  mask: var(--cii-mask-x);
}
.cii-thumb-remove:hover { background: rgba(18, 18, 22, 0.92); }
.cii-screenshot-thumb:hover .cii-thumb-remove,
.cii-screenshot-thumb:focus-within .cii-thumb-remove { opacity: 1; }
@media (hover: none) { .cii-thumb-remove { opacity: 1; } }
.cii-thumb-pending { opacity: 0.72; }

.cii-image-lightbox {
  position: fixed;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: var(--cii-scrim-strong);
  backdrop-filter: blur(8px);
  animation: cii-fade-in 160ms ease-out;
}
.cii-image-frame {
  position: relative;
  max-width: min(92vw, 1100px);
  max-height: 86vh;
  animation: cii-pop 200ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.cii-image-frame img {
  display: block;
  max-width: 100%;
  max-height: 86vh;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 30px 80px -20px rgba(0, 0, 0, 0.6);
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
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--cii-surface-raised);
  color: var(--cii-text);
  box-shadow: var(--cii-shadow-pop);
  font-size: 0;
  cursor: pointer;
}
.cii-image-close::before {
  content: "";
  width: 12px;
  height: 12px;
  background: currentColor;
  -webkit-mask: var(--cii-mask-x);
  mask: var(--cii-mask-x);
}
`;
