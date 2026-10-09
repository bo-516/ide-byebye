import { el, revealDropdownPanel } from '../dialog/dialog-utils.js';
import { RECORDING_SCOPES, recordingScopeLabel, type RecordingScope } from './recording-scope.js';
import { t } from '../lib/i18n.js';
import type { DialogRecordingHost } from './dialog-recording-types.js';

/**
 * Record tool and scope popover layer of the dialog recording controller.
 *
 * Boundary: owns the record button, its scope/start popover, and the `scope` choice (which survives dialog opens). The
 * recording lifecycle and previews live on subclasses; this layer only renders the tool and reports enablement.
 */
export abstract class RecordingMenuLayer {
    host: DialogRecordingHost;
    button: HTMLButtonElement | null = null;
    menu: HTMLElement | null = null;
    scopeChoiceButtons = new Map<RecordingScope, HTMLButtonElement>();
    scope: RecordingScope = 'selection';

    /**
     * @param {DialogRecordingHost} host Dialog host callbacks. See {@link DialogRecordingHost}.
     */
    constructor(host: DialogRecordingHost) {
        this.host = host;
    }

    /** Whether the recording feature is enabled by plugin config. @returns {boolean} */
    isEnabled(): boolean {
        // `recording` is on the injected config but not on the dialog's `enabledAgents`-only type.
        // Optional chaining matches the previous `config()?.recording?.enabled` when `config()` is nullish.
        const config = this.host.config() as { recording?: { enabled?: unknown } } | null | undefined;
        return config?.recording?.enabled === true;
    }

    /** Privacy block-class for replay/still, from config. @returns {string} */
    blockClass(): string {
        const config = this.host.config() as { recording?: { mask?: { blockClass?: unknown } } } | null | undefined;
        const cls = config?.recording?.mask?.blockClass;
        return typeof cls === 'string' && cls ? cls : 'rr-block';
    }

    /**
     * Render the recording tool: one icon button whose popover picks the scope and starts recording.
     * Boundary: returns null when recording is disabled so the dialog omits the tool. Recording is deliberate and
     * infrequent, so it takes a confirming click ("Start recording") instead of a permanently visible scope control;
     * stopping happens from the floating control (the dialog is hidden while capturing). The scope choice survives
     * dialog opens.
     * @returns {HTMLElement | null} Tool wrapper (button + popover), or null when disabled.
     */
    renderButton(): HTMLElement | null {
        if (!this.isEnabled())
            return null;
        const wrapper = el('div', 'cii-screenshot-picker cii-rec-picker');
        // Locals (not `this.button` / `this.menu`) stay non-null inside the click callbacks,
        // which run later and would otherwise see the `HTMLElement | null` field type.
        const button = el('button', 'cii-icon-btn cii-rec-toggle');
        this.button = button;
        button.type = 'button';
        button.dataset.ciiTip = t('recording.toggle.title');
        button.setAttribute('aria-label', t('recording.toggle.title'));
        button.setAttribute('aria-haspopup', 'menu');
        button.append(el('span', 'cii-rec-icon'));
        const menu = el('div', 'cii-screenshot-menu cii-rec-menu');
        this.menu = menu;
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            if (menu.hidden)
                revealDropdownPanel(button, menu);
            else
                menu.hidden = true;
        });
        menu.hidden = true;
        menu.append(el('div', 'cii-menu-caption', t('recording.scope.title')));
        this.scopeChoiceButtons = new Map();
        for (const value of RECORDING_SCOPES)
            menu.append(this.renderScopeChoice(value));
        const start = el('button', 'cii-rec-start', t('recording.start'));
        start.type = 'button';
        start.addEventListener('click', (event) => {
            event.stopPropagation();
            menu.hidden = true;
            void this.start();
        });
        menu.append(start);
        this.updateScopeMarks();
        wrapper.append(button, menu);
        return wrapper;
    }

    /**
     * Render one scope choice row (label + check when active); picking a scope keeps the popover open for Start.
     * @param {RecordingScope} scope Scope value.
     * @returns {HTMLButtonElement} Choice button.
     */
    renderScopeChoice(scope: RecordingScope): HTMLButtonElement {
        const button = el('button', 'cii-screenshot-choice');
        button.type = 'button';
        button.append(el('span', 'cii-choice-mark'), el('span', 'cii-choice-label', recordingScopeLabel(scope)));
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            this.scope = scope;
            this.updateScopeMarks();
        });
        this.scopeChoiceButtons.set(scope, button);
        return button;
    }

    /** Refresh the active ✓ mark on each scope choice. @returns {void} */
    updateScopeMarks() {
        for (const [scope, button] of this.scopeChoiceButtons) {
            const active = scope === this.scope;
            button.classList.toggle('cii-choice-active', active);
            const mark = button.querySelector('.cii-choice-mark');
            if (mark)
                mark.textContent = active ? '✓' : '';
        }
    }

    /**
     * Close the recording popover when a click lands outside it (wired from the dialog's mousedown listener).
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

    /** Disable/enable the record tool during busy dialog states; disabling also closes its popover. @param {boolean} disabled @returns {void} */
    setDisabled(disabled: boolean): void {
        if (this.button)
            this.button.disabled = disabled;
        if (disabled && this.menu)
            this.menu.hidden = true;
    }

    /** Implemented by the lifecycle layer; referenced by the Start button. @returns {Promise<void>} */
    abstract start(): Promise<void>;
}
