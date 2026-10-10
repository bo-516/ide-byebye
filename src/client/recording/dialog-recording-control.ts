import { el } from '../dialog/dialog-utils.js';
import { RecordingSession } from './recorder.js';
import { t } from '../lib/i18n.js';
import { RecordingMenuLayer } from './dialog-recording-menu.js';
import { durationLabel } from './dialog-recording-types.js';

/**
 * Floating recording control + elapsed-timer layer of the dialog recording controller.
 *
 * Boundary: owns the "recording" indicator shown while the dialog is hidden (stop button + elapsed ticker) and the
 * capture session handle. The record tool lives on the menu layer; still capture and thumbnails live on the top layer.
 */
export abstract class RecordingControlLayer extends RecordingMenuLayer {
    // Definite-assignment markers erase. This stays unset until a recording starts, instead of beginning as null.
    controlLabel!: HTMLElement | null;
    control: HTMLElement | null = null;
    timerId = 0;
    session: RecordingSession | null = null;

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

    /** Implemented by the lifecycle layer; called by the floating control's stop button. @returns {void} */
    abstract stop(): void;
}
