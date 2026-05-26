import { DialogReferenceController } from './dialog-references.js';
import { DialogScreenshotController } from './dialog-screenshots.js';
import { createIntentTextController } from './dialog-intent-text.js';
import { AGENT_LABELS, anchorFromElement, clamp, configuredActions, el, loadLastAgent, saveLastAgent, } from './dialog-utils.js';
export class Dialog {
    parent;
    config;
    api;
    references;
    screenshots;
    backdrop = null;
    dialogEl = null;
    textarea;
    actionButtons = new Map();
    lastAgent;
    selection = null;
    selectedElement = null;
    screenshotElement = null;
    anchor = null;
    state = 'idle';
    availability = [];
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
        this.intentText = createIntentTextController(() => this.textarea);
        this.references = new DialogReferenceController(config, overlay, {
            captureIntentCursor: () => this.intentText.capture(),
            insertReferenceText: (label) => this.intentText.insert(label),
            setBackdropHidden: (hidden) => {
                if (this.backdrop)
                    this.backdrop.hidden = hidden;
                this.setHostInteractive(!hidden);
            },
            focusIntent: () => this.focusIntent(),
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
        this.selection = selection;
        this.selectedElement = selectedElement ?? null;
        this.screenshotElement = screenshotElement ?? this.selectedElement;
        this.anchor = anchor ?? anchorFromElement(this.selectedElement);
        this.screenshots.reset();
        this.references.reset();
        this.intentText.reset();
        this.lastAgent = loadLastAgent(this.config);
        this.render(selection);
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
        this.setHostInteractive(false);
        this.parent.removeChild(this.backdrop);
        this.backdrop = null;
        this.dialogEl = null;
        this.selectedElement = null;
        this.screenshotElement = null;
        this.anchor = null;
        this.screenshots.clear();
        document.removeEventListener('keydown', this.keyHandler, true);
        this.parent.removeEventListener('keydown', this.keyHandler, true);
        window.removeEventListener('resize', this.resizeHandler, true);
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
        const body = el('div', 'cii-body');
        const intentField = el('div', 'cii-field');
        this.textarea = el('textarea', 'cii-textarea');
        this.intentText.bind(this.textarea);
        this.textarea.setAttribute('aria-label', 'Change intent');
        this.textarea.autofocus = true;
        this.textarea.placeholder = '例如：把这个按钮改成主按钮，并加 loading 状态';
        this.textarea.addEventListener('keydown', (event) => {
            if (this.closeFromEscape(event))
                return;
            if (this.shouldSubmitFromTextarea(event)) {
                event.preventDefault();
                void this.send(this.lastAgent);
            }
        });
        intentField.append(this.textarea);
        body.append(intentField);
        const screenshotPreviewEl = el('div', 'cii-screenshot-preview');
        this.screenshots.attachPreview(screenshotPreviewEl);
        body.append(screenshotPreviewEl);
        dialog.append(body);
        const footer = el('div', 'cii-footer');
        const cancelBtn = el('button', 'cii-btn cii-btn-secondary', '取消');
        cancelBtn.addEventListener('click', () => this.close());
        const actions = el('div', 'cii-action-buttons');
        actions.append(this.references.renderButton());
        actions.append(this.screenshots.renderPicker());
        this.actionButtons = new Map();
        for (const action of configuredActions()) {
            const button = el('button', 'cii-btn cii-btn-primary cii-agent-action', action.label);
            button.title = action.title;
            button.addEventListener('click', () => void this.send(action.name));
            this.actionButtons.set(action.name, button);
            actions.append(button);
        }
        this.updateAgentMarkers();
        footer.append(cancelBtn, actions);
        dialog.append(footer);
        dialog.addEventListener('mousedown', (event) => {
            const target = event.target;
            this.screenshots.closeMenuFromOutside(target);
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
     * Focus the intent textarea after the dialog is attached.
     *
     * Boundary: the first focus can be lost while the shadow UI/popover settles, so newly opened dialogs retry briefly.
     * This method only targets the current textarea and bails if the dialog has already closed or re-rendered.
     *
     * @param {{ retry?: boolean }} options Whether to retry on the next frame and short timers.
     * @returns {void}
     */
    focusIntent(options = {}) {
        const textarea = this.textarea;
        if (!(textarea instanceof HTMLTextAreaElement))
            return;
        const focus = () => {
            if (!this.backdrop || this.textarea !== textarea)
                return;
            try {
                textarea.focus({ preventScroll: true });
            }
            catch {
                textarea.focus();
            }
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
     * Decide whether textarea Enter should submit to the remembered app.
     *
     * Boundary: IME composition and modified Enter presses are ignored so Chinese candidate selection and
     * Shift+Enter line breaks keep working. Callers must still validate intent text before sending.
     *
     * @param {KeyboardEvent} event Textarea keydown event.
     * @returns {boolean} True when this key should submit the dialog.
     */
    shouldSubmitFromTextarea(event) {
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
     * sent only while their inline labels remain in the textarea, then validated server-side before prompt generation.
     *
     * @param {string} agent App agent selected by the user.
     * @returns {Promise<Record<string, unknown>>} JSON payload for the send endpoint.
     */
    async buildPayload(agent) {
        const payload = {
            pageUrl: location.href,
            intent: this.textarea.value,
            agent,
            applyMode: 'agent-edit',
            resume: true,
            selection: this.selection,
        };
        const references = this.references.payloadSelections(this.textarea.value);
        if (references.length > 0)
            payload.references = references;
        const screenshots = await this.screenshots.buildPayloadScreenshots();
        if (screenshots)
            payload.screenshots = screenshots;
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
     * Boundary: empty intent, disabled agents, and unavailable agents are rejected before screenshots or references are
     * sent. Successful validation stores the app so Enter repeats it next time.
     *
     * @param {string} agent App agent name requested by click or Enter.
     * @returns {Promise<void>} Resolves after the adapter response is rendered.
     */
    async send(agent) {
        if (this.state === 'resolving' || this.state === 'sending')
            return;
        if (!this.selection)
            return;
        if (!this.textarea.value.trim()) {
            this.showError('Please describe the change you want before sending.');
            return;
        }
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
}
