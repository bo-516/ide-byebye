import { DialogReferenceController } from './dialog-references.js';
import { DialogScreenshotController } from '../screenshot/dialog-screenshots.js';
import { DialogRecordingController } from '../recording/dialog-recordings.js';
import { DialogStyleController } from '../style/dialog-style.js';
import { DialogPin } from './dialog-pin.js';
import { createDialogEditor } from './dialog-editor.js';
import { agentLabel, loadLastAgent, saveLastAgent } from './dialog-utils.js';
import { keepBoxInView, placeDialog } from './dialog-viewport.js';
import { DialogSessionController } from './dialog-session-picker.js';
import { DialogAgentPicker } from './dialog-agent-picker.js';
import { t } from '../lib/i18n.js';
import type {
    BrowserClientConfig,
    DialogAnchor,
    DialogBox,
    DialogState,
    ElementSelection,
    InspectorApi,
    ReferenceInsert,
} from './dialog-types.js';

/**
 * Bottom layer of the intent {@link Dialog}: shared fields, controller wiring, and the helpers every
 * higher layer relies on (host interactivity, focus guard, viewport placement, state lock).
 *
 * Purpose: `Dialog` grew past the AGENTS.md 400-line split line, so the class is layered by domain —
 * layout → clipboard → send → pins → shell → `Dialog`. Every method stays reachable through
 * `Dialog.prototype`, so `Dialog.prototype.positionDialog` and friends keep working.
 *
 * Boundary: this layer never calls upward into later domains directly; the few such calls
 * (controller callbacks wired in the constructor, the Escape key handler, `close`'s pin cleanup,
 * `coldRestore`'s re-render) go through the abstract declarations below, implemented by the layer
 * that owns the domain.
 */
export abstract class DialogLayout {
    parent: ShadowRoot;
    config: BrowserClientConfig;
    api: InspectorApi;
    references: DialogReferenceController;
    screenshots: DialogScreenshotController;
    recordings: DialogRecordingController;
    styles: DialogStyleController;
    pin: DialogPin;
    backdrop: HTMLElement | null = null;
    dialogEl: HTMLElement | null = null;
    editor: ReturnType<typeof createDialogEditor>;
    editorEl: HTMLElement | null = null;
    actionButtons = new Map<string, HTMLButtonElement>();
    sessions: DialogSessionController;
    picker: DialogAgentPicker;
    lastAgent: string;
    selection: ElementSelection | null = null;
    selectedElement: Element | null = null;
    screenshotElement: Element | null = null;
    anchor: DialogAnchor | null = null;
    primaryLabel: string | null = null;
    isFocusGuardActive = false;
    state: DialogState = 'idle';
    focusGuardHandler = (event: FocusEvent) => {
        if (!this.isInspectorFocusEvent(event))
            return;
        event.stopPropagation();
        event.stopImmediatePropagation();
    };
    // ShadowRoot's addEventListener types the listener as Event (no keydown overload). The assertion erases, so a
    // non-KeyboardEvent still reaches closeFromEscape, which ignores anything whose key is not Escape.
    keyHandler = ((event: KeyboardEvent) => {
        this.closeFromEscape(event);
    }) as (event: Event) => void;
    resizeHandler = () => {
        this.repositionForContent();
    };

    // Implemented by higher layers; declared here so constructor wiring and shared helpers compile.
    abstract switchPrimary(inspPath: string): void;
    abstract resolveReferenceText(selection: ElementSelection): Promise<string | undefined>;
    abstract handleOrbRestore(): void;
    abstract closeFromEscape(event: KeyboardEvent): boolean;
    abstract discardPin(): void;
    abstract render(_selection: ElementSelection | null): void;

