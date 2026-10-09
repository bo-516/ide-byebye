import { el, saveStyleChoices } from '../dialog/dialog-utils.js';
import { STYLE_PROPERTY_KEYS } from './style-keys.js';
import { t } from '../lib/i18n.js';
import { StylePanelLayer } from './dialog-style-panel.js';

/**
 * Property checklist layer of the style controller.
 *
 * Boundary: owns the option buttons, the selected `choices` set, the search filter, and the count/button refresh. The
 * panel shell lives on the base layer; the preview chip and send payload live on the top controller.
 */
export abstract class StyleListLayer extends StylePanelLayer {
    optionButtons: Map<string, HTMLButtonElement> = new Map();

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
}
