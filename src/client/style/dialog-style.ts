import { el, loadStyleChoices, loadStyleScope, loadStyleNodeLimit } from '../dialog/dialog-utils.js';
import { orderStyleKeys } from './style-keys.js';
import { captureStyles, type StyleCapture, type StyleScope } from './style-capture.js';
import { t } from '../lib/i18n.js';
import { StyleListLayer } from './dialog-style-list.js';

/**
 * Footer controller for attaching an element's rendered (computed) styles to the prompt context.
 *
 * Boundary: this owns one footer icon button, its dropdown panel (scope toggle + searchable multi-select), and a small
 * preview chip in the dialog body. Selected property keys and the scope are persisted as UI preferences; the actual
 * capture is read lazily at send time from the current selected element through {@link captureStyles}, so it always
 * reflects the latest DOM. Server-side prompt rendering stays authoritative for how the styles reach the agent.
 * Panel/menu rendering lives on {@link StylePanelLayer} and the property checklist on {@link StyleListLayer}.
 */
export class DialogStyleController extends StyleListLayer {
    previewEl: HTMLElement | null = null;

    /**
     * Reset style state for a freshly opened dialog.
     * Boundary: persisted property choices and scope are reloaded, but the open panel is closed so a new selection starts
     * from a tidy footer.
     * @returns {void}
     */
    reset(): void {
        // The helper's empty-set branch is `Set<unknown>`; every kept value is a catalog property name.
        this.choices = loadStyleChoices() as Set<string>;
        // Storage reads are `string | null`, and `includes` rejects null, so the helper's return is widened.
        // Every path still returns one of the four scopes (or `self`).
        this.scope = loadStyleScope() as StyleScope;
        this.nodeLimit = loadStyleNodeLimit();
        this.filter = '';
        if (this.panel)
            this.panel.hidden = true;
    }

    /** Tear down style state on dialog close. @returns {void} */
    clear(): void {
        if (this.panel)
            this.panel.hidden = true;
    }

    /**
     * Attach the preview container used for the style summary chip.
     * @param {HTMLElement} previewEl Preview container owned by the current dialog.
     * @returns {void}
     */
    attachPreview(previewEl: HTMLElement): void {
        this.previewEl = previewEl;
        // A missing node used to be ignored; the check keeps that no-op if a caller passes null through `el()`.
        if (this.previewEl)
            this.previewEl.hidden = true;
    }

    /**
     * Refresh the preview chip summarizing how many properties/nodes will be captured.
     * Boundary: the node count is computed from a live capture so it reflects the current scope and selected element; a
     * missing element or empty selection hides the chip.
     * @returns {void}
     */
    updatePreview(): void {
        const previewEl = this.previewEl;
        if (!previewEl)
            return;
        previewEl.innerHTML = '';
        const payload = this.buildPayloadStyles();
        if (!payload) {
            previewEl.hidden = true;
            return;
        }
        previewEl.hidden = false;
        const chip = el('div', 'cii-style-chip');
        chip.append(el('span', 'cii-style-chip-icon'));
        chip.append(el('span', 'cii-style-chip-text', t('styles.preview.summary', {
            props: payload.properties.length,
            nodes: payload.nodes.length,
        })));
        const remove = el('button', 'cii-style-chip-remove', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', t('styles.remove.aria'));
        remove.addEventListener('click', (event) => {
            event.stopPropagation();
            this.commitChoices(() => this.choices.clear());
        });
        chip.append(remove);
        previewEl.append(chip);
    }

    /**
     * Build the style payload entry for the send request.
     * Boundary: returns undefined when no property is selected, so the request omits `styles` entirely. When properties
     * ARE selected but the element is gone/detached (live capture yields nothing), `strict` callers throw instead of
     * silently dropping the selection — mirroring the screenshot controller — so send fails loudly rather than letting
     * the preview chip claim styles that never reach the agent. The non-strict preview path keeps degrading quietly.
     * The capture is read fresh here, not cached, so it matches the element's current rendered styles.
     * @param {{ strict?: boolean }} [options] Pass `strict: true` on the send path to surface a missing element.
     * @returns {StyleCapture | undefined} Style capture payload, if any.
     */
    buildPayloadStyles(options: { strict?: boolean } = {}): StyleCapture | undefined {
        if (!this.choices.size)
            return undefined;
        const element = this.host.selectedElement();
        const payload = element
            ? (captureStyles(element, { scope: this.scope, properties: orderStyleKeys(this.choices), maxNodes: this.nodeLimit }) ?? undefined)
            : undefined;
        if (!payload && options.strict)
            throw new Error(t('styles.error.elementGone'));
        return payload;
    }
}
