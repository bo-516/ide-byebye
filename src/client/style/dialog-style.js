import { el, loadStyleChoices, saveStyleChoices, loadStyleScope, saveStyleScope } from '../dialog/dialog-utils.js';
import { STYLE_PROPERTY_KEYS, DEFAULT_STYLE_KEYS, orderStyleKeys } from './style-keys.js';
import { captureStyles } from './style-capture.js';
import { t } from '../lib/i18n.js';

/**
 * Footer controller for attaching an element's rendered (computed) styles to the prompt context.
 *
 * Boundary: this owns one footer icon button, its dropdown panel (scope toggle + searchable multi-select), and a small
 * preview chip in the dialog body. Selected property keys and the scope are persisted as UI preferences; the actual
 * capture is read lazily at send time from the current selected element through {@link captureStyles}, so it always
 * reflects the latest DOM. Server-side prompt rendering stays authoritative for how the styles reach the agent.
 */
export class DialogStyleController {
    host;
    button = null;
    panel = null;
    listEl = null;
    searchEl = null;
    countEl = null;
    previewEl = null;
    scopeButtons = new Map();
    optionButtons = new Map();
    choices = new Set();
    scope = 'self';
    filter = '';

    /**
     * @param {{ selectedElement: () => (Element | null), onChange?: () => void }} host Dialog host callbacks.
     */
    constructor(host) {
        this.host = host;
    }

    /**
     * Reset style state for a freshly opened dialog.
     * Boundary: persisted property choices and scope are reloaded, but the open panel is closed so a new selection starts
     * from a tidy footer.
     * @returns {void}
     */
    reset() {
        this.choices = loadStyleChoices();
        this.scope = loadStyleScope();
        this.filter = '';
        if (this.panel)
            this.panel.hidden = true;
    }

    /** Tear down style state on dialog close. @returns {void} */
    clear() {
        if (this.panel)
            this.panel.hidden = true;
    }

    /**
     * Attach the preview container used for the style summary chip.
     * @param {HTMLElement} previewEl Preview container owned by the current dialog.
     * @returns {void}
     */
    attachPreview(previewEl) {
        this.previewEl = previewEl;
        if (this.previewEl)
            this.previewEl.hidden = true;
    }

    /**
     * Render the footer style button and its dropdown panel.
     * Boundary: creates fresh DOM for one dialog render and should be called after `reset()`. The controller owns the
     * returned wrapper until the dialog closes.
     * @returns {HTMLElement} Style picker wrapper.
     */
    renderButton() {
        const wrapper = el('div', 'cii-screenshot-picker cii-style-picker');
        this.button = el('button', 'cii-icon-btn');
        this.button.type = 'button';
        this.button.append(el('span', 'cii-style-icon'));
        this.button.addEventListener('click', (event) => {
            event.stopPropagation();
            if (this.panel)
                this.panel.hidden = !this.panel.hidden;
        });
        this.panel = this.renderPanel();
        wrapper.append(this.button, this.panel);
        this.updateButton();
        return wrapper;
    }

