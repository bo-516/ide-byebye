import { INSP_PATH_ATTR } from '../../shared/constants.js';
import { pickedLocation } from './dialog-render-chain.js';
import { anchorFromElement, loadLastAgent, sourceReferenceLabel } from './dialog-utils.js';
import { DialogSend } from './dialog-send.js';
import type { PinnedDraft } from './dialog-types.js';

/**
 * Pin layer of {@link Dialog}: collapsing the open dialog into the floating orb and restoring it —
 * either from the detached in-memory node or from a light sessionStorage draft after a reload.
 *
 * Boundary: attachments are session-only; only text, references, and the primary selection survive a
 * full reload. `close` is inherited from the send layer, which is why this layer sits above it.
 */
export abstract class DialogPins extends DialogSend {
    pinnedNode: HTMLElement | null = null;

    /**
     * Build the lightweight draft persisted when the dialog is pinned.
     *
     * Boundary: intentionally excludes attachment blobs (screenshots/recordings) so it stays small enough for
     * sessionStorage; the in-memory warm restore keeps live attachments, while a cold restore after a full reload
     * recovers text, references, and the primary selection only.
     *
     * @returns {Record<string, unknown>} Serializable pinned draft.
     */
    buildColdDraft() {
        return {
            content: this.editor.exportContent(),
            primary: this.selection
                ? { label: this.primaryLabel || sourceReferenceLabel(this.selection, 0), selection: this.selection }
                : null,
            selection: this.selection,
            // The clicked element, even after the primary was switched to a mount point that has no DOM node.
            selector: pickedLocation(this.selection),
            anchor: this.anchor,
            lastAgent: this.lastAgent,
        };
    }

    /**
     * Collapse the open dialog into the floating orb without losing its content.
     *
     * Boundary: keeps the live dialog DOM detached in memory (`pinnedNode`) for a perfect same-session restore, and also
     * persists a light draft so the orb and text survive a full page reload. Page-level listeners are removed and open
     * destination/session menus are closed while pinned so Escape, arrows, and resize do not act on the detached
     * dialog. No-op when the dialog is not open.
     *
     * @returns {void}
     */
    pinDialog() {
        if (!this.backdrop)
            return;
        this.pin.writeDraft(this.buildColdDraft());
        this.picker?.close();
        this.sessions?.closeMenu();
        this.pinnedNode = this.backdrop;
        this.parent.removeChild(this.backdrop);
        this.backdrop = null;
        this.disableFocusGuard();
        this.setHostInteractive(false);
        document.removeEventListener('keydown', this.keyHandler, true);
        this.parent.removeEventListener('keydown', this.keyHandler, true);
        window.removeEventListener('resize', this.resizeHandler, true);
        this.pin.showOrb();
    }

    /**
     * Resume a pinned intent from the orb.
     *
     * Boundary: prefers the in-memory detached dialog (full fidelity, including attachments). After a reload that node is
     * gone, so it falls back to a cold restore from the persisted draft. Hides the orb either way.
     *
     * @returns {void}
     */
    handleOrbRestore() {
        if (this.pinnedNode) {
            this.parent.append(this.pinnedNode);
            this.backdrop = this.pinnedNode;
            this.pinnedNode = null;
            this.enableFocusGuard();
            this.setHostInteractive(true);
            document.addEventListener('keydown', this.keyHandler, true);
            this.parent.addEventListener('keydown', this.keyHandler, true);
            window.addEventListener('resize', this.resizeHandler, true);
            if (this.dialogEl)
                this.positionDialog(this.dialogEl, this.anchor);
            this.pin.hideOrb();
            this.focusIntent({ retry: true });
            return;
        }
        const draft = this.pin.readDraft();
        if (!draft) {
            this.pin.hideOrb();
            return;
        }
        this.coldRestore(draft);
    }

    /**
     * Rebuild a fresh dialog from a persisted draft after a full page reload.
     *
     * Boundary: re-resolves the selected element from its `data-insp-path` (it may be a new node after an SPA re-render);
     * when the element is gone the dialog still opens for text-only editing and selection-scoped screenshots simply fail
     * gracefully. Attachments are not restored on a cold path — they are preserved only across same-session navigation.
     *
     * @param {PinnedDraft} draft Pinned draft from `buildColdDraft`.
     * @returns {void}
     */
    coldRestore(draft: PinnedDraft) {
        if (this.backdrop)
            this.close();
        this.selection = draft.selection ?? null;
        this.selectedElement = this.resolveSelector(draft.selector);
        this.screenshotElement = this.selectedElement;
        this.anchor = draft.anchor ?? anchorFromElement(this.selectedElement);
        this.screenshots.reset();
        this.recordings.reset();
        this.references.reset();
        this.styles.reset();
        this.editor.reset();
        this.lastAgent = draft.lastAgent || loadLastAgent(this.config);
        this.enableFocusGuard();
        this.render(this.selection);
        if (draft.primary) {
            this.primaryLabel = draft.primary.label ?? null;
            this.editor.setPrimary(draft.primary);
        }
        if (Array.isArray(draft.content))
            this.editor.importContent(draft.content);
        this.pin.hideOrb();
        if (this.selection)
            void this.resolve(this.selection);
        void this.loadAgents();
        this.focusIntent({ retry: true });
    }

    /**
     * Discard any pinned state (in-memory node, orb, and persisted draft).
     *
     * Boundary: called when a new selection is opened or the dialog is explicitly closed/sent, so a stale pin cannot
     * linger. The detached in-memory node already had its listeners removed in `pinDialog`, so dropping the reference is
     * enough for it to be garbage-collected.
     *
     * @returns {void}
     */
    discardPin() {
        this.pinnedNode = null;
        this.pin.clearDraft();
        this.pin.hideOrb();
    }

    /**
     * Show the orb on startup when a pinned draft survived a reload.
     *
     * @returns {void}
     */
    restorePinnedIfAny() {
        if (this.pin.hasDraft())
            this.pin.showOrb();
    }

    /**
     * Re-resolve the selected page element from a stored `data-insp-path` value.
     *
     * Boundary: the original node reference is invalid after a reload, so the element is looked up fresh by attribute.
     * Returns null when no current node matches, which the dialog handles by degrading to text-only/viewport capture.
     *
     * @param {string | null | undefined} inspPath Stored `data-insp-path` selector value.
     * @returns {Element | null} The matching current element, or null.
     */
    resolveSelector(inspPath?: string | null): Element | null {
        if (!inspPath)
            return null;
        try {
            return document.querySelector(`[${INSP_PATH_ATTR}="${String(inspPath).replace(/["\\]/g, '\\$&')}"]`);
        }
        catch {
            return null;
        }
    }
}