    /**
     * Build the stateful dialog controller.
     * Boundary: the dialog owns local intent UI state; extra references reuse the picker, insert textarea labels, and
     * leave source resolution to the server.
     * @param {ShadowRoot} parent Shadow root that hosts plugin UI.
     * @param {BrowserClientConfig} config Browser config injected by the plugin. Only `enabledAgents` is read here.
     * @param {InspectorApi} api Inspector API client (`resolve`, `send`, `agents`).
     * @param {object} overlay Shared page overlay (`Overlay` in `inspect/overlay.ts`). Forwarded to the reference picker; this class never calls it.
     */
    constructor(parent: ShadowRoot, config: BrowserClientConfig, api: InspectorApi, overlay: object) {
        this.parent = parent;
        this.config = config;
        this.api = api;
        this.lastAgent = loadLastAgent(config);
        this.sessions = new DialogSessionController({
            api,
            getLastAgent: () => this.lastAgent,
            rememberAgent: (name: string) => this.rememberAgent(name),
            showError: (text: string) => this.showError(text),
            onChange: () => this.refreshDestination(),
        });
        this.picker = new DialogAgentPicker({
            config: () => this.config,
            sessions: this.sessions,
            getLastAgent: () => this.lastAgent,
            rememberAgent: (name: string) => this.rememberAgent(name),
            onPicked: () => this.restoreIntentFocus(),
        });
        this.editor = createDialogEditor({
            placeholder: t('intent.placeholder'),
            onChange: () => this.repositionForContent(),
            onSwitchPrimary: (inspPath: string) => this.switchPrimary(inspPath),
        });
        this.references = new DialogReferenceController(config, overlay, {
            captureIntentCursor: () => this.editor.captureCursor(),
            insertReference: (item: ReferenceInsert) => this.editor.insertReference(item),
            hasReference: (inspPath: string) => this.editor.hasReference(inspPath),
            resolveReferenceText: (selection: ElementSelection) => this.resolveReferenceText(selection),
            setBackdropHidden: (hidden: boolean) => {
                if (this.backdrop)
                    this.backdrop.hidden = hidden;
                this.setHostInteractive(!hidden);
            },
            focusIntent: () => this.focusIntent(),
            isOpen: () => this.isOpen(),
            showError: (text: string) => this.showError(text),
            reposition: () => this.repositionForContent(),
        });
        this.screenshots = new DialogScreenshotController({
            selectedElement: () => this.screenshotElement ?? this.selectedElement,
            backdrop: () => this.backdrop,
            reposition: () => this.repositionForContent(),
            showError: (text: string) => this.showError(text),
        });
        this.recordings = new DialogRecordingController({
            config: () => this.config,
            backdrop: () => this.backdrop,
            parent: () => this.parent,
            selectedElement: () => this.screenshotElement ?? this.selectedElement,
            setDialogHidden: (hidden: boolean) => {
                if (this.backdrop)
                    this.backdrop.hidden = hidden;
                this.setHostInteractive(!hidden);
            },
            reposition: () => this.repositionForContent(),
            showError: (text: string) => this.showError(text),
            onChange: () => this.repositionForContent(),
        });
        this.styles = new DialogStyleController({
            selectedElement: () => this.selectedElement,
            onChange: () => this.repositionForContent(),
        });
        this.pin = new DialogPin(parent, { onRestore: () => this.handleOrbRestore() });
    }
    isOpen() {
        return this.backdrop != null;
    }

    /**
     * Let the shadow host receive pointer events only while dialog UI is visible.
     *
     * Boundary: the host normally stays transparent so page picking works. Visible dialogs need this enabled, while the
     * hidden reference picker turns it off again so page clicks reach the app.
     *
     * @param {boolean} interactive Whether the plugin host should receive pointer events.
     * @returns {void}
     */
    setHostInteractive(interactive: boolean) {
        const host = this.parent.host;
        if (host instanceof HTMLElement)
            host.style.pointerEvents = interactive ? 'auto' : 'none';
    }

