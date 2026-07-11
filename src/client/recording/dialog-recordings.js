import { el, revealDropdownPanel } from '../dialog/dialog-utils.js';
import { RecordingSession, recordingDurationMs, segmentsDuration, combineSegments } from './recorder.js';
import { captureRecordingStill } from './recording-still.js';
import { openRecordingViewer } from './recording-viewer.js';
import { RECORDING_SCOPES, recordingScopeLabel, uniqueSelector, scopeTargetElement } from './recording-scope.js';
import { t } from '../lib/i18n.js';

/**
 * Format a millisecond duration as a compact `12.3s` badge label.
 * @param {number} ms Duration in milliseconds.
 * @returns {string} Short label.
 */
function durationLabel(ms) {
    return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

/**
 * Dialog controller for rrweb element-behavior recordings.
 *
 * Boundary: recordings live for one dialog open cycle (cleared on close). The controller owns the footer record button +
 * scope picker, the floating "recording" control shown while capturing, the per-segment thumbnails, and the outgoing
 * payload. Active only when `config.recording.enabled`. While recording, the dialog is hidden and the host made
 * click-through so the user can actually interact with the page; the inspector's own UI is excluded from the capture.
 * Each recording is scoped (selected node / its parent / app mount root) so the still and viewer focus that subtree.
 */
export class DialogRecordingController {
    host;
    button = null;
    scopeBtn = null;
    scopeMenu = null;
    scopeLabel = null;
    scopeChoiceButtons = new Map();
    previewEl = null;
    control = null;
    timerId = 0;
    session = null;
    recordings = [];
    seq = 0;
    scope = 'selection';

    /**
     * @param {{ config: () => Record<string, unknown>, backdrop: () => (Element|null), parent: () => Node, selectedElement: () => (Element|null), setDialogHidden: (hidden: boolean) => void, reposition: () => void, showError: (t: string) => void, onChange?: () => void }} host Dialog host callbacks.
     */
    constructor(host) {
        this.host = host;
    }

    /** Whether the recording feature is enabled by plugin config. @returns {boolean} */
    isEnabled() {
        return this.host.config()?.recording?.enabled === true;
    }

    /** Privacy block-class for replay/still, from config. @returns {string} */
    blockClass() {
        const cls = this.host.config()?.recording?.mask?.blockClass;
        return typeof cls === 'string' && cls ? cls : 'rr-block';
    }

    /**
     * Reset recording state for a freshly opened dialog.
     * Boundary: stops any in-flight recording, removes the floating control, and drops captured segments; the scope
     * choice is kept across opens as a convenience.
     * @returns {void}
     */
    reset() {
        this.stopTimer();
        this.hideControl();
        if (this.session) {
            this.session.stop();
            this.session = null;
        }
        this.recordings = [];
    }

    /** Tear down recording state on dialog close. @returns {void} */
    clear() {
        this.reset();
    }

    /**
     * Attach the preview container used for recording thumbnails.
     * @param {HTMLElement} previewEl Thumbnail container owned by the current dialog.
     * @returns {void}
     */
    attachPreview(previewEl) {
        this.previewEl = previewEl;
        if (this.previewEl)
            this.previewEl.hidden = true;
    }

    /**
     * Render the footer recording controls: a scope picker plus the record toggle button.
     * Boundary: returns null when recording is disabled so the dialog omits the controls. The record button only starts
     * recording; stopping happens from the floating control (the dialog is hidden while capturing).
     * @returns {HTMLElement | null} Controls wrapper, or null when disabled.
     */
    renderButton() {
        if (!this.isEnabled())
            return null;
        const wrapper = el('div', 'cii-rec-controls');
        // Scope picker — a custom dropdown matching the screenshot picker (white menu + ✓), not a native <select>.
        const scope = el('div', 'cii-screenshot-picker cii-rec-scope-picker');
        this.scopeBtn = el('button', 'cii-rec-scope-btn');
        this.scopeBtn.type = 'button';
        this.scopeBtn.dataset.ciiTip = t('recording.scope.title');
        this.scopeLabel = el('span', 'cii-rec-scope-label', recordingScopeLabel(this.scope));
        this.scopeBtn.append(this.scopeLabel, el('span', 'cii-rec-scope-caret', '⌄'));
        this.scopeBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            if (!this.scopeMenu)
                return;
            if (this.scopeMenu.hidden)
                revealDropdownPanel(this.scopeBtn, this.scopeMenu);
            else
                this.scopeMenu.hidden = true;
        });
        this.scopeMenu = el('div', 'cii-screenshot-menu');
        this.scopeMenu.hidden = true;
        this.scopeChoiceButtons = new Map();
        for (const value of RECORDING_SCOPES)
            this.scopeMenu.append(this.renderScopeChoice(value));
        scope.append(this.scopeBtn, this.scopeMenu);
        this.updateScopeMarks();
        // Record toggle button.
        this.button = el('button', 'cii-icon-btn cii-rec-toggle');
        this.button.type = 'button';
        this.button.dataset.ciiTip = t('recording.toggle.title');
        this.button.setAttribute('aria-label', t('recording.toggle.title'));
        this.button.append(el('span', 'cii-rec-dot'));
        this.button.addEventListener('click', (event) => {
            event.stopPropagation();
            void this.start();
        });
        wrapper.append(scope, this.button);
        return wrapper;
    }

    /**
     * Render one scope choice row for the dropdown (label + ✓ when active), mirroring the screenshot picker.
     * @param {'selection'|'parent'|'root'} scope Scope value.
     * @returns {HTMLButtonElement} Choice button.
     */
    renderScopeChoice(scope) {
        const button = el('button', 'cii-screenshot-choice');
        button.type = 'button';
        button.append(el('span', 'cii-choice-mark'), el('span', 'cii-choice-label', recordingScopeLabel(scope)));
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            this.scope = scope;
            this.updateScopeMarks();
            if (this.scopeLabel)
                this.scopeLabel.textContent = recordingScopeLabel(scope);
            if (this.scopeMenu)
                this.scopeMenu.hidden = true;
        });
        this.scopeChoiceButtons.set(scope, button);
        return button;
    }

    /** Refresh the active ✓ mark on each scope choice. @returns {void} */
    updateScopeMarks() {
        for (const [scope, button] of this.scopeChoiceButtons) {
            const active = scope === this.scope;
            button.classList.toggle('cii-choice-active', active);
            const mark = button.querySelector('.cii-choice-mark');
            if (mark)
                mark.textContent = active ? '✓' : '';
        }
    }

    /**
     * Close the scope dropdown when a click lands outside it (wired from the dialog's mousedown listener).
     * @param {EventTarget | null} target Event target from the dialog mousedown listener.
     * @returns {void}
     */
    closeMenuFromOutside(target) {
        if (!this.scopeMenu || !this.scopeBtn || this.scopeMenu.hidden)
            return;
        if (target instanceof Node && !this.scopeBtn.contains(target) && !this.scopeMenu.contains(target)) {
            this.scopeMenu.hidden = true;
        }
    }

    /** Disable/enable the record controls during busy dialog states. @param {boolean} disabled @returns {void} */
    setDisabled(disabled) {
        if (this.button)
            this.button.disabled = disabled;
        if (this.scopeBtn)
            this.scopeBtn.disabled = disabled;
    }

    /**
     * Start recording: hide the dialog so the page is interactive, then begin rrweb capture (excluding inspector UI).
     * Boundary: captures the scope target selector up front from the currently selected element. A failed start (rrweb
     * missing) surfaces through the host error channel and leaves the dialog visible.
     * @returns {Promise<void>} Resolves after the start transition settles.
     */
    async start() {
        if (this.session?.isRecording())
            return;
        const target = scopeTargetElement(this.host.selectedElement(), this.scope);
        this.pendingScope = this.scope;
        this.pendingScopeSelector = uniqueSelector(target) || undefined;
        try {
            this.session = new RecordingSession(this.host.config());
            await this.session.start();
        }
        catch (err) {
            this.session = null;
            this.host.showError(err instanceof Error ? err.message : String(err));
            return;
        }
        this.host.setDialogHidden(true);
        this.showControl();
        this.startTimer();
    }

    /**
     * Stop recording: restore the dialog, then build a scoped recording segment and capture its still frame.
     * Boundary: a too-short recording is discarded with a message. Always restores the dialog and removes the floating
     * control even when no usable segment was produced.
     * @returns {void}
     */
    stop() {
        if (!this.session) {
            this.hideControl();
            this.stopTimer();
            this.host.setDialogHidden(false);
            return;
        }
        const events = this.session.stop();
        this.session = null;
        this.stopTimer();
        this.hideControl();
        this.host.setDialogHidden(false);
        const durationMs = recordingDurationMs(events);
        if (events.length < 2 || durationMs <= 0) {
            this.host.showError(t('recording.tooShort'));
            return;
        }
        this.seq += 1;
        const recording = {
            id: `rec-${this.seq}`,
            events,
            durationMs,
            segments: [{ t0: 0, t1: durationMs }],
            stillAt: durationMs,
            still: null,
            capturing: true,
            scope: this.pendingScope || 'selection',
            scopeSelector: this.pendingScopeSelector,
        };
        this.recordings.push(recording);
        this.renderPreviews();
        this.host.onChange?.();
        this.host.reposition();
        void this.captureStill(recording);
    }

    /**
     * Show the floating "recording" control (stop button + elapsed timer) while the dialog is hidden.
     * Boundary: lives in the shadow root with its own `pointer-events:auto` so it stays clickable while the host is
     * click-through. Idempotent.
     * @returns {void}
     */
    showControl() {
        if (this.control)
            return;
        const parent = this.host.parent?.();
        if (!parent)
            return;
        const control = el('div', 'cii-rec-indicator');
        control.style.pointerEvents = 'auto';
        const dot = el('span', 'cii-rec-indicator-dot');
        this.controlLabel = el('span', 'cii-rec-indicator-text', t('recording.indicator.recording', { time: durationLabel(0) }));
        const stop = el('button', 'cii-rec-indicator-stop', t('recording.stop'));
        stop.type = 'button';
        stop.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.stop();
        });
        control.append(dot, this.controlLabel, stop);
        parent.append(control);
        this.control = control;
    }

    /** Remove the floating recording control. @returns {void} */
    hideControl() {
        if (this.control) {
            this.control.remove();
            this.control = null;
            this.controlLabel = null;
        }
    }

    /** Update the record button's recording/idle appearance. @returns {void} */
    updateButton() {
        if (this.button)
            this.button.classList.toggle('cii-rec-active', this.session?.isRecording() === true);
    }

    /** Start the elapsed-time ticker shown on the floating control. @returns {void} */
    startTimer() {
        this.stopTimer();
        this.updateButton();
        this.timerId = window.setInterval(() => {
            if (this.controlLabel && this.session)
                this.controlLabel.textContent = t('recording.indicator.recording', { time: durationLabel(this.session.elapsedMs()) });
        }, 200);
    }

    /** Stop the elapsed-time ticker. @returns {void} */
    stopTimer() {
        if (this.timerId) {
            window.clearInterval(this.timerId);
            this.timerId = 0;
        }
        this.updateButton();
    }

    /**
     * Capture (or refresh) the still frame for a recording at its current clip range and scope.
     * Boundary: capture failures mark the recording not-capturing and report the error; the segment is kept for retry.
     * @param {Record<string, unknown>} recording Recording entry to refresh.
     * @returns {Promise<void>} Resolves after the still is captured or the attempt fails.
     */
    async captureStill(recording) {
        recording.capturing = true;
        this.renderPreviews();
        try {
            const at = recording.stillAt != null ? recording.stillAt : recording.durationMs;
            recording.still = await captureRecordingStill(this.host.config(), recording.events, at, {
                blockClass: this.blockClass(),
                scopeSelector: recording.scopeSelector,
            });
        }
        catch (err) {
            this.host.showError(err instanceof Error ? err.message : String(err));
        }
        finally {
            recording.capturing = false;
            this.renderPreviews();
            this.host.reposition();
        }
    }

    /**
     * Render recording thumbnails (still frame + scope/duration badge), each opening the clip viewer on click.
     * @returns {void}
     */
    renderPreviews() {
        if (!this.previewEl)
            return;
        this.previewEl.innerHTML = '';
        this.previewEl.hidden = this.recordings.length === 0;
        for (const recording of this.recordings) {
            const item = el('div', 'cii-screenshot-thumb cii-recording-thumb');
            item.tabIndex = 0;
            item.setAttribute('role', 'button');
            item.setAttribute('aria-label', t('recording.thumb.aria'));
            const media = el('div', 'cii-thumb-media');
            if (recording.still?.dataUrl) {
                const img = document.createElement('img');
                img.src = recording.still.dataUrl;
                img.alt = t('recording.still.alt');
                media.append(img);
            }
            else {
                media.append(el('span', 'cii-thumb-loading'));
            }
            const badge = `${recordingScopeLabel(recording.scope) || ''} ${durationLabel(segmentsDuration(recording.segments))}`.trim();
            media.append(el('span', 'cii-rec-duration', badge));
            const open = () => this.openViewer(recording);
            item.addEventListener('click', open);
            item.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    open();
                }
            });
            item.classList.toggle('cii-thumb-pending', recording.capturing === true);
            item.append(media, this.renderRemove(recording));
            this.previewEl.append(item);
        }
    }

    /**
     * Build the remove button for one recording thumbnail.
     * @param {Record<string, unknown>} recording Recording entry to remove.
     * @returns {HTMLButtonElement} Remove button.
     */
    renderRemove(recording) {
        const remove = el('button', 'cii-thumb-remove', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', t('recording.remove.aria'));
        remove.addEventListener('click', (event) => {
            event.stopPropagation();
            this.recordings = this.recordings.filter((item) => item !== recording);
            this.renderPreviews();
            this.host.onChange?.();
            this.host.reposition();
        });
        return remove;
    }

    /**
     * Open the clip/playback viewer for one recording, focused on the recorded scope.
     * @param {Record<string, unknown>} recording Recording entry to view.
     * @returns {void}
     */
    openViewer(recording) {
        if (!this.host.backdrop())
            return;
        // Attach the viewer to the shadow root (not the dialog backdrop): the backdrop has `backdrop-filter`, which makes
        // it a containing block for `position:fixed`, so a full-screen viewer nested inside it would collapse.
        const parent = this.host.parent ? this.host.parent() : this.host.backdrop();
        void openRecordingViewer({
            parent,
            config: this.host.config(),
            recording,
            blockClass: this.blockClass(),
            scopeSelector: recording.scopeSelector,
            onUpdate: () => {
                this.renderPreviews();
                this.host.onChange?.();
            },
            showError: (text) => this.host.showError(text),
        });
    }

    /**
     * Build recording payload entries for the send request.
     * Boundary: ensures every recording has a (scoped) still frame before serializing, because the still is the only
     * artifact an AI agent can read. Returns undefined when there are no recordings. Each entry carries the clipped
     * event stream, the scope, and the still.
     * @returns {Promise<Array<Record<string, unknown>> | undefined>} Recording payloads, if any.
     */
    async buildPayloadRecordings() {
        if (!this.recordings.length)
            return undefined;
        const entries = [];
        for (const recording of this.recordings) {
            if (!recording.still)
                await this.captureStill(recording);
            entries.push({
                scope: recording.scope,
                events: combineSegments(recording.events, recording.segments),
                segments: recording.segments,
                durationMs: segmentsDuration(recording.segments),
                stillFrame: recording.still ?? undefined,
                capturedAt: new Date().toISOString(),
            });
        }
        return entries;
    }
}
