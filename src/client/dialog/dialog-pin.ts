import { el, readJsonStore, writeJsonStore } from './dialog-utils.js';
import {
    bindFloatingDrag,
    clampFloatingPoint,
    floatingRole,
    snapFloatingPoint,
    toFloatingPoint,
    type FloatingPoint,
    type FloatingRole,
} from './floating-control.js';
import { t } from '../lib/i18n.js';
import type { PinnedDraft } from './dialog-types.js';

/** sessionStorage key for the pinned intent draft (survives SPA navigation and reload, clears on tab close). */
const PIN_DRAFT_KEY = 'code-intent-inspector:pinned-intent';
/** localStorage key for the floating control position (a durable convenience, like the old dock placement). */
const PIN_ORB_POS_KEY = 'code-intent-inspector:pin-orb-pos';
/** Class that turns the orb into the pick button (inspect glyph, idle transparency, edge snapping transitions). */
const PICK_BUTTON_CLASS = 'cii-pick-btn';
/** Class for the pick button's cancel face while touch pick mode is on. */
const PICKING_CLASS = 'cii-picking';
/** Class for the pick button's resume face (pin glyph plus badge) while a dialog is pinned. */
const PINNED_CLASS = 'cii-pinned';
/** i18n key of the title and accessible name for each face. */
const ROLE_TITLES: Record<FloatingRole, string> = {
    orb: 'pin.orb.title',
    pick: 'pick.button.title',
    cancel: 'pick.button.cancel',
    resume: 'pin.orb.title',
};

/** Hooks boot wires in once touch pick mode exists. */
export interface PickButtonHooks {
    /** Toggle touch pick mode. */
    onPick(): void;
    /** Whether touch pick mode is on; the button then shows its cancel face. */
    isPicking(): boolean;
}

/**
 * Viewport size for placement.
 * @returns {{ width: number, height: number }} `innerWidth` / `innerHeight`.
 */
