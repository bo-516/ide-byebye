import { el } from '../dialog/dialog-utils.js';
import { durationLabel } from '../recording/dialog-recording-types.js';
import { t } from '../lib/i18n.js';
import { StateMenuLayer } from './dialog-state-menu.js';
import { componentHandleFor, startStateWatch } from './state-watch.js';
import type { ComponentInfo, ComponentSnapshot, StateWatchResult } from './state-types.js';

/**
 * Dialog controller that attaches a picked component's live state, and a recorded log of its state changes, to the
 * prompt.
 *
 * Boundary: lives for one dialog open cycle. The component is the one that rendered the selected element (React
 * `_debugOwner`, Vue `__vueParentComponent`), resolved when the dialog renders. "Attach current state" is read fresh at
 * send time; a watch hides the dialog so the user can operate the page, then keeps one result (a new watch replaces
 * it). Server-side prompt rendering decides how both reach the agent. Menu and pill DOM live on {@link StateMenuLayer}.
 */
export class DialogStateController extends StateMenuLayer {
    previewEl: HTMLElement | null = null;
    watchResult: StateWatchResult | null = null;

    /**
     * Reset for a freshly opened dialog: drop any watch (running or finished) and the current-state toggle.
     * @returns {void}
     */
    reset(): void {
        this.hideIndicator();
        this.session?.stop();
        this.session = null;
        this.watchResult = null;
        this.attachSnapshot = false;
        this.handle = null;
    }

    /** Tear down on dialog close. @returns {void} */
    clear(): void {
        this.reset();
    }

    /**
     * Resolve the component behind the selected element and render the tool for it.
     * Boundary: called from the dialog shell's render; returns null (no tool) when there is no React/Vue component.
     * @returns {HTMLElement | null} Tool wrapper, or null.
     */
    override renderButton(): HTMLElement | null {
        this.handle = componentHandleFor(this.host.selectedElement());
        return super.renderButton();
    }

    /**
     * Attach the preview container used for the state chips.
     * @param {HTMLElement} previewEl Chip container owned by the current dialog.
     * @returns {void}
     */
    attachPreview(previewEl: HTMLElement): void {
        this.previewEl = previewEl;
        this.updatePreview();
    }

    /**
     * Toggle the current-state attachment.
     * @param {boolean} on Whether to attach the state read at send time.
     * @returns {void}
     */
    setAttachSnapshot(on: boolean): void {
        this.attachSnapshot = on;
        this.updateChoiceMark();
        this.updatePreview();
    }

    /**
     * Start watching: take the first reading, hide the dialog so the page is usable, show the pill.
     * Boundary: an unmounted component (or a reader failure) shows an error and leaves the dialog as it was.
     * @returns {void}
     */
    startWatch(): void {
        if (!this.handle || this.session)
            return;
        try {
            this.session = startStateWatch(this.handle, { onUpdate: () => this.refreshIndicator() });
        }
        catch {
            this.host.showError(t('state.error.unmounted'));
            return;
        }
        this.host.setDialogHidden(true);
        this.showIndicator();
    }

    /**
     * Stop watching: keep the log as the watch attachment and bring the dialog back.
     * @returns {void}
     */
    stopWatch(): void {
        const session = this.session;
        this.session = null;
        this.hideIndicator();
        this.host.setDialogHidden(false);
        if (!session)
            return;
        this.watchResult = session.stop();
        this.updatePreview();
        this.host.reposition();
    }

    /**
     * Rebuild the chips: one for the current-state attachment, one for a finished watch, each removable.
     * @returns {void}
     */
    updatePreview(): void {
        const previewEl = this.previewEl;
        if (!previewEl)
            return;
        previewEl.innerHTML = '';
        const name = this.componentName();
        if (this.attachSnapshot)
            previewEl.append(this.renderChip(t('state.chip.snapshot', { name }), null, () => this.setAttachSnapshot(false)));
        const result = this.watchResult;
        if (result) {
            const text = t('state.chip.watch', { name, count: result.changes.length + result.dropped, time: durationLabel(result.durationMs) });
            previewEl.append(this.renderChip(text, watchSummary(result), () => {
                this.watchResult = null;
                this.updatePreview();
                this.host.reposition();
            }));
        }
        previewEl.hidden = !previewEl.childElementCount;
    }

    /**
     * Build one removable chip.
     * @param {string} text Chip label.
     * @param {string | null} title Hover text (the first logged changes), or null for none.
     * @param {() => void} onRemove Called by the × button.
     * @returns {HTMLElement} Chip element.
     */
    renderChip(text: string, title: string | null, onRemove: () => void): HTMLElement {
        const chip = el('div', 'cii-style-chip cii-state-chip');
        const remove = el('button', 'cii-style-chip-remove', '×');
        if (title)
            chip.title = title;
        chip.append(el('span', 'cii-state-chip-icon'), el('span', 'cii-style-chip-text', text));
        remove.type = 'button';
        remove.setAttribute('aria-label', t('state.remove.aria'));
        remove.addEventListener('click', (event) => {
            event.stopPropagation();
            onRemove();
        });
        chip.append(remove);
        return chip;
    }

    /**
     * Build the `componentState` entry of the send request.
     *
     * Boundary: undefined when nothing is attached. The current state is read now, so it matches the page at send time;
     * when it is attached but the component has unmounted, `strict` callers throw (send fails loudly instead of the chip
     * promising state that never reaches the agent).
     * @param {{ strict?: boolean }} [options] `strict: true` on the send path.
     * @returns {{ component: ComponentInfo, snapshot?: ComponentSnapshot, watch?: StateWatchResult } | undefined} Payload.
     */
    buildPayload(options: { strict?: boolean } = {}): { component: ComponentInfo; snapshot?: ComponentSnapshot; watch?: StateWatchResult } | undefined {
        if (!this.handle || (!this.attachSnapshot && !this.watchResult))
            return undefined;
        const snapshot = this.attachSnapshot ? this.handle.read() : null;
        if (this.attachSnapshot && !snapshot && options.strict)
            throw new Error(t('state.error.unmounted'));
        return {
            component: this.handle.info,
            ...(snapshot ? { snapshot } : {}),
            ...(this.watchResult ? { watch: this.watchResult } : {}),
        };
    }
}

/** Changes listed in a watch chip's hover text. */
const SUMMARY_LINES = 8;

/**
 * Hover text for a watch chip: the first few changes as `+1.2s path: from → to`.
 * @param {StateWatchResult} result Finished watch.
 * @returns {string} Multi-line summary (empty when nothing changed).
 */
function watchSummary(result: StateWatchResult): string {
    const lines = result.changes.slice(0, SUMMARY_LINES).map((change) => `+${durationLabel(change.t)} ${change.path}: ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`);
    const more = result.changes.length + result.dropped - lines.length;
    if (more > 0)
        lines.push(`… +${more}`);
    return lines.join('\n');
}