    /**
     * Keep page-level modal focus traps from stealing focus back when the inspector textarea receives focus.
     *
     * Boundary: this only stops composed focusin events that originate inside our shadow UI, and only while the
     * inspector dialog is open. It does not block pointer or keyboard events, so the textarea still receives normal
     * browser input and the host page keeps its own modal behavior.
     *
     * @param {FocusEvent} event Focus event dispatched after focus moved into the inspector.
     * @returns {boolean} True when the event came from the inspector UI.
     */
    isInspectorFocusEvent(event: FocusEvent) {
        const host = this.parent.host;
        if (!(host instanceof HTMLElement))
            return false;
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        // `composedPath()` never contains null. A closed dialog's missing nodes must be skipped, not passed to
        // `includes`, which only accepts an EventTarget.
        const hit = (node: EventTarget | null) => node != null && path.includes(node);
        if (path.includes(host) || hit(this.backdrop) || hit(this.dialogEl) || hit(this.editorEl))
            return true;
        const target = event.target;
        return target === host || target === this.backdrop || target === this.dialogEl || target === this.editorEl;
    }

    /**
     * Install a capture-phase focus guard ahead of document-level trap listeners such as MUI TrapFocus.
     *
     * @returns {void}
     */
    enableFocusGuard() {
        if (this.isFocusGuardActive)
            return;
        window.addEventListener('focusin', this.focusGuardHandler, true);
        this.isFocusGuardActive = true;
    }

    /**
     * Remove the focus guard when the dialog closes.
     *
     * @returns {void}
     */
    disableFocusGuard() {
        if (!this.isFocusGuardActive)
            return;
        window.removeEventListener('focusin', this.focusGuardHandler, true);
        this.isFocusGuardActive = false;
    }

    /**
     * Focus the intent textarea after the dialog is attached.
     *
     * Boundary: the first focus can be lost while the shadow UI/popover settles, so newly opened dialogs retry briefly.
     * This method only targets the current textarea and bails if the dialog has already closed or re-rendered.
     *
     * @param {{ retry?: boolean }} options Whether to retry on the next frame and short timers.
     * @returns {void}
     */
    focusIntent(options: { retry?: boolean } = {}) {
        const editorEl = this.editorEl;
        if (!editorEl)
            return;
        const focus = () => {
            if (!this.backdrop || this.editorEl !== editorEl)
                return;
            this.editor.focus();
        };
        focus();
        if (!options.retry)
            return;
        if (typeof requestAnimationFrame === 'function')
            requestAnimationFrame(focus);
        window.setTimeout(focus, 0);
        window.setTimeout(focus, 80);
    }

    /**
     * Place the dialog beside the click, or center it when there is no anchor.
     *
     * Boundary: top and left are derived from the dialog's current height, so calling this again after the content
     * grows moves the box. Later content changes go through {@link keepDialogInView}. `dialog` must already be in the
     * document; a detached node reports an empty box and is positioned as if it had no size.
     *
     * @param {DialogBox} dialog Dialog element to position. Must already be in the document for a real size.
     * @param {DialogAnchor | null} anchor Viewport click point. Null centers the dialog.
     * @returns {void}
     */
    positionDialog(dialog: DialogBox, anchor: DialogAnchor | null) {
        placeDialog(dialog, anchor);
    }

    /**
     * Re-clamp the already-open dialog into the viewport after its content or the window size changed.
     *
     * Boundary: this is the shared handler for every "the dialog resized itself" signal — typing, toggling a style
     * property, adding/removing a screenshot or recording preview, or a window resize. Unlike {@link positionDialog} it
     * deliberately does NOT re-anchor to the click point: re-deriving `top` from the live height on each such signal is
     * what made the dialog (and any panel open inside it) jump on every keystroke/toggle. A closed dialog is a no-op.
     * @returns {void}
     */
    repositionForContent() {
        if (this.dialogEl)
            this.keepDialogInView(this.dialogEl);
    }

    /**
     * Keep a positioned dialog fully inside the viewport without moving it unless a size change pushed it out of bounds.
     *
     * Boundary: reads the dialog's current top/left (its `style` coordinates equal viewport coordinates because the
     * shadow host is a `position: fixed; inset: 0` box) and only pulls it back when its right/bottom edge would cross the
     * margin {@link positionDialog} uses. Growing content therefore expands the box in place — the top stays put — until
     * it reaches the viewport edge, instead of the box hopping to a freshly re-anchored spot on each change.
     * @param {DialogBox} dialog Positioned dialog element.
     * @returns {void}
     */
    keepDialogInView(dialog: DialogBox) {
        keepBoxInView(dialog);
    }

