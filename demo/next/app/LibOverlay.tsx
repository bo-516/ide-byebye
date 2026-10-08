// ide-byebye-ignore — stands in for a component library: nothing in this file is stamped.
'use client';

import { createPortal } from 'react-dom';

/**
 * Library-style overlay rendered into `document.body`. Like most library overlays it drops unknown props, so the mask
 * and the box carry no `data-insp-path`; only `children` come from stamped user code.
 *
 * @param {{ onClose: () => void, children: unknown }} props Close handler and overlay content.
 * @returns {unknown} The portal.
 */
export function LibOverlay({ onClose, children }) {
    return createPortal(
        <div
            className="lib-overlay-mask"
            onClick={onClose}
            style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(0, 0, 0, 0.35)' }}
        >
            <div
                className="lib-overlay-box"
                onClick={(event) => event.stopPropagation()}
                style={{ minWidth: 280, padding: 20, borderRadius: 12, background: 'white' }}
            >
                {children}
            </div>
        </div>,
        document.body,
    );
}