function viewport() {
    return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Floating control — the "pinned dialog" orb, which doubles as the touch pick button — plus its draft persistence.
 *
 * Boundary: the control lives in the plugin shadow root and stays interactive via its own `pointer-events:auto` while
 * the host stays click-through, so the page underneath keeps working. The draft is stored in sessionStorage (light:
 * text, references, selection ref, anchor, last agent — never large attachment blobs). The controller neither rebuilds
 * the dialog nor picks: a tap calls back `onRestore` or {@link PickButtonHooks.onPick}. With the pick button off the
 * control is exactly the old orb, shown from `showOrb` until `hideOrb`. With it on, the control shows whenever the
 * dialog is closed; that is re-read at the end of the current task, because `Dialog.open` drops the pin before it
 * renders and `close` drops it after.
 */
export class DialogPin {
    /** Shadow root (or any parent) the control is appended to. `Node` alone has no `append`. */
    parent: ParentNode;
    /** Resume handler. A missing callback is replaced with a no-op so a half-built controller cannot throw. */
    onRestore: () => void;
    /** Whether the dialog is on screen (or hidden for reference picking); the pick button hides while it is. */
    isDialogOpen: () => boolean;
    /** Live control, or null while it is hidden. */
    orbEl: HTMLButtonElement | null = null;
    /** Face the live control shows; null while hidden. */
    role: FloatingRole | null = null;
    /**
     * Last dragged or stored position. Null until a drag or a stored point is read; `= null` would otherwise stick
     * as the only type and reject the point written on drag.
     */
    pos: FloatingPoint | null = null;
    /** A dialog is pinned: set by `showOrb`, cleared by `hideOrb`. */
    pinned = false;
    /** Pick-button hooks; null until boot enables the pick button, which keeps the plain orb. */
    pickHooks: PickButtonHooks | null = null;
    /** The pick button is on right now: its mode allows it and, for `'touch'`, the pointer is coarse. */
    buttonShown = false;
    /** A re-render is queued for the end of the current task. */
    syncQueued = false;

    /**
     * @param {ParentNode} parent Plugin shadow root that hosts the control. Must support `append` (a `ShadowRoot` does).
     * @param {{ onRestore?: () => void, isDialogOpen?: () => boolean } | null | undefined} callbacks `onRestore` resumes
     *        the pinned intent; missing makes a resume tap a no-op. `isDialogOpen` reports the dialog; missing reads as
     *        closed, so the pick button would stay up over an open dialog.
     */
    constructor(parent: ParentNode, callbacks?: { onRestore?: () => void; isDialogOpen?: () => boolean } | null) {
        this.parent = parent;
        this.onRestore = typeof callbacks?.onRestore === 'function' ? callbacks.onRestore : () => {};
        this.isDialogOpen = typeof callbacks?.isDialogOpen === 'function' ? callbacks.isDialogOpen : () => false;
        this.pos = toFloatingPoint(readJsonStore<unknown>(PIN_ORB_POS_KEY, null, window.localStorage));
    }

    /**
     * Read the persisted pinned draft.
     * @returns {Record<string, unknown> | null} The stored draft, or null when nothing is pinned.
     */
    readDraft() {
        return readJsonStore<PinnedDraft | null>(PIN_DRAFT_KEY, null, window.sessionStorage);
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
    writeDraft(draft: Record<string, unknown>) {
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
     * Mark a dialog as pinned: the orb appears, or the pick button shows its resume face.
     * Boundary: idempotent; repositions an existing control instead of stacking duplicates.
     * @returns {void}
     */
    showOrb() {
        this.pinned = true;
        this.refresh();
    }

    /**
     * Clear the pinned mark: the orb goes away, and the pick button goes back to picking (or hides under the dialog).
     * @returns {void}
     */
    hideOrb() {
        this.pinned = false;
        this.refresh();
    }

    /**
     * Let the control act as the pick button.
     * Boundary: only wires the hooks; the button shows once {@link setPickButtonShown} turns it on.
     * @param {PickButtonHooks} hooks Pick-mode toggle and state.
     * @returns {void}
     */
    enablePickButton(hooks: PickButtonHooks) {
        this.pickHooks = hooks;
    }

    /**
     * Show or hide the pick button (for `pickButton: 'touch'`, whenever the coarse-pointer media query flips).
     * Boundary: ignored until {@link enablePickButton} ran. Turning it off leaves the plain orb, so a pinned dialog
     * still has its orb. While on, a resize re-places the control so it stays on its edge.
     * @param {boolean} shown Whether the button should be on.
     * @returns {void}
     */
    setPickButtonShown(shown: boolean) {
        const next = shown && this.pickHooks != null;
        if (next === this.buttonShown)
            return;
        this.buttonShown = next;
        if (next)
            window.addEventListener('resize', this.onResize);
        else
            window.removeEventListener('resize', this.onResize);
        this.sync();
    }

    /** Re-place the control after a viewport change. */
    onResize = () => this.positionOrb();

    /**
     * Render now for the plain orb (exactly the old timing), at the end of the task for the pick button.
     * @returns {void}
     */
    refresh() {
        if (!this.buttonShown) {
            this.sync();
            return;
        }
        if (this.syncQueued)
            return;
        this.syncQueued = true;
        queueMicrotask(() => {
            this.syncQueued = false;
            this.sync();
        });
    }

    /**
     * Create, re-face, place or remove the control for the current state.
     * Boundary: safe to call any time (pick mode calls it when it starts and stops); it reads the dialog state live.
     * @returns {void}
     */
    sync() {
        const role = floatingRole({
            button: this.buttonShown,
            dialogOpen: this.isDialogOpen(),
            pinned: this.pinned,
            picking: !!this.pickHooks?.isPicking(),
        });
        if (!role) {
            this.orbEl?.remove();
            this.orbEl = null;
            this.role = null;
            return;
        }
        if (!this.orbEl) {
            this.orbEl = this.renderOrb();
            this.parent.append(this.orbEl);
        }
        if (role !== this.role)
            this.applyRole(this.orbEl, role);
        this.positionOrb();
    }

    /**
     * Give the control the face, name and pressed state of `role`.
     * @param {HTMLButtonElement} orb Live control.
     * @param {FloatingRole} role Face to show.
     * @returns {void}
     */
    applyRole(orb: HTMLButtonElement, role: FloatingRole) {
        const title = t(ROLE_TITLES[role]);
        orb.classList.toggle(PICK_BUTTON_CLASS, role !== 'orb');
        orb.classList.toggle(PICKING_CLASS, role === 'cancel');
        orb.classList.toggle(PINNED_CLASS, role === 'resume');
        orb.title = title;
        orb.setAttribute('aria-label', title);
        if (role === 'pick' || role === 'cancel')
            orb.setAttribute('aria-pressed', String(role === 'cancel'));
        else
            orb.removeAttribute('aria-pressed');
        this.role = role;
    }

    /**
     * Build the draggable control.
     * Boundary: a press that moves beyond the drag threshold is a drag (position persisted; the pick button then
     * snaps to the nearer side edge) and never counts as a tap. A tap resumes the pinned intent, or toggles pick mode
     * on the pick button's pick / cancel faces.
     * @returns {HTMLButtonElement} Control button, not yet faced or placed (see {@link sync}).
     */
    renderOrb() {
        const orb: HTMLButtonElement = el('button', 'cii-pin-orb');
        orb.type = 'button';
        orb.style.pointerEvents = 'auto';
        orb.append(el('span', 'cii-pin-orb-icon'));
        bindFloatingDrag(orb, {
            move: (point) => {
                this.pos = point;
                this.placeOrb(clampFloatingPoint(point, viewport()));
            },
            end: (dragged) => {
                if (!dragged)
                    return;
                if (this.buttonShown)
                    this.pos = snapFloatingPoint(this.pos, viewport());
                writeJsonStore(PIN_ORB_POS_KEY, this.pos, window.localStorage);
                this.positionOrb();
            },
            tap: () => {
                if (this.role === 'pick' || this.role === 'cancel')
                    this.pickHooks?.onPick();
                else
                    this.onRestore();
            },
        });
        return orb;
    }

    /**
     * Place the control at its stored position, or bottom-right by default, kept inside the viewport; the pick button
     * also sits on its side edge.
     * @returns {void}
     */
    positionOrb() {
        if (!this.orbEl)
            return;
        this.placeOrb(this.buttonShown ? snapFloatingPoint(this.pos, viewport()) : clampFloatingPoint(this.pos, viewport()));
    }

    /**
     * Write a viewport position to the live control.
     * @param {FloatingPoint} point Already clamped top-left.
     * @returns {void}
     */
    placeOrb(point: FloatingPoint) {
        if (!this.orbEl)
            return;
        this.orbEl.style.position = 'fixed';
        this.orbEl.style.left = `${Math.round(point.x)}px`;
        this.orbEl.style.top = `${Math.round(point.y)}px`;
    }
}
