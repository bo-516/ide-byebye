import { el, clamp, readJsonStore, writeJsonStore } from './dialog-utils.js';
import { t } from './i18n.js';

/** sessionStorage key for the pinned intent draft (survives SPA navigation and reload, clears on tab close). */
const PIN_DRAFT_KEY = 'code-intent-inspector:pinned-intent';
/** localStorage key for the floating orb position (a durable convenience, like the old dock placement). */
const PIN_ORB_POS_KEY = 'code-intent-inspector:pin-orb-pos';
/** Pointer travel (px) above which a press is treated as a drag, not an orb click. */
const DRAG_THRESHOLD = 4;
const ORB_SIZE = 44;
const ORB_MARGIN = 16;

/**
 * Floating "pinned dialog" orb plus its draft persistence.
 *
 * Boundary: the orb lives in the plugin shadow root and stays interactive via its own `pointer-events:auto` while the
 * host stays click-through, so the page underneath keeps working. The draft is stored in sessionStorage (light: text,
 * references, selection ref, anchor, last agent — never large attachment blobs). The controller does not know how to
 * rebuild the dialog; it calls back `onRestore` when the orb is clicked.
 */
export class DialogPin {
    parent;
    onRestore;
    orbEl = null;
    pos = null;

    /**
     * @param {Node} parent Plugin shadow root that hosts the orb.
     * @param {{ onRestore: () => void }} callbacks Invoked when the user clicks the orb to resume the pinned intent.
     */
    constructor(parent, callbacks) {
        this.parent = parent;
        this.onRestore = typeof callbacks?.onRestore === 'function' ? callbacks.onRestore : () => {};
        this.pos = readJsonStore(PIN_ORB_POS_KEY, null, window.localStorage);
    }

    /**
     * Read the persisted pinned draft.
     * @returns {Record<string, unknown> | null} The stored draft, or null when nothing is pinned.
     */
    readDraft() {
        return readJsonStore(PIN_DRAFT_KEY, null, window.sessionStorage);
    }

    /** Whether a pinned draft currently exists. @returns {boolean} */
    hasDraft() {
        return this.readDraft() != null;
    }

    /**
     * Persist a pinned draft.
     * Boundary: storage failures (private mode/quota) are swallowed; the in-memory warm-restore path still works without
     * persistence. Callers must keep the draft small (no attachment data URLs).
     * @param {Record<string, unknown>} draft Lightweight pinned intent draft.
     * @returns {void}
     */
    writeDraft(draft) {
        try {
            window.sessionStorage.setItem(PIN_DRAFT_KEY, JSON.stringify(draft));
        }
        catch {
            // Pin draft persistence is best-effort; same-session restore still works in memory.
        }
    }

    /** Remove the persisted pinned draft. @returns {void} */
    clearDraft() {
        try {
            window.sessionStorage.removeItem(PIN_DRAFT_KEY);
        }
        catch {
            // ignore storage errors
        }
    }

    /**
     * Show the floating orb, creating it if needed.
     * Boundary: idempotent; repositions an existing orb instead of stacking duplicates.
     * @returns {void}
     */
    showOrb() {
        if (this.orbEl) {
            this.positionOrb();
            return;
        }
        this.orbEl = this.renderOrb();
        this.parent.append(this.orbEl);
        this.positionOrb();
    }

    /** Remove the floating orb from the shadow root. @returns {void} */
    hideOrb() {
        if (this.orbEl) {
            this.orbEl.remove();
            this.orbEl = null;
        }
    }

    /**
     * Build the draggable orb element.
     * Boundary: a press that moves beyond `DRAG_THRESHOLD` is a drag (position persisted) and does not trigger restore;
     * a near-stationary press resumes the pinned intent. The orb sets its own pointer-events so the rest of the page
     * stays click-through.
     * @returns {HTMLButtonElement} Orb button.
     */
    renderOrb() {
        const orb = el('button', 'cii-pin-orb');
        orb.type = 'button';
        orb.title = t('pin.orb.title');
        orb.setAttribute('aria-label', t('pin.orb.title'));
        orb.style.pointerEvents = 'auto';
        orb.append(el('span', 'cii-pin-orb-icon'));
        let dragging = false;
        let moved = 0;
        let startX = 0;
        let startY = 0;
        let baseX = 0;
        let baseY = 0;
        const move = (event) => {
            if (!dragging)
                return;
            moved += Math.abs(event.movementX) + Math.abs(event.movementY);
            this.pos = { x: baseX + (event.clientX - startX), y: baseY + (event.clientY - startY) };
            this.positionOrb();
        };
        const up = () => {
            if (!dragging)
                return;
            dragging = false;
            document.removeEventListener('mousemove', move, true);
            document.removeEventListener('mouseup', up, true);
            if (moved >= DRAG_THRESHOLD)
                writeJsonStore(PIN_ORB_POS_KEY, this.pos, window.localStorage);
        };
        orb.addEventListener('mousedown', (event) => {
            if (event.button !== 0)
                return;
            event.preventDefault();
            dragging = true;
            moved = 0;
            startX = event.clientX;
            startY = event.clientY;
            const rect = orb.getBoundingClientRect();
            baseX = rect.left;
            baseY = rect.top;
            document.addEventListener('mousemove', move, true);
            document.addEventListener('mouseup', up, true);
        });
        orb.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (moved >= DRAG_THRESHOLD)
                return;
            this.onRestore();
        });
        return orb;
    }

    /**
     * Place the orb at its persisted position, or bottom-right by default, clamped to the viewport.
     * @returns {void}
     */
    positionOrb() {
        if (!this.orbEl)
            return;
        const maxX = Math.max(ORB_MARGIN, window.innerWidth - ORB_SIZE - ORB_MARGIN);
        const maxY = Math.max(ORB_MARGIN, window.innerHeight - ORB_SIZE - ORB_MARGIN);
        const x = clamp(this.pos?.x ?? maxX, ORB_MARGIN, maxX);
        const y = clamp(this.pos?.y ?? maxY, ORB_MARGIN, maxY);
        this.orbEl.style.position = 'fixed';
        this.orbEl.style.left = `${Math.round(x)}px`;
        this.orbEl.style.top = `${Math.round(y)}px`;
    }
}
