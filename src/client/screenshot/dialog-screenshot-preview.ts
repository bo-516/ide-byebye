import { el, loadScreenshotChoices, SCREENSHOT_SCOPE_ORDER, screenshotScopeLabel } from '../dialog/dialog-utils.js';
import { t } from '../lib/i18n.js';
import type { ScreenshotPayload } from './screenshot.js';
import { ScreenshotMenuLayer } from './dialog-screenshot-menu.js';

/**
 * What one preview-strip thumbnail shows and does.
 * Boundary: a missing `payload` renders a spinner and disables the lightbox; `hint`, when given, becomes the hover
 * tooltip.
 */
export interface ThumbOptions {
    label: string;
    payload?: ScreenshotPayload;
    pending: boolean;
    onRemove: () => void;
    hint?: () => string;
}

/**
 * Thumbnail and lightbox layer of the dialog screenshot controller.
 *
 * Boundary: owns the preview strip, the per-scope capture cache, and the pending markers. The picker menu lives on the
 * base layer, pasted images on the layer above, and the capture lifecycle on the top controller.
 */
export abstract class ScreenshotPreviewLayer extends ScreenshotMenuLayer {
    /** Thumbnail strip. Absent until `attachPreview`. */
    previewEl?: HTMLElement;
    captures: Map<string, ScreenshotPayload> = new Map();
    capturePromises: Map<string, Promise<ScreenshotPayload>> = new Map();
    pending: Set<string> = new Set();

    /**
     * Reset screenshot state for a newly opened dialog.
     *
     * Boundary: persisted choices are loaded, but actual captures are cleared so screenshots always match the current
     * selected element.
     *
     * @returns {void}
     */
    reset(loadPersistedChoices = true): void {
        this.choices = loadPersistedChoices ? loadScreenshotChoices() : new Set();
        this.captures = new Map();
        this.capturePromises = new Map();
        this.pending = new Set();
    }

    clearCaptures(): void {
        this.captures.clear();
        this.capturePromises.clear();
        this.pending.clear();
    }

    /**
     * Clear transient screenshot state during dialog close.
     *
     * Boundary: persisted preferences are not changed; this only drops the current open-cycle data and pending markers.
     *
     * @returns {void}
     */
    clear(): void {
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
    attachPreview(previewEl: HTMLElement): void {
        this.previewEl = previewEl;
        previewEl.hidden = true;
    }

    /**
     * Render screenshot thumbnails, then pasted-image thumbnails, with their remove controls.
     *
     * Boundary: capture thumbnails mirror selected scopes in fixed order, and removing one also removes its scope from
     * the outgoing request payload. The strip is hidden only when it holds neither kind.
     *
     * @returns {void}
     */
    renderPreviews(): void {
        const previewEl = this.previewEl;
        if (!previewEl)
            return;
        previewEl.innerHTML = '';
        const selectedScopes = SCREENSHOT_SCOPE_ORDER.filter((scope) => this.choices.has(scope));
        for (const scope of selectedScopes) {
            previewEl.append(this.renderThumb({
                label: screenshotScopeLabel(scope),
                payload: this.captures.get(scope),
                pending: this.pending.has(scope),
                onRemove: () => this.removeScope(scope),
            }));
        }
        this.appendPastedPreviews(previewEl);
        previewEl.hidden = previewEl.childElementCount === 0;
    }

    /**
     * Render one thumbnail: the image (or a spinner while it is not ready) plus a remove button.
     *
     * Boundary: only a thumbnail with a payload opens the lightbox. `hint` is read on hover so the tooltip follows the
     * agent selected at that moment; omitted means no tooltip.
     *
     * @param {ThumbOptions} options Label, payload, pending flag, remove handler, optional hover hint.
     * @returns {HTMLElement} Thumbnail element for the preview strip.
     */
    renderThumb(options: ThumbOptions): HTMLElement {
        const item = el('div', 'cii-screenshot-thumb');
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.setAttribute('aria-label', t('screenshot.preview.aria', { label: options.label }));
        const media = el('div', 'cii-thumb-media');
        const payload = options.payload;
        if (payload) {
            const img = document.createElement('img');
            img.src = payload.dataUrl;
            img.alt = options.label;
            media.append(img);
            item.addEventListener('click', () => this.openPreview(payload, options.label));
            item.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    this.openPreview(payload, options.label);
                }
            });
        }
        else {
            media.append(el('span', 'cii-thumb-loading'));
        }
        const hint = options.hint;
        if (hint)
            item.addEventListener('mouseenter', () => item.setAttribute('title', hint()));
        const remove = el('button', 'cii-thumb-remove', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', t('screenshot.remove.aria', { label: options.label }));
        remove.addEventListener('click', (event) => {
            event.stopPropagation();
            options.onRemove();
        });
        item.append(media, remove);
        item.classList.toggle('cii-thumb-pending', options.pending);
        return item;
    }

    /**
     * Drop one capture scope, as its thumbnail's remove button does.
     *
     * Boundary: also drops pending and cached capture state for that scope. The persisted choice is left as it was.
     *
     * @param {string} scope Screenshot scope to remove.
     * @returns {void}
     */
    removeScope(scope: string): void {
        this.choices.delete(scope);
        this.captures.delete(scope);
        this.capturePromises.delete(scope);
        this.pending.delete(scope);
        this.updatePicker();
        this.host.onChange?.();
    }

    /**
     * Open a lightbox preview for a screenshot or pasted image.
     *
     * Boundary: this requires the current dialog backdrop to exist. If the dialog was closed while a capture settled,
     * the preview request is ignored.
     *
     * @param {ScreenshotPayload} capture Payload whose `dataUrl` is shown.
     * @param {string} label Accessible name of the image.
     * @returns {void}
     */
    openPreview(capture: ScreenshotPayload, label: string): void {
        const backdrop = this.host.backdrop();
        if (!backdrop)
            return;
        const lightbox = el('div', 'cii-image-lightbox');
        const frame = el('div', 'cii-image-frame');
        const img = document.createElement('img');
        img.src = capture.dataUrl;
        img.alt = label;
        const close = el('button', 'cii-image-close', '×');
        close.type = 'button';
        close.setAttribute('aria-label', t('screenshot.lightbox.close.aria'));
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

    /** Implemented by the pasted-image layer; appends its thumbnails after the capture ones. @returns {void} */
    abstract appendPastedPreviews(previewEl: HTMLElement): void;
}