    /**
     * Put focus back in the editor unless it is already there (which keeps the caret where the user left it).
     *
     * @returns {void}
     */
    restoreIntentFocus() {
        if (!this.editorEl || this.parent?.activeElement === this.editorEl)
            return;
        this.focusIntent();
    }

    /**
     * Record the dialog lifecycle state and lock (disable + dim) the footer controls and editor while it is busy.
     *
     * Boundary: this only disables UI controls; async work and picker listeners are owned by their controllers. The
     * send guards read `state`, so a busy state blocks a second send even with `lock: false` — which leaves every
     * control enabled and undimmed, for work whose dialog stays open (Copy) where a dim-and-restore would flicker.
     *
     * @param {'idle' | 'resolving' | 'sending' | 'failed' | 'completed'} state Dialog lifecycle state.
     * @param {{ lock?: boolean }} [options] `lock: false` skips locking for a busy state; omitted means lock.
     * @returns {void}
     */
    setState(state: DialogState, { lock = true }: { lock?: boolean } = {}) {
        this.state = state;
        const busy = lock && (state === 'resolving' || state === 'sending');
        for (const button of this.actionButtons.values())
            button.disabled = busy;
        this.references.setDisabled(busy);
        this.screenshots.setDisabled(busy);
        this.recordings.setDisabled(busy);
        this.styles.setDisabled(busy);
        this.sessions?.setDisabled(busy);
        this.picker?.setDisabled(busy);
        // Only lock the editor while actually sending so the user can keep typing during the initial resolve.
        this.editor.setDisabled(busy && state === 'sending');
        // The Send button shows a spinner for an app handoff in flight (Copy never locks, so it never spins).
        this.dialogEl?.classList.toggle('cii-sending', busy && state === 'sending');
    }
    /**
     * Repaint everything that shows where the prompt goes: the destination picker and the Send button's label.
     *
     * Boundary: visual only. It does not check whether the app is currently available beyond what `loadAgents`
     * already reported, because the send path owns user-facing errors. With no destination offered, Send hides and the
     * stylesheet promotes Copy. Safe before the first render (only the picker's rows update).
     *
     * @returns {void}
     */
    refreshDestination() {
        this.picker?.refresh();
        const button = this.actionButtons.get('send');
        if (!button)
            return;
        const label = agentLabel(this.lastAgent);
        const target = this.sessions?.targetFor(this.lastAgent);
        const text = target
            ? t('session.target.label', { label, title: target.title || t('session.untitled') })
            : t('send.title', { label });
        button.dataset.ciiTip = `${text}  ↵`;
        button.setAttribute('aria-label', text);
        button.hidden = this.picker?.hasDestinations() === false;
        // `rows` starts as `[]`, so strict inference collapses `current()` to `never`. The live menu row still
        // carries `unavailable` from `agentMenuRows`.
        const current = this.picker?.current() as { unavailable?: boolean } | null | undefined;
        button.classList.toggle('cii-send-unavailable', current?.unavailable === true);
    }
    /**
     * Persist and display the app agent most recently chosen by the user.
     *
     * Boundary: invalid agent names are harmless; storage rejects are swallowed by `saveLastAgent`, while the in-memory
     * value still updates so Enter follows the choice within the same dialog.
     *
     * @param {string} agent App agent name.
     * @returns {void}
     */
    rememberAgent(agent: string) {
        this.lastAgent = agent;
        saveLastAgent(agent);
        this.refreshDestination();
    }
    /**
     * Show a user-facing dialog error.
     *
     * Boundary: this intentionally uses `window.alert` to stay dependency-free inside the injected shadow UI.
     *
     * @param {string} text Error message.
     * @returns {void}
     */
    showError(text: string) {
        window.alert(text);
    }
}
