import { el } from '../dialog/dialog-utils.js';
import { recordingDurationMs, segmentsDuration, combineSegments, RecordingSession } from './recorder.js';
import { captureRecordingStill } from './recording-still.js';
import { openRecordingViewer } from './recording-viewer.js';
import { uniqueSelector, scopeTargetElement, recordingScopeLabel, type RecordingScope } from './recording-scope.js';
import { t } from '../lib/i18n.js';
import { RecordingControlLayer } from './dialog-recording-control.js';
import { durationLabel } from './dialog-recording-types.js';
import type { DialogRecording } from './dialog-recording-types.js';

/**
 * Dialog controller for rrweb element-behavior recordings.
 *
 * Boundary: recordings live for one dialog open cycle (cleared on close). The controller owns the record tool and its
 * scope/start popover (menu layer), the floating "recording" control shown while capturing (control layer), the
 * per-segment thumbnails, and the outgoing payload. Active only when `config.recording.enabled`. While recording, the
 * dialog is hidden and the host made click-through so the user can actually interact with the page; the inspector's own
 * UI is excluded from the capture. Each recording is scoped (selected node / its parent / app mount root) so the still
 * and viewer focus that subtree.
 */
export class DialogRecordingController extends RecordingControlLayer {
    // Definite-assignment markers erase. These stay unset until a recording starts, instead of beginning as null.
    pendingScopeSelector!: string | undefined;
    pendingScope!: RecordingScope | undefined;
    previewEl: HTMLElement | null = null;
    recordings: DialogRecording[] = [];
    seq = 0;

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
     * @param {DialogRecording} recording Recording entry to remove.
     * @returns {HTMLButtonElement} Remove button.
     */
    renderRemove(recording: DialogRecording): HTMLButtonElement {
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
