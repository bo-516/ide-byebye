import { el, saveStyleScope, saveStyleNodeLimit, STYLE_SCOPE_ORDER, revealDropdownPanel } from '../dialog/dialog-utils.js';
import { DEFAULT_STYLE_KEYS } from './style-keys.js';
import { clampNodeLimit, DEFAULT_NODE_LIMIT, type StyleScope } from './style-capture.js';
import { t } from '../lib/i18n.js';

/**
 * Callbacks the style footer needs from the open dialog.
 * Boundary: `selectedElement` is read at preview and send time. Omitting `onChange` skips reposition.
 */
export interface StyleDialogHost {
    selectedElement: () => Element | null;
    onChange?: () => void;
}

/**
 * Footer button and dropdown panel layer of the style controller.
 *
 * Boundary: owns the footer button, the panel shell (scope toggle + node-cap stepper + search box + checklist container
 * + footer row), and the persisted scope/nodeLimit values. The property checklist itself lives on the list layer; the
 * preview chip and send payload live on the top controller.
 */
export abstract class StylePanelLayer {
    host: StyleDialogHost;
    button: HTMLButtonElement | null = null;
    panel: HTMLElement | null = null;
    scopeButtons: Map<string, HTMLButtonElement> = new Map();
    nodeLimitRow: HTMLElement | null = null;
    nodeLimitValueEl: HTMLElement | null = null;
    scope: StyleScope = 'self';
    nodeLimit: number = DEFAULT_NODE_LIMIT;

    /**
     * @param {StyleDialogHost} host Dialog host callbacks.
     */
    constructor(host: StyleDialogHost) {
        this.host = host;
    }

    /**
     * Render the footer style button and its dropdown panel.
     * Boundary: creates fresh DOM for one dialog render and should be called after `reset()`. The controller owns the
     * returned wrapper until the dialog closes.
     * @returns {HTMLElement} Style picker wrapper.
     */
    renderButton(): HTMLElement {
        const wrapper = el('div', 'cii-screenshot-picker cii-style-picker');
        const button = el('button', 'cii-icon-btn');
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
        const panel = el('div', 'cii-screenshot-menu cii-style-panel');
        panel.hidden = true;

        panel.append(el('div', 'cii-style-panel-title', t('styles.panel.title')));

        // Scope toggle (selected element only / element + descendants / element + ancestors).
        panel.append(el('div', 'cii-style-scope-label', t('styles.scope.label')));
        const scopeRow = el('div', 'cii-style-scope');
        this.scopeButtons = new Map();
        for (const value of STYLE_SCOPE_ORDER) {
            const btn = el('button', 'cii-style-scope-btn', t(`styles.scope.${value}`));
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
        const searchEl = el('input', 'cii-style-search');
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
        const listEl = el('div', 'cii-style-list');
        this.listEl = listEl;
        panel.append(listEl);

        // Footer: selected count + quick "common defaults" + clear.
        const foot = el('div', 'cii-style-foot');
        const countEl = el('span', 'cii-style-count');
        this.countEl = countEl;
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
        const row = el('div', 'cii-style-nodes');
        row.append(el('span', 'cii-style-nodes-label', t('styles.nodes.label')));
        const stepper = el('div', 'cii-style-nodes-stepper');
        const dec = el('button', 'cii-style-nodes-btn', '−');
        dec.type = 'button';
        dec.addEventListener('click', (event) => {
            event.stopPropagation();
            this.setNodeLimit(this.nodeLimit - 1);
        });
        const nodeLimitValueEl = el('span', 'cii-style-nodes-value', String(this.nodeLimit));
        this.nodeLimitValueEl = nodeLimitValueEl;
        const inc = el('button', 'cii-style-nodes-btn', '+');
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

    /** Refresh the active scope toggle button and toggle the node-cap row (hidden for the single-node `self` scope). @returns {void} */
    updateScope(): void {
        for (const [value, button] of this.scopeButtons)
            button.classList.toggle('cii-style-scope-active', value === this.scope);
        if (this.nodeLimitRow)
            this.nodeLimitRow.hidden = this.scope === 'self';
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

    // --- Members owned by the list layer / top controller, declared here so panel code can reference them. ---

    listEl: HTMLElement | null = null;
    searchEl: HTMLInputElement | null = null;
    countEl: HTMLElement | null = null;
    choices: Set<string> = new Set();
    filter = '';

    /** Implemented by the list layer. @param {() => void} mutate @returns {void} */
    abstract commitChoices(mutate: () => void): void;

    /** Implemented by the list layer. @returns {void} */
    abstract renderList(): void;

    /** Implemented by the list layer. @returns {void} */
    abstract updateButton(): void;

    /** Implemented by the top controller. @returns {void} */
    abstract updatePreview(): void;
}
