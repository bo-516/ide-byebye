import { el, loadStyleChoices, saveStyleChoices, loadStyleScope, saveStyleScope, loadStyleNodeLimit, saveStyleNodeLimit, STYLE_SCOPE_ORDER, revealDropdownPanel } from '../dialog/dialog-utils.js';
import { STYLE_PROPERTY_KEYS, DEFAULT_STYLE_KEYS, orderStyleKeys } from './style-keys.js';
import { captureStyles, clampNodeLimit, DEFAULT_NODE_LIMIT, type StyleCapture, type StyleScope } from './style-capture.js';
import { t } from '../lib/i18n.js';

/**
 * Callbacks the style footer needs from the open dialog.
 * Boundary: `selectedElement` is read at preview and send time. Omitting `onChange` skips reposition.
 */
interface StyleDialogHost {
    selectedElement: () => Element | null;
    onChange?: () => void;
}

/**
 * Footer controller for attaching an element's rendered (computed) styles to the prompt context.
 *
 * Boundary: this owns one footer icon button, its dropdown panel (scope toggle + searchable multi-select), and a small
 * preview chip in the dialog body. Selected property keys and the scope are persisted as UI preferences; the actual
 * capture is read lazily at send time from the current selected element through {@link captureStyles}, so it always
 * reflects the latest DOM. Server-side prompt rendering stays authoritative for how the styles reach the agent.
 */
export class DialogStyleController {
    host: StyleDialogHost;
    button: HTMLButtonElement | null = null;
    panel: HTMLElement | null = null;
    listEl: HTMLElement | null = null;
    searchEl: HTMLInputElement | null = null;
    countEl: HTMLElement | null = null;
    previewEl: HTMLElement | null = null;
    scopeButtons: Map<string, HTMLButtonElement> = new Map();
    optionButtons: Map<string, HTMLButtonElement> = new Map();
    nodeLimitRow: HTMLElement | null = null;
    nodeLimitValueEl: HTMLElement | null = null;
    choices: Set<string> = new Set();
    scope: StyleScope = 'self';
    nodeLimit: number = DEFAULT_NODE_LIMIT;
    filter = '';

