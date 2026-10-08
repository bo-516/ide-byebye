'use client';

import { useState } from 'react';
import { LibOverlay } from './LibOverlay';

/**
 * Opens a library overlay that portals into `document.body`. Picking its mask should land on the `<LibOverlay>` line
 * here, not on the stamped `<body>` in `layout.tsx`.
 *
 * @returns {unknown} The open button plus the overlay while it is open.
 */
export function PortalCase() {
    const [open, setOpen] = useState(false);
    return (
        <section>
            <button type="button" onClick={() => setOpen(true)}>
                Open overlay
            </button>
            {open && (
                <LibOverlay onClose={() => setOpen(false)}>
                    <p>Overlay content written in PortalCase.tsx</p>
                    <button type="button" onClick={() => setOpen(false)}>
                        Close
                    </button>
                </LibOverlay>
            )}
        </section>
    );
}