    /**
     * Build the dropdown panel: scope toggle, search box, scrollable property checklist, and a footer count/clear row.
     * @returns {HTMLElement} Panel element.
     */
    renderPanel() {
        const panel = el('div', 'cii-screenshot-menu cii-style-panel');
        panel.hidden = true;

        panel.append(el('div', 'cii-style-panel-title', t('styles.panel.title')));

        // Scope toggle (selected element only / element + ancestors).
        panel.append(el('div', 'cii-style-scope-label', t('styles.scope.label')));
        const scopeRow = el('div', 'cii-style-scope');
        this.scopeButtons = new Map();
        for (const value of ['self', 'ancestors']) {
            const btn = el('button', 'cii-style-scope-btn', t(`styles.scope.${value}`));
            btn.type = 'button';
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                this.scope = value;
                saveStyleScope(value);
                this.updateScope();
                this.updatePreview();
                this.host.onChange?.();
            });
            this.scopeButtons.set(value, btn);
            scopeRow.append(btn);
        }
        panel.append(scopeRow);

        // Search filter.
        this.searchEl = el('input', 'cii-style-search');
        this.searchEl.type = 'text';
        this.searchEl.placeholder = t('styles.search.placeholder');
        this.searchEl.spellcheck = false;
        this.searchEl.addEventListener('input', () => {
            this.filter = this.searchEl.value.trim().toLowerCase();
            this.renderList();
        });
        this.searchEl.addEventListener('keydown', (event) => event.stopPropagation());
        panel.append(this.searchEl);

        // Property checklist.
        this.listEl = el('div', 'cii-style-list');
        panel.append(this.listEl);

        // Footer: selected count + quick "common defaults" + clear.
        const foot = el('div', 'cii-style-foot');
        this.countEl = el('span', 'cii-style-count');
        const actions = el('div', 'cii-style-foot-actions');
        const defaults = el('button', 'cii-style-action cii-style-defaults', t('styles.useDefaults'));
        defaults.type = 'button';
        defaults.addEventListener('click', (event) => {
            event.stopPropagation();
            this.commitChoices(() => {
                for (const key of DEFAULT_STYLE_KEYS)
                    this.choices.add(key);
            });
        });
        const clear = el('button', 'cii-style-action cii-style-clear', t('styles.clear'));
        clear.type = 'button';
        clear.addEventListener('click', (event) => {
            event.stopPropagation();
            this.commitChoices(() => this.choices.clear());
        });
        actions.append(defaults, clear);
        foot.append(this.countEl, actions);
        panel.append(foot);

        this.updateScope();
        this.renderList();
        return panel;
    }

    /**
     * Apply a bulk mutation to the selected property set and run the full refresh sequence once.
     * Boundary: this is the shared path for the "common defaults", "clear", and preview-chip "remove" actions, which all
     * rebuild the list rather than toggling a single option in place. The single-option toggle in {@link renderOption}
     * intentionally does NOT use this (it avoids a full `renderList()` rebuild on every checkbox click).
     * @param {() => void} mutate Callback that mutates `this.choices`.
     * @returns {void}
     */
    commitChoices(mutate) {
        mutate();
        saveStyleChoices(this.choices);
        this.renderList();
        this.updateButton();
        this.updatePreview();
        this.host.onChange?.();
    }

    /**
     * Render (or re-render) the filtered property checklist.
     * @returns {void}
     */
    renderList() {
        if (!this.listEl)
            return;
        this.listEl.innerHTML = '';
        this.optionButtons = new Map();
        const matches = STYLE_PROPERTY_KEYS.filter((key) => !this.filter || key.includes(this.filter));
        if (!matches.length) {
            this.listEl.append(el('div', 'cii-style-empty', t('styles.empty')));
        }
        else {
            for (const key of matches)
                this.listEl.append(this.renderOption(key));
        }
        this.updateCount();
    }

    /**
     * Render one property checklist row.
     * @param {string} key Computed-style property name.
     * @returns {HTMLButtonElement} Option button.
     */
    renderOption(key) {
        const button = el('button', 'cii-style-opt');
        button.type = 'button';
        button.append(el('span', 'cii-choice-mark'), el('span', 'cii-style-opt-label', key));
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            if (this.choices.has(key))
                this.choices.delete(key);
            else
                this.choices.add(key);
            saveStyleChoices(this.choices);
            this.updateOption(key);
            this.updateCount();
            this.updateButton();
            this.updatePreview();
            this.host.onChange?.();
        });
        this.optionButtons.set(key, button);
        this.applyOptionState(button, this.choices.has(key));
        return button;
    }

    /** Toggle one option's active state in place. @param {string} key @returns {void} */
    updateOption(key) {
        const button = this.optionButtons.get(key);
        if (button)
            this.applyOptionState(button, this.choices.has(key));
    }

    /** Apply the active mark/class to one option button. @param {HTMLElement} button @param {boolean} active @returns {void} */
    applyOptionState(button, active) {
        button.classList.toggle('cii-choice-active', active);
        const mark = button.querySelector('.cii-choice-mark');
        if (mark)
            mark.textContent = active ? '✓' : '';
    }

    /** Refresh the active scope toggle button. @returns {void} */
    updateScope() {
        for (const [value, button] of this.scopeButtons)
            button.classList.toggle('cii-style-scope-active', value === this.scope);
    }

    /** Refresh the selected-count label. @returns {void} */
    updateCount() {
        if (this.countEl)
            this.countEl.textContent = t('styles.selectedCount', { n: this.choices.size });
    }

    /**
     * Refresh the footer button active state and tooltip.
     * @returns {void}
     */
    updateButton() {
        if (!this.button)
            return;
        const active = this.choices.size > 0;
        this.button.classList.toggle('cii-icon-btn-active', active);
        const title = active ? t('styles.summary', { n: this.choices.size }) : t('styles.button.title');
        this.button.title = title;
        this.button.setAttribute('aria-label', t('styles.button.title'));
    }

    /**
     * Refresh the preview chip summarizing how many properties/nodes will be captured.
     * Boundary: the node count is computed from a live capture so it reflects the current scope and selected element; a
     * missing element or empty selection hides the chip.
     * @returns {void}
     */
    updatePreview() {
        if (!this.previewEl)
            return;
        this.previewEl.innerHTML = '';
        const payload = this.buildPayloadStyles();
        if (!payload) {
            this.previewEl.hidden = true;
            return;
        }
        this.previewEl.hidden = false;
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
        this.previewEl.append(chip);
    }

    /**
     * Close the panel when a click lands outside the style picker.
     * @param {EventTarget | null} target Event target from the dialog mousedown listener.
     * @returns {void}
     */
    closeMenuFromOutside(target) {
        if (!this.panel || !this.button || this.panel.hidden)
            return;
        if (target instanceof Node && !this.button.contains(target) && !this.panel.contains(target)) {
            this.panel.hidden = true;
        }
    }

    /** Disable or enable the style control during busy dialog states. @param {boolean} disabled @returns {void} */
    setDisabled(disabled) {
        if (this.button)
            this.button.disabled = disabled;
    }

    /**
     * Build the style payload entry for the send request.
     * Boundary: returns undefined when no property is selected, so the request omits `styles` entirely. When properties
     * ARE selected but the element is gone/detached (live capture yields nothing), `strict` callers throw instead of
     * silently dropping the selection — mirroring the screenshot controller — so send fails loudly rather than letting
     * the preview chip claim styles that never reach the agent. The non-strict preview path keeps degrading quietly.
     * The capture is read fresh here, not cached, so it matches the element's current rendered styles.
     * @param {{ strict?: boolean }} [options] Pass `strict: true` on the send path to surface a missing element.
     * @returns {Record<string, unknown> | undefined} Style capture payload, if any.
     */
    buildPayloadStyles(options = {}) {
        if (!this.choices.size)
            return undefined;
        const element = this.host.selectedElement();
        const payload = element
            ? (captureStyles(element, { scope: this.scope, properties: orderStyleKeys(this.choices) }) ?? undefined)
            : undefined;
        if (!payload && options.strict)
            throw new Error(t('styles.error.elementGone'));
        return payload;
    }
}
