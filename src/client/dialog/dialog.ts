import { anchorFromElement, loadLastAgent, sourceReferenceLabel } from './dialog-utils.js';
import { DialogShell } from './dialog-shell.js';
import type { DialogAnchor, ElementSelection } from './dialog-types.js';

/**
 * The intent dialog controller — the top of a layered class split by domain:
 * `dialog-layout` (fields, controller wiring, focus/viewport/state helpers) → `dialog-clipboard`
 * (OS clipboard) → `dialog-send` (resolve/send round-trips, `close`) → `dialog-pins` (orb pin/restore)
 * → `dialog-shell` (DOM render, Escape/Enter) → `Dialog` (`open`). The layering keeps `Dialog.prototype`
 * method lookups unchanged while each file stays under the 400-line cap.
 */
export class Dialog extends DialogShell {
    /**
     * Open the intent dialog for the initial page selection.
     * Boundary: each open call resets transient screenshots and extra references. Existing dialogs are closed first so
     * event listeners and pending captures from the previous selection cannot leak into the new request.
     * @param {ElementSelection} selection Browser selection collected from the picked element.
     * @param {Element | null | undefined} selectedElement Source-mapped element used for route resolution and dialog positioning.
     * @param {DialogAnchor | null | undefined} anchor Optional viewport click point.
     * @param {Element | null | undefined} screenshotElement Real clicked element used as screenshot anchor; omitted values fall back to `selectedElement`.
     * @returns {void}
     */
    open(selection: ElementSelection, selectedElement?: Element | null, anchor?: DialogAnchor | null, screenshotElement?: Element | null) {
        if (this.backdrop)
            this.close();
        this.discardPin();
        this.selection = selection;
        this.selectedElement = selectedElement ?? null;
        this.screenshotElement = screenshotElement ?? this.selectedElement;
        this.anchor = anchor ?? anchorFromElement(this.selectedElement);
        this.screenshots.reset();
        this.recordings.reset();
        this.references.reset();
        this.styles.reset();
        this.editor.reset();
        this.lastAgent = loadLastAgent(this.config);
        this.enableFocusGuard();
        this.render(selection);
        // Show the clicked element immediately as a non-removable pinned chip; resolve(undefined) upgrades the label.
        this.primaryLabel = sourceReferenceLabel(selection, 0);
        this.editor.setPrimary({ label: this.primaryLabel, selection });
        void this.screenshots.captureSelected();
        void this.resolve(selection);
        void this.loadAgents();
        this.focusIntent({ retry: true });
    }
}
