import { INSP_PATH_ATTR } from '../shared/constants.js';
import { DialogReferenceController } from './dialog-references.js';
import { DialogScreenshotController } from './dialog-screenshots.js';
import { DialogRecordingController } from './dialog-recordings.js';
import { DialogPin } from './dialog-pin.js';
import { createDialogEditor } from './dialog-editor.js';
import { AGENT_LABELS, anchorFromElement, clamp, configuredActions, el, loadLastAgent, saveLastAgent, sourceReferenceLabel, } from './dialog-utils.js';

const INTENT_PLACEHOLDER = '例如：把这个按钮改成主按钮，并加 loading 状态';
export class Dialog {
    parent;
    config;
    api;
    references;
    screenshots;
    recordings;
    pin;
    backdrop = null;
    pinnedNode = null;
    dialogEl = null;
    editor;
    editorEl = null;
    actionButtons = new Map();
    lastAgent;
    selection = null;
    selectedElement = null;
    screenshotElement = null;
    anchor = null;
    primaryLabel = null;
    isFocusGuardActive = false;
    state = 'idle';
    availability = [];
    focusGuardHandler = (event) => {
        if (!this.isInspectorFocusEvent(event))
            return;
        event.stopPropagation();
        event.stopImmediatePropagation();
    };
    keyHandler = (e) => {
        this.closeFromEscape(e);
    };
    resizeHandler = () => {
        if (this.dialogEl)
            this.positionDialog(this.dialogEl, this.anchor);
    };
    /**
     * Build the stateful dialog controller.
     * Boundary: the dialog owns local intent UI state; extra references reuse the picker, insert textarea labels, and
     * leave source resolution to the server.
     * @param {ShadowRoot} parent Shadow root that hosts plugin UI.
     * @param {Record<string, unknown>} config Browser config injected by the plugin.
     * @param {Record<string, Function>} api Inspector API client.
     * @param {import('./overlay.js').Overlay} overlay Shared page overlay controller.
     */
    constructor(parent, config, api, overlay) {
        this.parent = parent;
        this.config = config;
        this.api = api;
        this.lastAgent = loadLastAgent(config);
        this.editor = createDialogEditor({
            placeholder: INTENT_PLACEHOLDER,
            onChange: () => {
                if (this.dialogEl)
                    this.positionDialog(this.dialogEl, this.anchor);
            },
        });
        this.references = new DialogReferenceController(config, overlay, {
            captureIntentCursor: () => this.editor.captureCursor(),
            insertReference: (item) => this.editor.insertReference(item),
            hasReference: (inspPath) => this.editor.hasReference(inspPath),
            resolveReferenceText: (selection) => this.resolveReferenceText(selection),
            setBackdropHidden: (hidden) => {
                if (this.backdrop)
                    this.backdrop.hidden = hidden;
                this.setHostInteractive(!hidden);
            },
            focusIntent: () => this.focusIntent(),
            isOpen: () => this.isOpen(),
            showError: (text) => this.showError(text),
            reposition: () => {
                if (this.dialogEl)
                    this.positionDialog(this.dialogEl, this.anchor);
            },
        });
        this.screenshots = new DialogScreenshotController({
            selectedElement: () => this.screenshotElement ?? this.selectedElement,
            backdrop: () => this.backdrop,
            reposition: () => {
                if (this.dialogEl)
                    this.positionDialog(this.dialogEl, this.anchor);
            },
            showError: (text) => this.showError(text),
        });
        this.recordings = new DialogRecordingController({
            config: () => this.config,
            backdrop: () => this.backdrop,
            parent: () => this.parent,
            selectedElement: () => this.screenshotElement ?? this.selectedElement,
            setDialogHidden: (hidden) => {
                if (this.backdrop)
                    this.backdrop.hidden = hidden;
                this.setHostInteractive(!hidden);
            },
            reposition: () => {
                if (this.dialogEl)
                    this.positionDialog(this.dialogEl, this.anchor);
            },
            showError: (text) => this.showError(text),
            onChange: () => {
                if (this.dialogEl)
                    this.positionDialog(this.dialogEl, this.anchor);
            },
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
     * @param {Record<string, unknown>} selection Browser selection collected from the picked element.
     * @param {Element | null | undefined} selectedElement Source-mapped element used for route resolution and dialog positioning.
     * @param {{ x: number, y: number } | null | undefined} anchor Optional viewport click point.
     * @param {Element | null | undefined} screenshotElement Real clicked element used as screenshot anchor; omitted values fall back to `selectedElement`.
     * @returns {void}
     */
    open(selection, selectedElement, anchor, screenshotElement) {
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
        this.editor.reset();
        this.lastAgent = loadLastAgent(this.config);
        this.enableFocusGuard();
        this.render(selection);
        // Show the clicked element immediately as a non-removable pinned chip; resolve() upgrades the label.
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
     * work may still settle, but its maps are cleared and no closed dialog is re-rendered.
     * @returns {void}
     */
    close() {
        if (!this.backdrop)
            return;
        this.references.clear();
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
     * @param {Record<string, unknown>} _selection Current primary selection, intentionally unused by static layout.
     * @returns {void}
     */
    render(_selection) {
        const backdrop = el('div', 'cii-backdrop');
        backdrop.addEventListener('mousedown', (e) => {
            if (e.target === backdrop)
                this.close();
        });
        const dialog = el('div', 'cii-dialog');
        // --- header: pin + close live at the top, away from the action buttons ---
        const header = el('div', 'cii-header');
        const pinBtn = el('button', 'cii-pin-btn');
        pinBtn.type = 'button';
        pinBtn.title = '固定为悬浮按钮，跨页面继续编辑';
        pinBtn.setAttribute('aria-label', '固定');
        pinBtn.innerHTML = '<svg class="cii-pin-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0058be" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4"/><path d="M9 15l-4.5 4.5"/><path d="M14.5 4l5.5 5.5"/></svg>';
        pinBtn.addEventListener('click', () => this.pinDialog());
        const closeBtn = el('button', 'cii-close-btn');
        closeBtn.type = 'button';
        closeBtn.title = '取消';
        closeBtn.setAttribute('aria-label', '取消');
        closeBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6l-12 12"/></svg>';
        closeBtn.addEventListener('click', () => this.close());
        header.append(pinBtn, el('span', 'cii-header-div'), closeBtn);
        dialog.append(header);
        const body = el('div', 'cii-body');
        const intentField = this.editor.render();
        this.editorEl = this.editor.getEditorElement();
        this.editorEl.addEventListener('keydown', (event) => {
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
        dialog.append(body);
        // --- footer: capture tools grouped on the left, app actions on the right ---
        const footer = el('div', 'cii-footer');
        const tools = el('div', 'cii-footer-tools');
        tools.append(this.references.renderButton());
        tools.append(this.screenshots.renderPicker());
        const recordButton = this.recordings.renderButton();
        if (recordButton)
            tools.append(recordButton);
        const actions = el('div', 'cii-action-buttons');
        this.actionButtons = new Map();
        for (const action of configuredActions()) {
            const button = el('button', 'cii-btn cii-btn-primary cii-agent-action', action.label);
            button.title = action.title;
            button.addEventListener('click', () => void this.send(action.name));
            this.actionButtons.set(action.name, button);
            actions.append(button);
        }
        this.updateAgentMarkers();
        footer.append(tools, actions);
        dialog.append(footer);
        dialog.addEventListener('mousedown', (event) => {
            const target = event.target;
            this.screenshots.closeMenuFromOutside(target);
            this.recordings.closeMenuFromOutside(target);
        }, true);
        backdrop.append(dialog);
        this.parent.append(backdrop);
        this.backdrop = backdrop;
        this.dialogEl = dialog;
        this.setHostInteractive(true);
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
    setHostInteractive(interactive) {
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
    isInspectorFocusEvent(event) {
        const host = this.parent.host;
        if (!(host instanceof HTMLElement))
            return false;
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        if (path.includes(host) || path.includes(this.backdrop) || path.includes(this.dialogEl) || path.includes(this.editorEl))
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
    focusIntent(options = {}) {
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

    positionDialog(dialog, anchor) {
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
     * Decide whether an Enter press in the intent editor should submit to the remembered app.
     *
     * Boundary: IME composition and modified Enter presses are ignored so Chinese candidate selection and
     * Shift+Enter line breaks keep working. Callers must still validate intent text before sending.
     *
     * @param {KeyboardEvent} event Editor keydown event.
     * @returns {boolean} True when this key should submit the dialog.
     */
    shouldSubmitIntent(event) {
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
     * Close the visible dialog from Escape before page handlers can consume the key.
     *
     * @param {KeyboardEvent} event Keydown event from the page, shadow root, or textarea.
     * @returns {boolean} True when Escape closed the dialog.
     */
    closeFromEscape(event) {
        if (event.key !== 'Escape')
            return false;
        if (this.references?.isPicking())
            return false;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.close();
        return true;
    }

    /**
     * Toggle busy state for every visible footer control.
     *
     * Boundary: this only disables UI controls; async work and picker listeners are owned by their controllers.
     *
     * @param {'idle' | 'resolving' | 'sending' | 'failed' | 'completed'} state Dialog lifecycle state.
     * @returns {void}
     */
    setState(state) {
        this.state = state;
        const busy = state === 'resolving' || state === 'sending';
        for (const button of this.actionButtons.values())
            button.disabled = busy;
        this.references.setDisabled(busy);
        this.screenshots.setDisabled(busy);
        this.recordings.setDisabled(busy);
        // Only lock the editor while actually sending so the user can keep typing during the initial resolve.
        this.editor.setDisabled(state === 'sending');
    }
    /**
     * Mark the app button that Enter will use.
     *
     * Boundary: this only changes visual state. It does not check whether the app is currently available, because the
     * availability check is asynchronous and the send path owns user-facing errors.
     *
     * @returns {void}
     */
    updateAgentMarkers() {
        for (const [agent, button] of this.actionButtons) {
            button.classList.toggle('cii-agent-last', agent === this.lastAgent);
        }
    }
    /**
     * Persist and display the app agent most recently requested by the user.
     *
     * Boundary: invalid agent names are harmless; storage rejects are swallowed by `saveLastAgent`, while the in-memory
     * value still updates so Enter repeats the last click within the same dialog.
     *
     * @param {string} agent App agent name.
     * @returns {void}
     */
    rememberAgent(agent) {
        this.lastAgent = agent;
        saveLastAgent(agent);
        this.updateAgentMarkers();
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
    async buildPayload(agent) {
        const { intent, references } = this.editor.serialize();
        const payload = {
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
        return payload;
    }
    /**
     * Validate the primary selected node before the user sends an intent.
     *
     * Boundary: this resolve call does not include extra references because they can be added later and are validated
     * again on send. A failed primary resolve disables app buttons to prevent an unusable prompt.
     *
     * @param {Record<string, unknown>} selection Primary browser selection.
     * @returns {Promise<void>} Resolves after validation finishes.
     */
    async resolve(selection) {
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
                this.showError(res.error ?? 'Failed to resolve source location');
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
     * @param {Record<string, unknown>} selection Browser selection collected by the reference picker.
     * @returns {Promise<string | undefined>} Compact source reference returned by the server.
     */
    async resolveReferenceText(selection) {
        const res = await this.api.resolve({
            pageUrl: location.href,
            intent: '',
            agent: configuredActions()[0].name,
            applyMode: 'agent-edit',
            resume: true,
            selection,
        });
        if (!res.ok) {
            throw new Error(res.error ?? 'Failed to resolve source reference');
        }

        return typeof res.reference === 'string' ? res.reference : undefined;
    }

    /**
     * Load app availability and decorate footer buttons.
     *
     * Boundary: availability is best-effort. Failed discovery leaves buttons visible and lets the send path report the
     * adapter-specific error if the user submits.
     *
     * @returns {Promise<void>} Resolves when availability has been applied or ignored.
     */
    async loadAgents() {
        try {
            const res = await this.api.agents();
            this.availability = res.agents;
            for (const action of configuredActions()) {
                const button = this.actionButtons.get(action.name);
                if (!button)
                    continue;
                const configured = this.config.enabledAgents.includes(action.name);
                const info = res.agents.find((a) => a.name === action.name);
                const unavailable = !configured || info?.available === false;
                button.classList.toggle('cii-agent-unavailable', unavailable);
                button.title = !configured
                    ? `${action.label} is not enabled in the plugin config.`
                    : info?.available === false
                        ? info.reason ?? `${action.label} is currently unavailable.`
                        : action.title;
            }
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
     * time.
     *
     * @param {string} agent App agent name requested by click or Enter.
     * @returns {Promise<void>} Resolves after the adapter response is rendered.
     */
    async send(agent) {
        if (this.state === 'resolving' || this.state === 'sending')
            return;
        if (!this.selection)
            return;
        const configured = this.config.enabledAgents.includes(agent);
        const unavailable = this.availability.find((a) => a.name === agent && !a.available);
        if (!configured) {
            this.setState('failed');
            this.showError(`${AGENT_LABELS[agent] ?? agent} is not enabled.`);
            return;
        }
        if (unavailable) {
            this.setState('failed');
            this.showError(`${AGENT_LABELS[agent] ?? agent} is unavailable.\n` +
                (unavailable.reason ?? 'Check the adapter setup and try again.'));
            return;
        }
        this.rememberAgent(agent);
        this.setState('sending');
        try {
            const payload = await this.buildPayload(agent);
            const result = await this.api.send(payload);
            this.renderResult(result);
        }
        catch (err) {
            this.setState('failed');
            this.showError(err instanceof Error ? err.message : String(err));
        }
    }
    /**
     * Render the send result.
     *
     * Boundary: successful app deeplink sends close the dialog. Failures stay open and surface the adapter error.
     *
     * @param {Record<string, unknown>} result Agent adapter result from the server.
     * @param {string | undefined} unavailableReason Optional fallback error text.
     * @returns {void}
     */
    renderResult(result, unavailableReason) {
        this.setState(result.ok ? 'completed' : 'failed');
        if (result.ok) {
            this.close();
            return;
        }
        this.showError(result.error ??
            unavailableReason ??
            `${AGENT_LABELS[result.agent] ?? result.agent} failed to handle the request.`);
    }
    /**
     * Show a user-facing dialog error.
     *
     * Boundary: this intentionally uses `window.alert` to stay dependency-free inside the injected shadow UI.
     *
     * @param {string} text Error message.
     * @returns {void}
     */
    showError(text) {
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
     * persists a light draft so the orb and text survive a full page reload. Page-level listeners are removed while
     * pinned so Escape/resize do not act on the detached dialog. No-op when the dialog is not open.
     *
     * @returns {void}
     */
    pinDialog() {
        if (!this.backdrop)
            return;
        this.pin.writeDraft(this.buildColdDraft());
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
     * @param {Record<string, unknown>} draft Pinned draft from `buildColdDraft`.
     * @returns {void}
     */
    coldRestore(draft) {
        if (this.backdrop)
            this.close();
        this.selection = draft.selection ?? null;
        this.selectedElement = this.resolveSelector(draft.selector);
        this.screenshotElement = this.selectedElement;
        this.anchor = draft.anchor ?? anchorFromElement(this.selectedElement);
        this.screenshots.reset();
        this.recordings.reset();
        this.references.reset();
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
    resolveSelector(inspPath) {
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
