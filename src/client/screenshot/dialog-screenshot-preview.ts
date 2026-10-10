import { el, loadScreenshotChoices, SCREENSHOT_SCOPE_ORDER, screenshotScopeLabel } from '../dialog/dialog-utils.js';
import { t } from '../lib/i18n.js';
import type { ScreenshotPayload } from './screenshot.js';
import { ScreenshotMenuLayer } from './dialog-screenshot-menu.js';

/**
 * Thumbnail and lightbox layer of the dialog screenshot controller.
 *
 * Boundary: owns the preview strip, the per-scope capture cache, and the pending markers. The picker menu lives on the
 * base layer; the capture lifecycle stays on the top controller.
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
     * Render screenshot thumbnails and remove controls.
     *
     * Boundary: thumbnails mirror selected scopes in fixed order. Removing a thumbnail also removes its scope from the
     * outgoing request payload.
     *
     * @returns {void}
     */
    renderPreviews(): void {
        const previewEl = this.previewEl;
        if (!previewEl)
            return;
        previewEl.innerHTML = '';
        const selectedScopes = SCREENSHOT_SCOPE_ORDER.filter((scope) => this.choices.has(scope));
        previewEl.hidden = selectedScopes.length === 0;
        if (!selectedScopes.length)
            return;
        for (const scope of selectedScopes) {
            const item = el('div', 'cii-screenshot-thumb');
            item.tabIndex = 0;
            item.setAttribute('role', 'button');
            item.setAttribute('aria-label', t('screenshot.preview.aria', { label: screenshotScopeLabel(scope) }));
            const media = this.renderPreviewMedia(scope, item);
            const remove = this.renderRemoveButton(scope);
            item.append(media, remove);
            item.classList.toggle('cii-thumb-pending', this.pending.has(scope));
            previewEl.append(item);
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
    renderPreviewMedia(scope: string, item: HTMLElement): HTMLElement {
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
    renderRemoveButton(scope: string): HTMLButtonElement {
        const remove = el('button', 'cii-thumb-remove', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', t('screenshot.remove.aria', { label: screenshotScopeLabel(scope) }));
        remove.addEventListener('click', (event) => {
            event.stopPropagation();
            this.choices.delete(scope);
            this.captures.delete(scope);
            this.capturePromises.delete(scope);
            this.pending.delete(scope);
            this.updatePicker();
            this.host.onChange?.();
        });
        return remove;
    }

    /**
     * Open a lightbox preview for a captured screenshot.
     *
     * Boundary: this requires the current dialog backdrop to exist. If the dialog was closed while a capture settled,
     * the preview request is ignored.
     *
     * @param {ScreenshotPayload} capture Screenshot payload from `captureScreenshot`.
     * @returns {void}
     */
    openPreview(capture: ScreenshotPayload): void {
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
}
