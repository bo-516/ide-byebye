import { MAX_PASTED_IMAGES } from '../../shared/constants.js';
import { t } from '../lib/i18n.js';
import { ScreenshotPreviewLayer } from './dialog-screenshot-preview.js';
import { normalizePastedImage } from './pasted-image.js';
import type { ScreenshotPayload } from './screenshot.js';

/**
 * One image pasted into the dialog.
 * Boundary: `payload` is unset while the file decodes (the thumbnail shows a spinner). `ready` never rejects: it
 * settles to the payload, or to null when decoding failed or the image was removed before it finished.
 */
export interface PastedImageEntry {
    payload?: ScreenshotPayload;
    ready: Promise<ScreenshotPayload | null>;
}

/**
 * Pasted-image layer of the dialog screenshot controller.
 *
 * Boundary: owns the images pasted during one dialog open cycle and their thumbnails, which share the capture strip
 * and lightbox. They are not tied to the picked element, so they survive primary switches but are dropped on
 * open, close and pin restore, like captures. Sending them is the top controller's job.
 */
export abstract class PastedImageLayer extends ScreenshotPreviewLayer {
    pasted: PastedImageEntry[] = [];

    /**
     * Reset for a newly opened dialog (see {@link ScreenshotPreviewLayer.reset}); pasted images are dropped too.
     *
     * @param {boolean} [loadPersistedChoices=true] Whether to restore the persisted capture choices.
     * @returns {void}
     */
    reset(loadPersistedChoices = true): void {
        super.reset(loadPersistedChoices);
        this.pasted = [];
    }

    /**
     * Clear transient state on close (see {@link ScreenshotPreviewLayer.clear}); pasted images are dropped too.
     *
     * @returns {void}
     */
    clear(): void {
        super.clear();
        this.pasted = [];
    }

    /**
     * Attach image files from a paste.
     *
     * Boundary: at most `MAX_PASTED_IMAGES` per dialog; files past the limit are skipped with an error, the rest are
     * kept. Each file shows a spinner thumbnail until it decodes; a file that fails is removed and reported through
     * the dialog host.
     *
     * @param {readonly Blob[]} files Image files from `pickClipboardImages`.
     * @returns {Promise<void>} Resolves once every accepted file has settled.
     */
    async addPasted(files: readonly Blob[]): Promise<void> {
        const room = Math.max(0, MAX_PASTED_IMAGES - this.pasted.length);
        if (files.length > room)
            this.host.showError(t('image.paste.tooMany', { max: MAX_PASTED_IMAGES }));
        const entries = files.slice(0, room).map((file) => this.trackPasted(file));
        if (!entries.length)
            return;
        this.renderPreviews();
        this.host.reposition();
        await Promise.all(entries.map((entry) => entry.ready));
    }

    /**
     * Start decoding one pasted file and add its entry to the list.
     *
     * Boundary: a result that arrives after the entry was removed (or the dialog closed) is discarded silently.
     *
     * @param {Blob} file Pasted image file.
     * @returns {PastedImageEntry} The new entry, already in `pasted`.
     */
    trackPasted(file: Blob): PastedImageEntry {
        const entry: PastedImageEntry = { ready: Promise.resolve(null) };
        const settle = () => {
            this.renderPreviews();
            this.host.reposition();
        };
        entry.ready = normalizePastedImage(file).then((payload) => {
            if (!this.pasted.includes(entry))
                return null;
            entry.payload = payload;
            settle();
            return payload;
        }, (err: unknown) => {
            if (!this.pasted.includes(entry))
                return null;
            this.pasted = this.pasted.filter((item) => item !== entry);
            settle();
            this.host.showError(err instanceof Error ? err.message : String(err));
            return null;
        });
        this.pasted.push(entry);
        return entry;
    }

    /**
     * Append one thumbnail per pasted image to the preview strip, numbered in paste order.
     *
     * @param {HTMLElement} previewEl Strip already holding the capture thumbnails.
     * @returns {void}
     */
    appendPastedPreviews(previewEl: HTMLElement): void {
        this.pasted.forEach((entry, index) => {
            previewEl.append(this.renderThumb({
                label: t('image.pasted.label', { n: index + 1 }),
                payload: entry.payload,
                pending: !entry.payload,
                hint: this.host.pastedImageHint,
                onRemove: () => this.removePasted(entry),
            }));
        });
    }

    /**
     * Remove one pasted image, as its thumbnail's remove button does.
     *
     * @param {PastedImageEntry} entry Entry to drop; an entry no longer in the list is ignored.
     * @returns {void}
     */
    removePasted(entry: PastedImageEntry): void {
        this.pasted = this.pasted.filter((item) => item !== entry);
        this.renderPreviews();
        this.host.reposition();
        this.host.onChange?.();
    }

    /**
     * Wait for pending pasted images and return the ones to send.
     *
     * Boundary: images that failed or were removed while decoding are left out; order is paste order.
     *
     * @returns {Promise<ScreenshotPayload[]>} Payloads with `scope: 'pasted'`, possibly empty.
     */
    async buildPastedPayloads(): Promise<ScreenshotPayload[]> {
        await Promise.all(this.pasted.map((entry) => entry.ready));
        return this.pasted.flatMap((entry) => (entry.payload ? [entry.payload] : []));
    }
}
