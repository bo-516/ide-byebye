import { captureScreenshot } from './screenshot.js';
import { el, loadScreenshotChoices, saveScreenshotChoices, SCREENSHOT_SCOPE_ORDER, screenshotScopeLabel, screenshotScopeTitleLabel, } from './dialog-utils.js';

/**
 * Local screenshot controller for the intent dialog.
 *
 * Boundary: screenshot choices, captures, pending state, and preview DOM are local to one dialog open cycle. The
 * screenshot anchor is read lazily through callbacks because the dialog owns both the primary source selection and the
 * real clicked element used for visual capture.
 */
export class DialogScreenshotController {
    host;
    button;
    menu;
    previewEl;
    choices = new Set();
    choiceButtons = new Map();
    captures = new Map();
    capturePromises = new Map();
    pending = new Set();
    constructor(host) {
        this.host = host;
    }

    /**
     * Reset screenshot state for a newly opened dialog.
     *
     * Boundary: persisted choices are loaded, but actual captures are cleared so screenshots always match the current
     * selected element.
     *
     * @returns {void}
     */
    reset() {
        this.choices = loadScreenshotChoices();
        this.captures = new Map();
        this.capturePromises = new Map();
        this.pending = new Set();
    }

    /**
     * Clear transient screenshot state during dialog close.
     *
     * Boundary: persisted preferences are not changed; this only drops the current open-cycle data and pending markers.
     *
     * @returns {void}
     */
    clear() {
        this.captures.clear();
        this.capturePromises.clear();
        this.pending.clear();
        this.choices.clear();
    }

    /**
     * Attach the preview container used for screenshot thumbnails.
     *
     * Boundary: callers must provide an element that belongs to the current dialog. Passing a stale element makes later
     * render calls update detached DOM.
     *
     * @param {HTMLElement} previewEl Thumbnail container.
     * @returns {void}
     */
    attachPreview(previewEl) {
        this.previewEl = previewEl;
        this.previewEl.hidden = true;
    }

    /**
     * Render the footer screenshot picker.
     *
     * Boundary: this creates fresh DOM for one dialog render and should be called after `reset()`. The controller owns
     * the returned button and menu until the dialog closes.
     *
     * @returns {HTMLElement} Screenshot picker wrapper.
     */
    renderPicker() {
        const wrapper = el('div', 'cii-screenshot-picker');
        this.button = el('button', 'cii-icon-btn');
        this.button.type = 'button';
        this.button.title = '截图设置';
        this.button.setAttribute('aria-label', '截图设置');
        this.button.append(el('span', 'cii-shot-icon'));
        this.button.addEventListener('click', (event) => {
            event.stopPropagation();
            this.menu.hidden = !this.menu.hidden;
        });
        this.menu = el('div', 'cii-screenshot-menu');
        this.menu.hidden = true;
        this.choiceButtons = new Map();
        this.menu.append(this.renderChoice('none', '不截图'), this.renderChoice('selection', '区域截图'), this.renderChoice('parent', '父节点截图'), this.renderChoice('viewport', '全屏截图'));
        wrapper.append(this.button, this.menu);
        this.updatePicker();
        return wrapper;
    }

    /**
     * Close the menu when a click lands outside the screenshot picker.
     *
     * Boundary: this is safe before the picker is rendered. It only handles outside clicks for the current menu and
     * leaves other footer popovers alone.
     *
     * @param {EventTarget | null} target Event target from the dialog mousedown listener.
     * @returns {void}
     */
    closeMenuFromOutside(target) {
        if (!this.menu || !this.button || this.menu.hidden)
            return;
        if (target instanceof Node && !this.button.contains(target) && !this.menu.contains(target)) {
            this.menu.hidden = true;
        }
    }

    /**
     * Disable or enable the screenshot control during busy states.
     *
     * Boundary: pending capture promises are not canceled; this only blocks new user interaction while resolving or
     * sending the request.
     *
     * @param {boolean} disabled Whether controls should be disabled.
     * @returns {void}
     */
    setDisabled(disabled) {
        if (this.button)
            this.button.disabled = disabled;
    }

    /**
     * Capture all persisted screenshot choices for the current selected element.
     *
     * Boundary: this is best-effort on open; capture errors are reported through the dialog host and do not close the
     * dialog.
     *
     * @returns {Promise<void>} Resolves after selected captures settle.
     */
    async captureSelected() {
        const scopes = SCREENSHOT_SCOPE_ORDER.filter((scope) => this.choices.has(scope));
        if (!scopes.length)
            return;
        try {
            await Promise.all(scopes.map((scope) => this.ensureCapture(scope)));
        }
        catch (err) {
            this.host.showError(err instanceof Error ? err.message : String(err));
        }
    }