    /**
     * @param {{ selectedElement: () => (Element | null), onChange?: () => void }} host Dialog host callbacks.
     */
    constructor(host: StyleDialogHost) {
        this.host = host;
    }

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
     * Render the footer style button and its dropdown panel.
     * Boundary: creates fresh DOM for one dialog render and should be called after `reset()`. The controller owns the
     * returned wrapper until the dialog closes.
     * @returns {HTMLElement} Style picker wrapper.
     */
    renderButton(): HTMLElement {
        const wrapper: HTMLElement = el('div', 'cii-screenshot-picker cii-style-picker');
        const button: HTMLButtonElement = el('button', 'cii-icon-btn');
        this.button = button;
        button.type = 'button';
        button.append(el('span', 'cii-style-icon'));
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            const panel = this.panel;
            if (!panel)
                return;
            // Measure against the live viewport on open (gated so it paints only at the final spot) so a dialog sitting
            // high or near a side rail flips/clamps the panel into view instead of clipping it off-screen.
            if (panel.hidden)
                revealDropdownPanel(button, panel);
            else
                panel.hidden = true;
        });
        const panel = this.renderPanel();
        this.panel = panel;
        wrapper.append(button, panel);
        this.updateButton();
        return wrapper;
    }

    /**
     * Build the dropdown panel: scope toggle, search box, scrollable property checklist, and a footer count/clear row.
     * @returns {HTMLElement} Panel element.
     */
    renderPanel(): HTMLElement {
        const panel: HTMLElement = el('div', 'cii-screenshot-menu cii-style-panel');
        panel.hidden = true;

        panel.append(el('div', 'cii-style-panel-title', t('styles.panel.title')));

        // Scope toggle (selected element only / element + descendants / element + ancestors).
        panel.append(el('div', 'cii-style-scope-label', t('styles.scope.label')));
        const scopeRow = el('div', 'cii-style-scope');
        this.scopeButtons = new Map();
        for (const value of STYLE_SCOPE_ORDER) {
            const btn: HTMLButtonElement = el('button', 'cii-style-scope-btn', t(`styles.scope.${value}`));
            btn.type = 'button';
            btn.addEventListener('click', (event) => {
                event.stopPropagation();
                // `STYLE_SCOPE_ORDER` is a string list; every entry is a style scope.
                this.scope = value as StyleScope;
                saveStyleScope(value);
                this.updateScope();
                this.updatePreview();
                this.host.onChange?.();
            });
            this.scopeButtons.set(value, btn);
            scopeRow.append(btn);
        }
        panel.append(scopeRow);

        // Node cap for the tree scopes (children/ancestors); hidden for `self`, which is always a single node.
        panel.append(this.renderNodeLimit());

        // Search filter.
        const searchEl: HTMLInputElement = el('input', 'cii-style-search');
        this.searchEl = searchEl;
        searchEl.type = 'text';
        searchEl.placeholder = t('styles.search.placeholder');
        searchEl.spellcheck = false;
        searchEl.addEventListener('input', () => {
            this.filter = searchEl.value.trim().toLowerCase();
            this.renderList();
        });
        searchEl.addEventListener('keydown', (event) => event.stopPropagation());
        panel.append(searchEl);

        // Property checklist.
        const listEl: HTMLElement = el('div', 'cii-style-list');
        this.listEl = listEl;
        panel.append(listEl);

        // Footer: selected count + quick "common defaults" + clear.
        const foot = el('div', 'cii-style-foot');
        const countEl: HTMLElement = el('span', 'cii-style-count');
        this.countEl = countEl;
        const actions: HTMLElement = el('div', 'cii-style-foot-actions');
        const defaults: HTMLButtonElement = el('button', 'cii-style-action cii-style-defaults', t('styles.useDefaults'));
        defaults.type = 'button';
        defaults.addEventListener('click', (event) => {
            event.stopPropagation();
            this.commitChoices(() => {
                for (const key of DEFAULT_STYLE_KEYS)
                    this.choices.add(key);
            });
        });
        const clear: HTMLButtonElement = el('button', 'cii-style-action cii-style-clear', t('styles.clear'));
        clear.type = 'button';
        clear.addEventListener('click', (event) => {
            event.stopPropagation();
            this.commitChoices(() => this.choices.clear());
        });
        actions.append(defaults, clear);
        foot.append(countEl, actions);
        panel.append(foot);

        this.updateScope();
        this.renderList();
        return panel;
    }

    /**
     * Build the node-cap stepper shown for the tree scopes.
     * Boundary: `self` always captures exactly one node, so the row is hidden for that scope (see {@link updateScope}).
     * The chosen value persists and is reused as the initial value on the next open; it is clamped to the supported range
     * (the server backstop) so a larger request is never silently truncated.
     * @returns {HTMLElement} Node-limit row.
     */
    renderNodeLimit(): HTMLElement {
        const row: HTMLElement = el('div', 'cii-style-nodes');
        row.append(el('span', 'cii-style-nodes-label', t('styles.nodes.label')));
        const stepper: HTMLElement = el('div', 'cii-style-nodes-stepper');
        const dec: HTMLButtonElement = el('button', 'cii-style-nodes-btn', '−');
        dec.type = 'button';
        dec.addEventListener('click', (event) => {
            event.stopPropagation();
            this.setNodeLimit(this.nodeLimit - 1);
        });
        const nodeLimitValueEl: HTMLElement = el('span', 'cii-style-nodes-value', String(this.nodeLimit));
        this.nodeLimitValueEl = nodeLimitValueEl;
        const inc: HTMLButtonElement = el('button', 'cii-style-nodes-btn', '+');
        inc.type = 'button';
        inc.addEventListener('click', (event) => {
            event.stopPropagation();
            this.setNodeLimit(this.nodeLimit + 1);
        });
        stepper.append(dec, nodeLimitValueEl, inc);
        row.append(stepper);
        this.nodeLimitRow = row;
        return row;
    }

    /**
     * Apply a new node cap: clamp, persist, refresh the stepper label, and re-run the preview/dependents.
     * Boundary: a no-op change (already at a clamp bound) skips the refresh so a repeated click at the edge does nothing.
     * @param {number} value Requested node cap.
     * @returns {void}
     */
    setNodeLimit(value: number): void {
        const next = clampNodeLimit(value);
        if (next === this.nodeLimit)
            return;
        this.nodeLimit = next;
        saveStyleNodeLimit(next);
        const nodeLimitValueEl = this.nodeLimitValueEl;
        if (nodeLimitValueEl)
            nodeLimitValueEl.textContent = String(next);
        this.updatePreview();
        this.host.onChange?.();
    }

    /**
     * Apply a bulk mutation to the selected property set and run the full refresh sequence once.
     * Boundary: this is the shared path for the "common defaults", "clear", and preview-chip "remove" actions, which all
     * rebuild the list rather than toggling a single option in place. The single-option toggle in {@link renderOption}
     * intentionally does NOT use this (it avoids a full `renderList()` rebuild on every checkbox click).
     * @param {() => void} mutate Callback that mutates `this.choices`.
     * @returns {void}
     */
    commitChoices(mutate: () => void): void {
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
    renderList(): void {
        const listEl = this.listEl;
        if (!listEl)
            return;
        listEl.innerHTML = '';
        this.optionButtons = new Map();
        const matches = STYLE_PROPERTY_KEYS.filter((key) => !this.filter || key.includes(this.filter));
        if (!matches.length) {
            listEl.append(el('div', 'cii-style-empty', t('styles.empty')));
        }
        else {
            for (const key of matches)
                listEl.append(this.renderOption(key));
        }
        this.updateCount();
    }

    /**
     * Render one property checklist row.
     * @param {string} key Computed-style property name.
     * @returns {HTMLButtonElement} Option button.
     */
    renderOption(key: string): HTMLButtonElement {
        const button: HTMLButtonElement = el('button', 'cii-style-opt');
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
    updateOption(key: string): void {
        const button = this.optionButtons.get(key);
        if (button)
            this.applyOptionState(button, this.choices.has(key));
    }

    /** Apply the active mark/class to one option button. @param {HTMLElement} button @param {boolean} active @returns {void} */
    applyOptionState(button: HTMLElement, active: boolean): void {
        button.classList.toggle('cii-choice-active', active);
        const mark = button.querySelector('.cii-choice-mark');
        if (mark)
            mark.textContent = active ? '✓' : '';
    }

    /** Refresh the active scope toggle button and toggle the node-cap row (hidden for the single-node `self` scope). @returns {void} */
    updateScope(): void {
        for (const [value, button] of this.scopeButtons)
            button.classList.toggle('cii-style-scope-active', value === this.scope);
        if (this.nodeLimitRow)
            this.nodeLimitRow.hidden = this.scope === 'self';
    }

    /** Refresh the selected-count label. @returns {void} */
    updateCount(): void {
        const countEl = this.countEl;
        if (countEl)
            countEl.textContent = t('styles.selectedCount', { n: this.choices.size });
    }

    /**
     * Refresh the footer button active state and tooltip.
     * @returns {void}
     */
    updateButton(): void {
        const button = this.button;
        if (!button)
            return;
        const active = this.choices.size > 0;
        button.classList.toggle('cii-icon-btn-active', active);
        const title = active ? t('styles.summary', { n: this.choices.size }) : t('styles.button.title');
        button.dataset.ciiTip = title;
        button.setAttribute('aria-label', t('styles.button.title'));
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
        const remove: HTMLButtonElement = el('button', 'cii-style-chip-remove', '×');
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
     * Close the panel when a click lands outside the style picker.
     * @param {EventTarget | null} target Event target from the dialog mousedown listener.
     * @returns {void}
     */
    closeMenuFromOutside(target: EventTarget | null): void {
        const panel = this.panel;
        const button = this.button;
        if (!panel || !button || panel.hidden)
            return;
        if (target instanceof Node && !button.contains(target) && !panel.contains(target)) {
            panel.hidden = true;
        }
    }

    /** Disable or enable the style control during busy dialog states. @param {boolean} disabled @returns {void} */
    setDisabled(disabled: boolean): void {
        const button = this.button;
        if (button)
            button.disabled = disabled;
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
