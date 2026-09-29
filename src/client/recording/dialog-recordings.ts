import { el, revealDropdownPanel } from '../dialog/dialog-utils.js';
import { RecordingSession, recordingDurationMs, segmentsDuration, combineSegments } from './recorder.js';
import { captureRecordingStill, type RecordingStillImage } from './recording-still.js';
import { openRecordingViewer } from './recording-viewer.js';
import { RECORDING_SCOPES, recordingScopeLabel, uniqueSelector, scopeTargetElement, type RecordingScope } from './recording-scope.js';
import { t } from '../lib/i18n.js';

/**
 * Format a millisecond duration as a compact `12.3s` badge label.
 * @param {number} ms Duration in milliseconds.
 * @returns {string} Short label.
 */
function durationLabel(ms: number): string {
    return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

/** One captured clip kept for the current dialog open. `still` stays null until rasterization finishes. */
interface DialogRecording {
    id: string;
    events: Array<Record<string, unknown>>;
    durationMs: number;
    segments: Array<{ t0: number; t1: number }>;
    stillAt: number;
    still: RecordingStillImage | null;
    capturing: boolean;
    scope: RecordingScope;
    scopeSelector: string | undefined;
}

/**
 * Dialog callbacks this controller uses.
 *
 * Boundary: `config()` is the injected page config. It is `object` because the dialog types only `enabledAgents` and
 * that interface has no string index signature; `recording` is read with a cast. `parent()` is a `ParentNode` (the
 * shadow root) because the floating control is mounted with `append`, which `Node` does not have.
 */
interface DialogRecordingHost {
    config: () => object;
    backdrop: () => Element | null;
    parent: () => ParentNode;
    selectedElement: () => Element | null;
    setDialogHidden: (hidden: boolean) => void;
    reposition: () => void;
    showError: (text: string) => void;
    onChange?: () => void;
}

/**
 * Dialog controller for rrweb element-behavior recordings.
 *
 * Boundary: recordings live for one dialog open cycle (cleared on close). The controller owns the record tool and its
 * scope/start popover, the floating "recording" control shown while capturing, the per-segment thumbnails, and the
 * outgoing payload. Active only when `config.recording.enabled`. While recording, the dialog is hidden and the host made
 * click-through so the user can actually interact with the page; the inspector's own UI is excluded from the capture.
 * Each recording is scoped (selected node / its parent / app mount root) so the still and viewer focus that subtree.
 */
export class DialogRecordingController {
    // Definite-assignment markers erase. These stay unset until a recording starts, instead of beginning as null.
    controlLabel!: HTMLElement | null;
    pendingScopeSelector!: string | undefined;
    pendingScope!: RecordingScope | undefined;
    host: DialogRecordingHost;
    button: HTMLButtonElement | null = null;
    menu: HTMLElement | null = null;
    scopeChoiceButtons = new Map<RecordingScope, HTMLButtonElement>();
    previewEl: HTMLElement | null = null;
    control: HTMLElement | null = null;
    timerId = 0;
    session: RecordingSession | null = null;
    recordings: DialogRecording[] = [];
    seq = 0;
    scope: RecordingScope = 'selection';

    /**
     * @param {DialogRecordingHost} host Dialog host callbacks. See {@link DialogRecordingHost}.
     */
    constructor(host: DialogRecordingHost) {
        this.host = host;
    }

    /** Whether the recording feature is enabled by plugin config. @returns {boolean} */
    isEnabled(): boolean {
        // `recording` is on the injected config but not on the dialog's `enabledAgents`-only type.
        // Optional chaining matches the previous `config()?.recording?.enabled` when `config()` is nullish.
        const config = this.host.config() as { recording?: { enabled?: unknown } } | null | undefined;
        return config?.recording?.enabled === true;
    }

    /** Privacy block-class for replay/still, from config. @returns {string} */
    blockClass(): string {
        const config = this.host.config() as { recording?: { mask?: { blockClass?: unknown } } } | null | undefined;
        const cls = config?.recording?.mask?.blockClass;
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
    attachPreview(previewEl: HTMLElement): void {
        this.previewEl = previewEl;
        if (this.previewEl)
            this.previewEl.hidden = true;
    }

    /**
     * Render the recording tool: one icon button whose popover picks the scope and starts recording.
     * Boundary: returns null when recording is disabled so the dialog omits the tool. Recording is deliberate and
     * infrequent, so it takes a confirming click ("Start recording") instead of a permanently visible scope control;
     * stopping happens from the floating control (the dialog is hidden while capturing). The scope choice survives
     * dialog opens.
     * @returns {HTMLElement | null} Tool wrapper (button + popover), or null when disabled.
     */
    renderButton(): HTMLElement | null {
        if (!this.isEnabled())
            return null;
        const wrapper = el('div', 'cii-screenshot-picker cii-rec-picker') as HTMLElement;
        // `el` is untyped. Locals (not `this.button` / `this.menu`) stay non-null inside the click callbacks,
        // which run later and would otherwise see the `HTMLElement | null` field type.
        const button = el('button', 'cii-icon-btn cii-rec-toggle') as HTMLButtonElement;
        this.button = button;
        button.type = 'button';
        button.dataset.ciiTip = t('recording.toggle.title');
        button.setAttribute('aria-label', t('recording.toggle.title'));
        button.setAttribute('aria-haspopup', 'menu');
        button.append(el('span', 'cii-rec-icon'));
        const menu = el('div', 'cii-screenshot-menu cii-rec-menu') as HTMLElement;
        this.menu = menu;
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            if (menu.hidden)
                revealDropdownPanel(button, menu);
            else
                menu.hidden = true;
        });
        menu.hidden = true;
        menu.append(el('div', 'cii-menu-caption', t('recording.scope.title')));
        this.scopeChoiceButtons = new Map();
        for (const value of RECORDING_SCOPES)
            menu.append(this.renderScopeChoice(value));
        const start = el('button', 'cii-rec-start', t('recording.start')) as HTMLButtonElement;
        start.type = 'button';
        start.addEventListener('click', (event) => {
            event.stopPropagation();
            menu.hidden = true;
            void this.start();
        });
        menu.append(start);
        this.updateScopeMarks();
        wrapper.append(button, menu);
        return wrapper;
    }

    /**
     * Render one scope choice row (label + check when active); picking a scope keeps the popover open for Start.
     * @param {RecordingScope} scope Scope value.
     * @returns {HTMLButtonElement} Choice button.
     */
    renderScopeChoice(scope: RecordingScope): HTMLButtonElement {
        const button = el('button', 'cii-screenshot-choice') as HTMLButtonElement;
        button.type = 'button';
        button.append(el('span', 'cii-choice-mark'), el('span', 'cii-choice-label', recordingScopeLabel(scope)));
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            this.scope = scope;
            this.updateScopeMarks();
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
     * Close the recording popover when a click lands outside it (wired from the dialog's mousedown listener).
     * @param {EventTarget | null} target Event target from the dialog mousedown listener.
     * @returns {void}
     */
    closeMenuFromOutside(target: EventTarget | null): void {
        if (!this.menu || !this.button || this.menu.hidden)
            return;
        if (target instanceof Node && !this.button.contains(target) && !this.menu.contains(target)) {
            this.menu.hidden = true;
        }
    }

    /** Disable/enable the record tool during busy dialog states; disabling also closes its popover. @param {boolean} disabled @returns {void} */
    setDisabled(disabled: boolean): void {
        if (this.button)
            this.button.disabled = disabled;
        if (disabled && this.menu)
            this.menu.hidden = true;
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
        const recording: DialogRecording = {
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
        const control = el('div', 'cii-rec-indicator') as HTMLElement;
        control.style.pointerEvents = 'auto';
        const dot = el('span', 'cii-rec-indicator-dot');
        this.controlLabel = el('span', 'cii-rec-indicator-text', t('recording.indicator.recording', { time: durationLabel(0) })) as HTMLElement;
        const stop = el('button', 'cii-rec-indicator-stop', t('recording.stop')) as HTMLButtonElement;
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
     * @param {DialogRecording} recording Recording entry to refresh.
     * @returns {Promise<void>} Resolves after the still is captured or the attempt fails.
     */
    async captureStill(recording: DialogRecording): Promise<void> {
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
            const item = el('div', 'cii-screenshot-thumb cii-recording-thumb') as HTMLElement;
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
     * @param {DialogRecording} recording Recording entry to remove.
     * @returns {HTMLButtonElement} Remove button.
     */
    renderRemove(recording: DialogRecording): HTMLButtonElement {
        const remove = el('button', 'cii-thumb-remove', '×') as HTMLButtonElement;
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
     * @param {DialogRecording} recording Recording entry to view.
     * @returns {void}
     */
    openViewer(recording: DialogRecording): void {
        if (!this.host.backdrop())
            return;
        // Attach the viewer to the shadow root (not the dialog backdrop): no scrim-level filter, transform, or containment
        // can then become the containing block of its `position:fixed` shell and collapse the full-screen viewer.
        // `backdrop()` is `Element | null`; the early return above only proves a previous call was non-null. The cast
        // keeps the viewer's `ParentNode` parameter without adding a runtime branch (a null parent still throws on append).
        const parent = (this.host.parent ? this.host.parent() : this.host.backdrop()) as ParentNode;
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
        const entries: Array<Record<string, unknown>> = [];
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
