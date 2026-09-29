import { INSP_PATH_ATTR } from '../../shared/constants.js';
import { DialogReferenceController } from './dialog-references.js';
import { DialogScreenshotController } from '../screenshot/dialog-screenshots.js';
import { DialogRecordingController } from '../recording/dialog-recordings.js';
import { DialogStyleController } from '../style/dialog-style.js';
import { DialogPin } from './dialog-pin.js';
import { createDialogEditor } from './dialog-editor.js';
import { agentLabel, anchorFromElement, clamp, configuredActions, el, isAgentVisible, loadLastAgent, saveLastAgent, sourceReferenceLabel, } from './dialog-utils.js';
import { deliverPromptToClient } from './dialog-delivery.js';
import { DialogSessionController } from './dialog-session-picker.js';
import { DialogAgentPicker } from './dialog-agent-picker.js';
import { t } from '../lib/i18n.js';
import { iconSvg } from '../lib/icons.js';

/**
 * Fields this dialog reads from the injected page config.
 *
 * Boundary: the live config object has more keys (`token`, `apiOrigin`, …). This class only indexes `enabledAgents`;
 * omitting it makes `send` throw when it checks whether the chosen agent is allowed. Other keys are forwarded as-is
 * to controllers that own them.
 */
interface BrowserClientConfig {
    /** Agent ids the server will accept. An id outside this list is never offered and is rejected on send. */
    enabledAgents: string[];
}

/** One row of `GET /agents`: whether that adapter can take a prompt right now. */
interface AgentAvailability {
    name: string;
    available?: boolean;
    /** Server explanation when `available` is false; the dialog shows it verbatim. */
    reason?: string;
}

/** `POST /resolve` JSON. `reference` is whatever the server sends until the dialog checks it is a string. */
interface ResolveResult {
    ok: boolean;
    error?: string;
    reference?: unknown;
    source?: { astError?: string } | null;
}

/** `deliver` instruction a custom client asks the page to post to its embedding window. */
interface SendDeliver {
    label?: string;
    windowTarget?: string;
    targetOrigin?: string;
    payload?: Record<string, unknown>;
}

/** `POST /send` JSON. App agents and the clipboard agent share this shape; `output` is prompt text only for clipboard. */
interface SendResult {
    ok: boolean;
    agent?: string;
    output?: unknown;
    error?: string;
    deliver?: SendDeliver;
}

/**
 * Inspector routes the dialog calls.
 *
 * Boundary: payloads are JSON objects the server validates. A wrong origin or token fails inside these methods; this
 * type only names the three calls the dialog makes and the fields it reads back.
 */
interface InspectorApi {
    resolve(payload: object): Promise<ResolveResult>;
    send(payload: object): Promise<SendResult>;
    agents(): Promise<{ agents: AgentAvailability[] }>;
}

/**
 * DOM summary collected from the picked element.
 *
 * Boundary: the picker adds tag, text, and path fields the server understands. This class only reads `inspPath`
 * (to re-find the node after a reload); everything else is round-tripped untouched. A missing `inspPath` means the
 * dialog cannot restore the element and degrades to text-only capture.
 */
interface ElementSelection {
    inspPath?: string;
    [key: string]: unknown;
}

/** Viewport point the dialog opens beside. Missing anchor centers the dialog. */
interface DialogAnchor {
    x: number;
    y: number;
}

/**
 * The box `positionDialog` and `keepDialogInView` measure and move.
 *
 * Boundary: a real dialog element satisfies this. Only the rect and the inline `left`/`top` are read, so a stand-in
 * with those two fields is enough; anything else on `HTMLElement` is ignored.
 */
interface DialogBox {
    getBoundingClientRect(): { left: number; top: number; width: number; height: number };
    style: { left: string; top: string };
}

/** Inline `@` mention the reference picker asks the editor to insert at the captured caret. */
interface ReferenceInsert {
    label: string;
    selection: ElementSelection;
    /** Caret captured when the user clicked “add reference”; omitted inserts at the editor’s saved caret. */
    range?: Range | null;
}

/** Light pin draft. Attachments are intentionally absent so it fits in sessionStorage. */
interface PinnedDraft {
    selection?: ElementSelection | null;
    selector?: string | null;
    anchor?: DialogAnchor | null;
    lastAgent?: string;
    primary?: { label?: string | null; selection?: ElementSelection } | null;
    content?: unknown;
}

