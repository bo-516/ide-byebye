import { el, saveScreenshotChoices, screenshotScopeTitleLabel, revealDropdownPanel } from '../dialog/dialog-utils.js';
import { t } from '../lib/i18n.js';

/**
 * Dialog callbacks for one screenshot picker.
 * Boundary: `onChange` may be omitted; captures then skip the dialog refresh. `selectedElement` is read at capture time.
 */
export interface ScreenshotDialogHost {
    selectedElement: () => Element | null;
    backdrop: () => HTMLElement | null;
    reposition: () => void;
    showError: (message: string) => void;
    onChange?: () => void;
}

/**
 * Footer picker layer of the dialog screenshot controller.
 *
 * Boundary: owns the picker button, the scope menu, and the persisted `choices` set. Captures, pending state, and the
 * thumbnail strip live on subclasses; this layer only renders the menu and reports choice state.
 */
export abstract class ScreenshotMenuLayer {
    host: ScreenshotDialogHost;
    /** Footer button. Unset until `renderPicker`; callers must not use the picker before that. */
    button!: HTMLButtonElement;
    /** Scope menu. Unset until `renderPicker`. */
    menu!: HTMLElement;
    choices: Set<string> = new Set();
    choiceButtons: Map<string, HTMLButtonElement> = new Map();

    /**
     * @param {ScreenshotDialogHost} host Dialog callbacks for the current open cycle.
     */
    constructor(host: ScreenshotDialogHost) {
        this.host = host;
    }

    /**
     * Render the footer screenshot picker.
     *
     * Boundary: this creates fresh DOM for one dialog render and should be called after `reset()`. The controller owns
     * the returned button and menu until the dialog closes.
     *
     * @returns {HTMLElement} Screenshot picker wrapper.
     */
    renderPicker(): HTMLElement {
        const wrapper = el('div', 'cii-screenshot-picker');
        const button = el('button', 'cii-icon-btn');
        this.button = button;
        button.type = 'button';
        button.dataset.ciiTip = t('screenshot.settings.title');
        button.setAttribute('aria-label', t('screenshot.settings.title'));
        button.append(el('span', 'cii-shot-icon'));
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            if (this.menu.hidden)
                revealDropdownPanel(button, this.menu);
            else
                this.menu.hidden = true;
        });
        const menu = el('div', 'cii-screenshot-menu');
        this.menu = menu;
        menu.hidden = true;
        this.choiceButtons = new Map();
        menu.append(this.renderChoice('none', t('screenshot.choice.none')), this.renderChoice('selection', t('screenshot.scope.selection')), this.renderChoice('parent', t('screenshot.scope.parent')), this.renderChoice('viewport', t('screenshot.scope.viewport')));
        wrapper.append(button, menu);
        this.updatePicker();
        return wrapper;
    }

    /**
     * Close the menu when a click lands outside the screenshot picker.
     *
     * Boundary: this is safe before the picker is rendered. It only handles outside clicks for the current menu and
     * leaves other footer popovers alone.
     *
     * @param {EventTarget | null} target Event target from the dialog mousedown listener.
     * @returns {void}
     */
    closeMenuFromOutside(target: EventTarget | null): void {
        if (!this.menu || !this.button || this.menu.hidden)
            return;
        if (target instanceof Node && !this.button.contains(target) && !this.menu.contains(target)) {
            this.menu.hidden = true;
        }
    }

    /**
     * Disable or enable the screenshot control during busy states.
     *
     * Boundary: pending capture promises are not canceled; this only blocks new user interaction while resolving or
     * sending the request.
     *
     * @param {boolean} disabled Whether controls should be disabled.
     * @returns {void}
     */
    setDisabled(disabled: boolean): void {
        if (this.button)
            this.button.disabled = disabled;
    }

    /**
     * Render one screenshot menu choice.
     *
     * Boundary: `choice` must be either `none` or one supported screenshot scope; unsupported values will never be
     * persisted by `saveScreenshotChoices` but would still render a button. Choosing `none` closes this menu after the
     * selection state is cleared; screenshot scopes stay open so users can combine region and viewport captures.
     *
     * @param {string} choice Choice value to toggle.
     * @param {string} label Visible menu label.
     * @returns {HTMLButtonElement} Menu button.
     */
    renderChoice(choice: string, label: string): HTMLButtonElement {
        const button = el('button', 'cii-screenshot-choice');
        button.type = 'button';
        button.append(el('span', 'cii-choice-mark'), el('span', 'cii-choice-label', label));
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            void this.toggleChoice(choice);
            if (choice === 'none' && this.menu) {
                this.menu.hidden = true;
            }
        });
        this.choiceButtons.set(choice, button);
        return button;
    }

    /**
     * Refresh screenshot picker labels, active states, and previews.
     *
     * Boundary: this assumes the picker DOM exists; callers should not call it before `renderPicker()`.
     *
     * @returns {void}
     */
    updatePicker(): void {
        const hasScreenshots = this.choices.size > 0;
        this.button.classList.toggle('cii-icon-btn-active', hasScreenshots);
        this.button.dataset.ciiTip = hasScreenshots
            ? t('screenshot.summary', {
                list: Array.from(this.choices)
                    .map((scope) => screenshotScopeTitleLabel(scope))
                    .join(' + '),
            })
            : t('screenshot.choice.none');
        for (const [choice, button] of this.choiceButtons) {
            const active = choice === 'none' ? !hasScreenshots : this.choices.has(choice);
            button.classList.toggle('cii-choice-active', active);
            const mark = button.querySelector('.cii-choice-mark');
            if (mark)
                mark.textContent = active ? '✓' : '';
        }
        this.renderPreviews();
    }

    /**
     * Persist screenshot choices as a best-effort preference.
     *
     * Boundary: storage errors are swallowed inside `saveScreenshotChoices`; this method only centralizes the write.
     *
     * @returns {void}
     */
    persistChoices(): void {
        saveScreenshotChoices(this.choices);
    }

    /** Implemented by the preview layer; refreshes the thumbnail strip after choice changes. @returns {void} */
    abstract renderPreviews(): void;

    /** Implemented by the capture layer; toggles one menu choice and captures it when enabled. @returns {Promise<void>} */
    abstract toggleChoice(choice: string): Promise<void>;
}