    /**
     * Build screenshot payload entries for the send request.
     *
     * Boundary: if no screenshot scopes are selected, this returns undefined. A missing selected element rejects because
     * selection screenshots cannot be recaptured safely.
     *
     * @returns {Promise<Array<Record<string, unknown>> | undefined>} Captured screenshot payloads, if any.
     */
    async buildPayloadScreenshots() {
        if (this.choices.size === 0)
            return undefined;
        if (!this.host.selectedElement())
            throw new Error('Selected element is no longer available');
        const scopes = SCREENSHOT_SCOPE_ORDER.filter((scope) => this.choices.has(scope));
        return Promise.all(scopes.map((scope) => this.ensureCapture(scope)));
    }

    /**
     * Render one screenshot menu choice.
     *
     * Boundary: `choice` must be either `none` or one supported screenshot scope; unsupported values will never be
     * persisted by `saveScreenshotChoices` but would still render a button. Choosing `none` closes this menu after the
     * selection state is cleared; screenshot scopes stay open so users can combine region and viewport captures.
     *
     * @param {string} choice Choice value to toggle.
     * @param {string} label Visible menu label.
     * @returns {HTMLButtonElement} Menu button.
     */
    renderChoice(choice, label) {
        const button = el('button', 'cii-screenshot-choice');
        button.type = 'button';
        button.append(el('span', 'cii-choice-mark'), el('span', 'cii-choice-label', label));
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            void this.toggleChoice(choice);
            if (choice === 'none' && this.menu) {
                this.menu.hidden = true;
            }
        });
        this.choiceButtons.set(choice, button);
        return button;
    }

    /**
     * Refresh screenshot picker labels, active states, and previews.
     *
     * Boundary: this assumes the picker DOM exists; callers should not call it before `renderPicker()`.
     *
     * @returns {void}
     */
    updatePicker() {
        const hasScreenshots = this.choices.size > 0;
        this.button.classList.toggle('cii-icon-btn-active', hasScreenshots);
        this.button.title = hasScreenshots
            ? `截图：${Array.from(this.choices)
                .map((scope) => screenshotScopeTitleLabel(scope))
                .join(' + ')}`
            : '不截图';
        for (const [choice, button] of this.choiceButtons) {
            const active = choice === 'none' ? !hasScreenshots : this.choices.has(choice);
            button.classList.toggle('cii-choice-active', active);
            const mark = button.querySelector('.cii-choice-mark');
            if (mark)
                mark.textContent = active ? '✓' : '';
        }
        this.renderPreviews();
    }

    /**
     * Toggle a screenshot choice and capture it when enabled.
     *
     * Boundary: choosing `none` clears every current capture. Capture failures roll back the newly added choice and are
     * reported through the dialog host.
     *
     * @param {string} choice Choice value from the menu.
     * @returns {Promise<void>} Resolves after any needed capture completes.
     */
    async toggleChoice(choice) {
        if (choice === 'none') {
            this.choices.clear();
            this.captures.clear();
            this.capturePromises.clear();
            this.pending.clear();
            this.persistChoices();
            this.updatePicker();
            return;
        }
        if (this.choices.has(choice)) {
            this.choices.delete(choice);
            this.captures.delete(choice);
            this.capturePromises.delete(choice);
            this.pending.delete(choice);
            this.persistChoices();
            this.updatePicker();
            return;
        }
        this.choices.add(choice);
        this.persistChoices();
        this.updatePicker();
        try {
            await this.ensureCapture(choice);
        }
        catch (err) {
            this.choices.delete(choice);
            this.persistChoices();
            this.updatePicker();
            this.host.showError(err instanceof Error ? err.message : String(err));
        }
    }

    /**
     * Persist screenshot choices as a best-effort preference.
     *
     * Boundary: storage errors are swallowed inside `saveScreenshotChoices`; this method only centralizes the write.
     *
     * @returns {void}
     */
    persistChoices() {
        saveScreenshotChoices(this.choices);
    }

    /**
     * Ensure a screenshot capture exists for one scope.
     *
     * Boundary: concurrent calls for the same scope share one promise. The capture is kept only if the scope remains
     * selected when rendering finishes.
     *
     * @param {string} scope Screenshot scope to capture.
     * @returns {Promise<Record<string, unknown>>} Screenshot payload.
     */
    ensureCapture(scope) {
        const existing = this.captures.get(scope);
        if (existing)
            return Promise.resolve(existing);
        const pending = this.capturePromises.get(scope);
        if (pending)
            return pending;
        const selectedElement = this.host.selectedElement();
        if (!selectedElement)
            return Promise.reject(new Error('Selected element is no longer available'));
        this.pending.add(scope);
        this.renderPreviews();
        const promise = captureScreenshot(selectedElement, scope)
            .then((payload) => {
            if (this.choices.has(scope))
                this.captures.set(scope, payload);
            return payload;
        })
            .finally(() => {
            this.pending.delete(scope);
            this.capturePromises.delete(scope);
            this.renderPreviews();
            this.host.reposition();
        });
        this.capturePromises.set(scope, promise);
        return promise;
    }

    /**
     * Render screenshot thumbnails and remove controls.
     *
     * Boundary: thumbnails mirror selected scopes in fixed order. Removing a thumbnail also removes its scope from the
     * outgoing request payload.
     *
     * @returns {void}
     */
    renderPreviews() {
        if (!this.previewEl)
            return;
        this.previewEl.innerHTML = '';
        const selectedScopes = SCREENSHOT_SCOPE_ORDER.filter((scope) => this.choices.has(scope));
        this.previewEl.hidden = selectedScopes.length === 0;
        if (!selectedScopes.length)
            return;
        for (const scope of selectedScopes) {
            const item = el('div', 'cii-screenshot-thumb');
            item.tabIndex = 0;
            item.setAttribute('role', 'button');
            item.setAttribute('aria-label', `预览${screenshotScopeLabel(scope)}`);
            const media = this.renderPreviewMedia(scope, item);
            const remove = this.renderRemoveButton(scope);
            item.append(media, remove);
            item.classList.toggle('cii-thumb-pending', this.pending.has(scope));
            this.previewEl.append(item);
        }
    }

    /**
     * Render thumbnail media for a selected screenshot scope.
     *
     * Boundary: pending captures show a spinner and do not open the lightbox until a real capture payload exists.
     *
     * @param {string} scope Screenshot scope.
     * @param {HTMLElement} item Thumbnail button wrapper receiving preview listeners.
     * @returns {HTMLElement} Thumbnail media container.
     */
    renderPreviewMedia(scope, item) {
        const capture = this.captures.get(scope);
        const media = el('div', 'cii-thumb-media');
        if (capture) {
            const img = document.createElement('img');
            img.src = capture.dataUrl;
            img.alt = screenshotScopeLabel(scope);
            media.append(img);
            item.addEventListener('click', () => this.openPreview(capture));
            item.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    this.openPreview(capture);
                }
            });
        }
        else {
            media.append(el('span', 'cii-thumb-loading'));
        }
        return media;
    }

    /**
     * Render the remove button for a screenshot thumbnail.
     *
     * Boundary: removing a scope also drops pending and cached capture state for that scope.
     *
     * @param {string} scope Screenshot scope to remove.
     * @returns {HTMLButtonElement} Remove button.
     */
    renderRemoveButton(scope) {
        const remove = el('button', 'cii-thumb-remove', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', `移除${screenshotScopeLabel(scope)}`);
        remove.addEventListener('click', (event) => {
            event.stopPropagation();
            this.choices.delete(scope);
            this.captures.delete(scope);
            this.capturePromises.delete(scope);
            this.pending.delete(scope);
            this.updatePicker();
        });
        return remove;
    }

    /**
     * Open a lightbox preview for a captured screenshot.
     *
     * Boundary: this requires the current dialog backdrop to exist. If the dialog was closed while a capture settled,
     * the preview request is ignored.
     *
     * @param {Record<string, unknown>} capture Screenshot payload from `captureScreenshot`.
     * @returns {void}
     */
    openPreview(capture) {
        const backdrop = this.host.backdrop();
        if (!backdrop)
            return;
        const lightbox = el('div', 'cii-image-lightbox');
        const frame = el('div', 'cii-image-frame');
        const img = document.createElement('img');
        img.src = capture.dataUrl;
        img.alt = screenshotScopeLabel(capture.scope);
        const close = el('button', 'cii-image-close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', '关闭预览');
        const closePreview = () => lightbox.remove();
        close.addEventListener('click', closePreview);
        lightbox.addEventListener('click', (event) => {
            if (event.target === lightbox)
                closePreview();
        });
        frame.append(img, close);
        lightbox.append(frame);
        backdrop.append(lightbox);
    }
}