type DialogState = 'idle' | 'resolving' | 'sending' | 'failed' | 'completed';

/**
 * Clipboard write started inside the click so the browser still counts it as a user gesture.
 *
 * Boundary: `written` never rejects. `resolveText` / `rejectText` must be called exactly once; leaving them pending
 * waits out the browser’s own gesture timeout.
 */
interface EagerClipboardWrite {
    resolveText: (value: string) => void;
    rejectText: (reason: Error) => void;
    written: Promise<boolean>;
}

export class Dialog {
    copyResetTimer: any;
    parent: ShadowRoot;
    config: BrowserClientConfig;
    api: InspectorApi;
    references: DialogReferenceController;
    screenshots: DialogScreenshotController;
    recordings: DialogRecordingController;
    styles: DialogStyleController;
    pin: DialogPin;
    backdrop: HTMLElement | null = null;
    pinnedNode: HTMLElement | null = null;
    dialogEl: HTMLElement | null = null;
    editor;
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
    availability: AgentAvailability[] = [];
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
    /**
     * Close the dialog and tear down current intent state.
     * Boundary: this cancels hidden reference-picking mode without restoring the hidden dialog. Pending async screenshot
     * work may still settle, but its maps are cleared and no closed dialog is re-rendered. Open destination and session
     * menus are closed so their document key listeners do not outlive the dialog.
     * @returns {void}
     */
    close() {
        if (!this.backdrop)
            return;
        this.references.clear();
        this.styles.clear();
        this.sessions?.dispose();
        this.picker?.close();
        this.disableFocusGuard();
        this.setHostInteractive(false);
        this.parent.removeChild(this.backdrop);
        this.backdrop = null;
        this.dialogEl = null;
        this.editorEl = null;
        this.selectedElement = null;
        this.screenshotElement = null;
        this.anchor = null;
        this.screenshots.clear();
        document.removeEventListener('keydown', this.keyHandler, true);
        this.parent.removeEventListener('keydown', this.keyHandler, true);
        window.removeEventListener('resize', this.resizeHandler, true);
        this.discardPin();
    }
    /**
     * Render the dialog shell for the current intent.
     * Boundary: this method creates fresh DOM for one open dialog. State that must survive re-rendering should live on
     * the class fields; passing a stale selection only affects async resolve and send payloads outside this renderer.
     * Layout: header controls (pin, close) sit in the panel's top-right corner; the `.cii-footer` action bar holds the
     * capture tools on the left and, on the right, Copy, the destination picker, and the one Send button. The
     * destination is a setting (it rarely changes), so it is a compact picker rather than a button per agent; Send and
     * Enter both go to it. The session menu observes `.cii-footer` for placement, so the class must stay. Agents
     * turned off in plugin config are never offered (including `clipboard`, which backs Copy); with no destination at
     * all, the picker and Send hide and Copy becomes the primary action.
     * @param {ElementSelection | null} _selection Current primary selection, intentionally unused by static layout.
     * @returns {void}
     */
    render(_selection: ElementSelection | null) {
        const backdrop = el('div', 'cii-backdrop');
        backdrop.addEventListener('mousedown', (e: MouseEvent) => {
            if (e.target === backdrop)
                this.close();
        });
        const dialog = el('div', 'cii-dialog');
        // --- header: pin + close sit in the top-right corner, away from the hand-off keys ---
        const header = el('div', 'cii-header');
        const pinBtn = el('button', 'cii-pin-btn');
        pinBtn.type = 'button';
        pinBtn.dataset.ciiTip = t('dialog.pin.title');
        pinBtn.setAttribute('aria-label', t('dialog.pin.aria'));
        pinBtn.innerHTML = iconSvg('pin', 16);
        pinBtn.addEventListener('click', () => this.pinDialog());
        const closeBtn = el('button', 'cii-close-btn');
        closeBtn.type = 'button';
        closeBtn.dataset.ciiTip = t('dialog.close.title');
        closeBtn.setAttribute('aria-label', t('dialog.close.aria'));
        closeBtn.innerHTML = iconSvg('x', 16);
        closeBtn.addEventListener('click', () => this.close());
        header.append(pinBtn, closeBtn);
        dialog.append(header);
        const body = el('div', 'cii-body');
        const intentField = this.editor.render();
        // The editor closes over `let editorEl = null`, so strict inference types the getter as returning `null`
        // even though `render()` just created the node. The cast matches that post-render element.
        const editorNode = this.editor.getEditorElement() as HTMLElement;
        this.editorEl = editorNode;
        editorNode.addEventListener('keydown', (event: KeyboardEvent) => {
            if (this.closeFromEscape(event))
                return;
            if (this.shouldSubmitIntent(event)) {
                event.preventDefault();
                void this.send(this.lastAgent);
            }
        });
        body.append(intentField);
        const screenshotPreviewEl = el('div', 'cii-screenshot-preview');
        this.screenshots.attachPreview(screenshotPreviewEl);
        body.append(screenshotPreviewEl);
        const recordingPreviewEl = el('div', 'cii-screenshot-preview cii-recording-preview');
        this.recordings.attachPreview(recordingPreviewEl);
        body.append(recordingPreviewEl);
        const stylePreviewEl = el('div', 'cii-screenshot-preview cii-style-preview');
        this.styles.attachPreview(stylePreviewEl);
        body.append(stylePreviewEl);
        dialog.append(body);
        // --- action bar: capture tools on the left; Copy, the destination picker, and Send on the right ---
        const footer = el('div', 'cii-footer');
        const tools = el('div', 'cii-footer-tools');
        tools.append(this.references.renderButton());
        tools.append(this.screenshots.renderPicker());
        tools.append(this.styles.renderButton());
        const recordButton = this.recordings.renderButton();
        if (recordButton)
            tools.append(recordButton);
        const actions = el('div', 'cii-send-group');
        this.actionButtons = new Map();
        // Clipboard is a first-class action: it copies the assembled prompt so the user can paste it into any AI, with
        // no app/deeplink dependency. It is deliberately kept out of `configuredActions()` so the Enter key still
        // targets an app agent rather than the clipboard — which also keeps it out of `visibleAgentActions()`, so
        // `agents.clipboard: false` has to be honored here, or the button could only ever alert "not enabled".
        if (isAgentVisible(this.config, 'clipboard')) {
            const clipboardButton = el('button', 'cii-icon-btn cii-agent-clipboard');
            // Both labels exist up front, stacked in one grid cell, so the confirmation (see `flashCopied`) only swaps
            // visibility and never resizes the bar; the visible icon comes from CSS and the live label names the state.
            clipboardButton.append(el('span', 'cii-copy-label cii-copy-idle', t('agent.clipboard.label')), el('span', 'cii-copy-label cii-copy-done', t('clipboard.copied')));
            clipboardButton.dataset.ciiTip = t('agent.clipboard.label');
            clipboardButton.addEventListener('click', () => void this.send('clipboard'));
            this.actionButtons.set('clipboard', clipboardButton);
            actions.append(clipboardButton);
        }
        this.sessions.attach(dialog);
        actions.append(this.picker.render());
        const sendButton = el('button', 'cii-send-btn');
        sendButton.type = 'button';
        sendButton.innerHTML = iconSvg('arrow-up', 18);
        sendButton.addEventListener('click', () => void this.send(this.lastAgent));
        this.actionButtons.set('send', sendButton);
        actions.append(sendButton);
        footer.append(tools, actions);
        dialog.append(footer);
        this.refreshDestination();
        dialog.addEventListener('mousedown', (event: MouseEvent) => {
            const target = event.target;
            this.screenshots.closeMenuFromOutside(target);
            this.recordings.closeMenuFromOutside(target);
            this.styles.closeMenuFromOutside(target);
            this.sessions.closeMenuFromOutside(target);
            this.picker.closeMenuFromOutside(target);
        }, true);
        backdrop.append(dialog);
        this.parent.append(backdrop);
        this.backdrop = backdrop;
        this.dialogEl = dialog;
        this.setHostInteractive(true);
        // Reflect any persisted style selection in the body preview before measuring: rendered after `positionDialog`,
        // the chip grew the panel past the height it was clamped with and pushed its bottom edge off-screen.
        this.styles.updatePreview();
        this.positionDialog(dialog, this.anchor);
        document.addEventListener('keydown', this.keyHandler, true);
        this.parent.addEventListener('keydown', this.keyHandler, true);
        window.addEventListener('resize', this.resizeHandler, true);
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
    focusIntent(options: any = {}) {
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
        const margin = 12;
        const offset = 14;
        const rect = dialog.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const maxX = Math.max(margin, window.innerWidth - width - margin);
        const maxY = Math.max(margin, window.innerHeight - height - margin);
        let x = Math.round((window.innerWidth - width) / 2);
        let y = Math.round((window.innerHeight - height) / 2);
        if (anchor) {
            const rightX = anchor.x + offset;
            const leftX = anchor.x - width - offset;
            const bottomY = anchor.y + offset;
            const topY = anchor.y - height - offset;
            x = rightX <= maxX || leftX < margin ? rightX : leftX;
            y = bottomY <= maxY || topY < margin ? bottomY : topY;
        }
        dialog.style.left = `${clamp(Math.round(x), margin, maxX)}px`;
        dialog.style.top = `${clamp(Math.round(y), margin, maxY)}px`;
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
        const margin = 12;
        const rect = dialog.getBoundingClientRect();
        const maxX = Math.max(margin, window.innerWidth - rect.width - margin);
        const maxY = Math.max(margin, window.innerHeight - rect.height - margin);
        dialog.style.left = `${clamp(Math.round(rect.left), margin, maxX)}px`;
        dialog.style.top = `${clamp(Math.round(rect.top), margin, maxY)}px`;
    }
    /**
     * Decide whether an Enter press in the intent editor should submit to the remembered app.
     *
     * Boundary: IME composition and modified Enter presses are ignored so Chinese candidate selection and
     * Shift+Enter line breaks keep working. Callers must still validate intent text before sending.
     *
     * @param {KeyboardEvent} event Editor keydown event.
     * @returns {boolean} True when this key should submit the dialog.
     */
    shouldSubmitIntent(event: KeyboardEvent) {
        return (event.key === 'Enter' &&
            this.state !== 'resolving' &&
            this.state !== 'sending' &&
            !event.isComposing &&
            !event.shiftKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey);
    }

    /**
     * Handle Escape before page handlers can consume the key: close the innermost open menu, else the dialog.
     *
     * Boundary: layered, like any popover UI — the session menu, then the destination menu, then a capture tool's
     * dropdown each take one Escape (focus returns to the editor) before the next Escape closes the dialog. Reference
     * picking owns Escape itself, so it is left alone.
     *
     * @param {KeyboardEvent} event Keydown event from the page, shadow root, or textarea.
     * @returns {boolean} True when Escape closed a menu or the dialog.
     */
    closeFromEscape(event: KeyboardEvent) {
        if (event.key !== 'Escape')
            return false;
        if (this.references?.isPicking())
            return false;
        if (this.sessions?.consumeEscape() || this.picker?.consumeEscape() || this.closeToolMenus()) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            this.restoreIntentFocus();
            return true;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.close();
        return true;
    }

    /**
     * Hide any open capture-tool dropdown (screenshot, style, recording).
     *
     * Boundary: those controllers read their menu's `hidden` flag as their open state, so hiding it is a full close.
     * A closed dialog has nothing to hide.
     *
     * @returns {boolean} True when at least one dropdown was open.
     */
    closeToolMenus() {
        const open = this.dialogEl ? Array.from(this.dialogEl.querySelectorAll('.cii-footer-tools .cii-screenshot-menu:not([hidden])')) : [];
        for (const menu of open)
            (menu as HTMLElement).hidden = true;
        return open.length > 0;
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
     * Build the server payload for route resolution and agent dispatch.
     *
     * Boundary: screenshot capture can reject if the originally selected element disappeared; extra code references are
     * serialized inline from the editor in cursor order, then validated server-side before prompt generation.
     *
     * @param {string} agent App agent selected by the user.
     * @returns {Promise<Record<string, unknown>>} JSON payload for the send endpoint.
     */
    async buildPayload(agent: string) {
        const { intent, references } = this.editor.serialize();
        const payload: any = {
            pageUrl: location.href,
            intent,
            agent,
            applyMode: 'agent-edit',
            resume: true,
            selection: this.selection,
        };
        if (references.length > 0)
            payload.references = references;
        const screenshots = await this.screenshots.buildPayloadScreenshots();
        if (screenshots)
            payload.screenshots = screenshots;
        const recordings = await this.recordings.buildPayloadRecordings();
        if (recordings)
            payload.recordings = recordings;
        const styles = this.styles.buildPayloadStyles({ strict: true });
        if (styles)
            payload.styles = styles;
        const targetSessionId = this.sessions?.targetIdFor(agent);
        if (targetSessionId)
            payload.targetSessionId = targetSessionId;
        return payload;
    }
    /**
     * Validate the primary selected node before the user sends an intent.
     *
     * Boundary: this resolve call does not include extra references because they can be added later and are validated
     * again on send. A failed primary resolve disables app buttons to prevent an unusable prompt.
     *
     * @param {ElementSelection} selection Primary browser selection.
     * @returns {Promise<void>} Resolves after validation finishes.
     */
    async resolve(selection: ElementSelection) {
        this.setState('resolving');
        try {
            const res = await this.api.resolve({
                pageUrl: location.href,
                intent: '',
                agent: configuredActions()[0].name,
                applyMode: 'agent-edit',
                resume: true,
                selection,
            });
            if (!res.ok) {
                this.setState('failed');
                this.showError(res.error ?? t('resolve.failed'));
                for (const button of this.actionButtons.values())
                    button.disabled = true;
                return;
            }
            this.setState('idle');
            // Upgrade the pinned primary chip from the client fallback label to the server-resolved `@path #range`.
            if (typeof res.reference === 'string' && res.reference.trim()) {
                this.primaryLabel = res.reference.trim();
                this.editor.setPrimary({ label: this.primaryLabel, selection });
            }
            if (res.source?.astError) {
                console.info(`Intent inspector source extraction fell back to line context: ${res.source.astError}`);
            }
        }
        catch (err) {
            this.setState('failed');
            this.showError(err instanceof Error ? err.message : String(err));
        }
    }

    /**
     * Resolve the project-relative `@file #range` text for a newly picked extra code reference.
     *
     * @param {ElementSelection} selection Browser selection collected by the reference picker.
     * @returns {Promise<string | undefined>} Compact source reference returned by the server.
     */
    async resolveReferenceText(selection: ElementSelection) {
        const res = await this.api.resolve({
            pageUrl: location.href,
            intent: '',
            agent: configuredActions()[0].name,
            applyMode: 'agent-edit',
            resume: true,
            selection,
        });
        if (!res.ok) {
            throw new Error(res.error ?? t('reference.resolveFailed'));
        }

        return typeof res.reference === 'string' ? res.reference : undefined;
    }

    /**
     * Load app availability and session support, and hand both to the destination picker.
     *
     * Boundary: availability is best-effort. Failed discovery keeps every destination listed as available and lets the
     * send path report the adapter-specific error if the user submits.
     *
     * @returns {Promise<void>} Resolves when availability has been applied or ignored.
     */
    async loadAgents() {
        try {
            const res = await this.api.agents();
            this.availability = res.agents;
            this.sessions?.applyAgentList(res.agents);
            this.picker?.setAvailability(res.agents);
            this.refreshDestination();
        }
        catch {
            // availability is best-effort; keep the static list.
        }
    }
    /**
     * Send the current intent to the selected app agent.
     *
     * Boundary: disabled and unavailable agents are rejected before screenshots or references are sent. Empty intent is
     * allowed so users can send source references alone. Successful validation stores the app so Enter repeats it next
     * time. While a send is in flight a second one is refused; app sends also lock the dialog's controls, Copy does not.
     *
     * @param {string} agent App agent name requested by click or Enter (`'clipboard'` for the Copy button).
     * @returns {Promise<void>} Resolves after the adapter response is rendered.
     */
    async send(agent: string) {
        if (this.state === 'resolving' || this.state === 'sending')
            return;
        if (!this.selection)
            return;
        const configured = this.config.enabledAgents.includes(agent);
        const unavailable = this.availability.find((a) => a.name === agent && !a.available);
        if (!configured) {
            this.setState('failed');
            this.showError(t('agent.notEnabled', { label: agentLabel(agent) }));
            return;
        }
        if (unavailable) {
            this.setState('failed');
            this.showError(`${t('agent.unavailable', { label: agentLabel(agent) })}\n` +
                (unavailable.reason ?? t('agent.checkSetup')));
            return;
        }
        // Only app agents drive the Enter-key default; clipboard is an auxiliary action that must not hijack it.
        if (configuredActions().some((a) => a.name === agent))
            this.rememberAgent(agent);
        // Copy leaves the dialog open, so locking every control for the round trip would dim the whole dialog and snap it
        // back a moment later — a visible jolt on each copy. App sends close the dialog on success, so they keep the lock.
        this.setState('sending', { lock: agent !== 'clipboard' });
        // Must start synchronously inside the click stack: the screenshot/send round-trip below outlives the user
        // activation that clipboard access is tied to (strictly enforced by Safari).
        const eagerCopy = agent === 'clipboard' ? this.beginEagerClipboardWrite() : null;
        try {
            const payload = await this.buildPayload(agent);
            const result = await this.api.send(payload);
            if (eagerCopy) {
                if (result.ok && typeof result.output === 'string')
                    eagerCopy.resolveText(result.output);
                else
                    eagerCopy.rejectText(new Error(result.error ?? 'No prompt returned'));
            }
            this.renderResult(result, undefined, eagerCopy?.written);
        }
        catch (err) {
            eagerCopy?.rejectText(err instanceof Error ? err : new Error(String(err)));
            this.setState('failed');
            this.showError(err instanceof Error ? err.message : String(err));
        }
    }
    /**
     * Start an OS clipboard write while the click's user activation is still alive, deferring the actual text.
     *
     * Boundary: must be called synchronously inside the user gesture. Browsers without promise-valued
     * `ClipboardItem` support return null so the caller falls back to the post-response copy path. The returned
     * `written` promise never rejects; the deferred text must be resolved or rejected exactly once, otherwise the
     * pending write is left to the browser's own gesture timeout.
     *
     * @returns {EagerClipboardWrite | null} Deferred write handle. Null when the browser cannot defer a clipboard write.
     */
    beginEagerClipboardWrite(): EagerClipboardWrite | null {
        if (!navigator.clipboard?.write || typeof ClipboardItem !== 'function')
            return null;
        // The executor runs synchronously, so both are assigned before this function reads them. The assertion
        // tells strict null checks that; a browser that throws before the executor would already have thrown above.
        let resolveText!: (value: string) => void;
        let rejectText!: (reason: Error) => void;
        const text = new Promise<string>((resolve, reject) => {
            resolveText = resolve;
            rejectText = reject;
        });
        try {
            const item = new ClipboardItem({
                'text/plain': text.then((value) => new Blob([value], { type: 'text/plain' })),
            });
            const written = navigator.clipboard.write([item]).then(() => true, () => false);
            return { resolveText, rejectText, written };
        }
        catch {
            // ClipboardItem exists but rejects promise-valued entries — settle the deferred so it cannot dangle.
            resolveText('');
            return null;
        }
    }
    /**
     * Render the send result.
     *
     * Boundary: successful app deeplink sends close the dialog. Failures stay open and surface the adapter error.
     *
     * @param {SendResult} result Agent adapter result from the server.
     * @param {string | undefined} unavailableReason Optional fallback error text.
     * @param {Promise<boolean> | undefined} eagerWritten Outcome of the gesture-time clipboard write, if one started.
     * @returns {void}
     */
    renderResult(result: SendResult, unavailableReason?: string, eagerWritten?: Promise<boolean>) {
        // Only the clipboard agent's `output` is prompt text meant for the browser to copy. App agents also return an
        // `output` status string, but they already acted server-side (deeplink) — copying that string would both spam
        // the clipboard and fail whenever the opened app steals focus from the page.
        if (result.ok && result.agent === 'clipboard' && typeof result.output === 'string') {
            void this.copyOutput(result.output, eagerWritten);
            return;
        }
        // A custom client using the `postMessage` transport is delivered from here: only the page can address the
        // window that embeds it, so the server hands back the instruction instead of sending it itself.
        if (result.ok && result.deliver) {
            this.deliverResult(result);
            return;
        }
        this.setState(result.ok ? 'completed' : 'failed');
        if (result.ok) {
            this.close();
            return;
        }
        if (this.sessions?.handleSendError(result))
            return;
        this.showError(result.error ??
            unavailableReason ??
            t('agent.failedHandle', { label: agentLabel(result.agent) }));
    }
    /**
     * Hand a custom client's prompt to the window embedding this page.
     *
     * Boundary: success here means the message left the page — the receiving client owns inserting it. A page that is
     * not embedded (or a window that refuses the post) keeps the dialog open with the reason, so the typed intent is
     * never lost to a silent no-op.
     *
     * @param {SendResult} result Successful send result carrying a `deliver` instruction. A missing instruction still
     *        throws on property access, matching the previous code; `renderResult` only calls this when one is present.
     * @returns {void}
     */
    deliverResult(result: SendResult) {
        // Non-null assertion erases. Reading `.label` still throws when `deliver` is missing.
        const deliver = result.deliver!;
        const label = deliver.label ?? agentLabel(result.agent);
        const delivered = deliverPromptToClient(deliver);
        if (delivered.ok) {
            this.setState('completed');
            this.close();
            return;
        }
        this.setState('failed');
        this.showError(delivered.reason === 'no-window'
            ? t('deliver.noWindow', { label })
            : t('deliver.failed', { label, error: delivered.error ?? '' }));
    }
    /**
     * Copy a clipboard agent's prompt into the OS clipboard and flash success on the Copy button.
     *
     * Boundary: `navigator.clipboard.writeText` runs after the async send, so a browser that requires a fresh user
     * gesture (or a non-secure context) may reject it; that path surfaces a manual-copy hint instead of failing
     * silently. The dialog stays open so the user can read the feedback and still hand off to an app afterwards.
     *
     * @param {string} text Assembled prompt returned by the clipboard adapter.
     * @param {Promise<boolean> | undefined} eagerWritten Outcome of the gesture-time clipboard write, if one started.
     * @returns {Promise<void>} Resolves after the copy attempt and its feedback are applied.
     */
    async copyOutput(text: string, eagerWritten?: Promise<boolean>) {
        // The gesture-time write is the reliable path; retry with the direct APIs only when it failed or never started.
        if ((eagerWritten && (await eagerWritten)) || (await this.writeClipboard(text))) {
            this.flashCopied();
            return;
        }
        // Automatic copy was rejected — most often because the click's user activation lapsed during the
        // screenshot/send round-trip, or another surface (e.g. DevTools) holds focus so the page can't reach the
        // clipboard at all. Surface the assembled prompt in a native prompt, pre-selected, so "copy manually" is
        // actionable instead of a dead-end alert. The dialog returns to idle so the user can still hand off to an app.
        this.setState('idle');
        if (typeof window.prompt === 'function')
            window.prompt(t('clipboard.copyFailed'), text);
        else
            this.showError(t('clipboard.copyFailed'));
    }
    /**
     * Place text on the OS clipboard, preferring the async Clipboard API and falling back to the legacy execCommand
     * path when it is unavailable or rejected.
     *
     * Boundary: `navigator.clipboard.writeText` requires a secure context and a focused document; when either is
     * missing it rejects, so the synchronous execCommand path gets a second chance before the caller surfaces a
     * manual-copy affordance.
     *
     * @param {string} text Prompt text to copy.
     * @returns {Promise<boolean>} True if either path reported success.
     */
    async writeClipboard(text: string) {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        }
        catch {
            // Async path blocked (insecure context, unfocused document, or lapsed activation) — try execCommand.
        }
        return this.execCommandCopy(text);
    }
    /**
     * Legacy clipboard copy via a detached textarea and `document.execCommand('copy')`.
     *
     * Boundary: appended to the light DOM (not the plugin shadow root) because execCommand copies the document
     * selection, which is most reliable outside a shadow boundary. The node is removed synchronously afterwards.
     *
     * @param {string} text Prompt text to copy.
     * @returns {boolean} True if the command reported success.
     */
    execCommandCopy(text: string) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.top = '0';
            ta.style.left = '0';
            ta.style.width = '1px';
            ta.style.height = '1px';
            ta.style.opacity = '0';
            document.body.append(ta);
            ta.select();
            ta.setSelectionRange(0, text.length);
            let ok = false;
            try {
                ok = document.execCommand('copy');
            }
            catch {
                ok = false;
            }
            ta.remove();
            return ok;
        }
        catch {
            return false;
        }
    }
    /**
     * Flash the Copy button into its "copied" confirmation state and reset it after a short delay.
     *
     * Boundary: only toggles `cii-agent-copied`, which swaps which of the button's two pre-rendered labels is visible.
     * Rewriting the button text instead would resize it and re-wrap the footer's action row mid-flash. A repeat copy
     * inside the window restarts the delay; with no Copy button rendered (`agents.clipboard: false`) only the state resets.
     *
     * @returns {void}
     */
    flashCopied() {
        this.setState('idle');
        const button = this.actionButtons.get('clipboard');
        if (!button)
            return;
        if (this.copyResetTimer)
            clearTimeout(this.copyResetTimer);
        button.classList.add('cii-agent-copied');
        this.copyResetTimer = setTimeout(() => button.classList.remove('cii-agent-copied'), 1800);
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
            selector: this.selection?.inspPath ?? null,
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
