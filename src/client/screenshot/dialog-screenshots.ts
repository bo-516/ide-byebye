import { captureScreenshot, type ScreenshotPayload, type ScreenshotScope } from './screenshot.js';
import { SCREENSHOT_SCOPE_ORDER } from '../dialog/dialog-utils.js';
import { t } from '../lib/i18n.js';
import { ScreenshotPreviewLayer } from './dialog-screenshot-preview.js';

/**
 * Local screenshot controller for the intent dialog.
 *
 * Boundary: screenshot choices, captures, pending state, and preview DOM are local to one dialog open cycle. The
 * screenshot anchor is read lazily through callbacks because the dialog owns both the primary source selection and the
 * real clicked element used for visual capture. Picker/menu rendering lives on {@link ScreenshotMenuLayer} and
 * thumbnails/lightbox on {@link ScreenshotPreviewLayer}.
 */
export class DialogScreenshotController extends ScreenshotPreviewLayer {
    /**
     * Capture all persisted screenshot choices for the current selected element.
     *
     * Boundary: this is best-effort on open; capture errors are reported through the dialog host and do not close the
     * dialog.
     *
     * @returns {Promise<void>} Resolves after selected captures settle.
     */
    async captureSelected(): Promise<void> {
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
     * @returns {Promise<ScreenshotPayload[] | undefined>} Captured screenshot payloads, if any.
     */
    async buildPayloadScreenshots(): Promise<ScreenshotPayload[] | undefined> {
        if (this.choices.size === 0)
            return undefined;
        if (!this.host.selectedElement())
            throw new Error(t('screenshot.error.elementGone'));
        const scopes = SCREENSHOT_SCOPE_ORDER.filter((scope) => this.choices.has(scope));
        return Promise.all(scopes.map((scope) => this.ensureCapture(scope)));
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
    async toggleChoice(choice: string): Promise<void> {
        if (choice === 'none') {
            this.choices.clear();
            this.captures.clear();
            this.capturePromises.clear();
            this.pending.clear();
            this.persistChoices();
            this.updatePicker();
            this.host.onChange?.();
            return;
        }
        if (this.choices.has(choice)) {
            this.choices.delete(choice);
            this.captures.delete(choice);
            this.capturePromises.delete(choice);
            this.pending.delete(choice);
            this.persistChoices();
            this.updatePicker();
            this.host.onChange?.();
            return;
        }
        this.choices.add(choice);
        this.persistChoices();
        this.updatePicker();
        this.host.onChange?.();
        try {
            await this.ensureCapture(choice);
        }
        catch (err) {
            this.choices.delete(choice);
            this.persistChoices();
            this.updatePicker();
            this.host.onChange?.();
            this.host.showError(err instanceof Error ? err.message : String(err));
        }
    }

    /**
     * Ensure a screenshot capture exists for one scope.
     *
     * Boundary: concurrent calls for the same scope share one promise. The capture is kept only if the scope remains
     * selected when rendering finishes.
     *
     * @param {string} scope Screenshot scope to capture.
     * @returns {Promise<ScreenshotPayload>} Screenshot payload.
     */
    ensureCapture(scope: string): Promise<ScreenshotPayload> {
        const existing = this.captures.get(scope);
        if (existing)
            return Promise.resolve(existing);
        const pending = this.capturePromises.get(scope);
        if (pending)
            return pending;
        const selectedElement = this.host.selectedElement();
        if (!selectedElement)
            return Promise.reject(new Error(t('screenshot.error.elementGone')));
        this.pending.add(scope);
        this.renderPreviews();
        // Persisted choices are filtered to SCREENSHOT_SCOPE_ORDER, which is exactly ScreenshotScope.
        const promise = captureScreenshot(selectedElement, scope as ScreenshotScope)
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
}
