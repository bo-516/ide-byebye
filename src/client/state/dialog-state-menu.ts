import { el, revealDropdownPanel } from '../dialog/dialog-utils.js';
import { durationLabel } from '../recording/dialog-recording-types.js';
import { t } from '../lib/i18n.js';
import type { ComponentHandle } from './state-types.js';
import type { StateWatchSession } from './state-watch.js';

/**
 * Footer tool, popover and floating "watching" pill of the component-state controller.
 *
 * Boundary: owns the DOM only — the state tool button, its popover (attach-current-state toggle + start watching), and
 * the pill shown while the dialog is hidden for a watch. The handle, the session and the attachments live on
 * {@link DialogStateController}, which implements the abstract hooks below. The popover uses the shared
 * `cii-screenshot-menu` class so the dialog's Escape handling closes it like the other capture tools.
 */

/** Pill refresh interval while watching, in milliseconds. */
const INDICATOR_TICK_MS = 200;

/**
 * Dialog callbacks the controller uses.
 *
 * `parent()` is the shadow root the floating pill mounts into. `selectedElement()` is the element whose component is
 * read. `setDialogHidden(true)` hides the dialog and makes the host click-through so the page can be used.
 */
export interface DialogStateHost {
    parent: () => ParentNode;
    selectedElement: () => Element | null;
    setDialogHidden: (hidden: boolean) => void;
    reposition: () => void;
    showError: (text: string) => void;
}

/**
 * Menu/pill layer of the component-state controller.
 *
 * Boundary: `handle` is set by the subclass before `renderButton` runs (null means "no tool"); `session` is the running
 * watch, if any; `attachSnapshot` is the popover toggle. Fields hold DOM for the current dialog only and are dropped on
 * the next render.
 */
export abstract class StateMenuLayer {
    host: DialogStateHost;
    handle: ComponentHandle | null = null;
    session: StateWatchSession | null = null;
    attachSnapshot = false;
    button: HTMLButtonElement | null = null;
    menu: HTMLElement | null = null;
    snapshotChoice: HTMLButtonElement | null = null;
    indicator: HTMLElement | null = null;
    indicatorText: HTMLElement | null = null;
    timerId = 0;

    /**
     * @param {DialogStateHost} host Dialog callbacks. See {@link DialogStateHost}.
     */
    constructor(host: DialogStateHost) {
        this.host = host;
    }

    /** Display name of the current component, or a neutral fallback for anonymous ones. @returns {string} */
    componentName(): string {
        return this.handle?.info.name || t('state.anonymous');
    }

    /**
     * Render the state tool: an icon button whose popover toggles "attach current state" and starts a watch.
     *
     * Boundary: returns null — and the dialog omits the tool — when the selected element has no React or Vue component
     * (other frameworks, production builds). The handle is resolved by the subclass before this is called.
     * @returns {HTMLElement | null} Tool wrapper (button + popover), or null.
     */
    renderButton(): HTMLElement | null {
        if (!this.handle)
            return null;
        const wrapper = el('div', 'cii-screenshot-picker cii-state-picker');
        const button = el('button', 'cii-icon-btn cii-state-toggle');
        const menu = el('div', 'cii-screenshot-menu cii-state-menu');
        const choice = el('button', 'cii-screenshot-choice');
        const start = el('button', 'cii-state-start', t('state.watch.start'));
        this.button = button;
        this.menu = menu;
        this.snapshotChoice = choice;
        button.type = 'button';
        button.dataset.ciiTip = t('state.button.title');
        button.setAttribute('aria-label', t('state.button.title'));
        button.setAttribute('aria-haspopup', 'menu');
        button.append(el('span', 'cii-state-icon'));
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            if (menu.hidden)
                revealDropdownPanel(button, menu);
            else
                menu.hidden = true;
        });
        menu.hidden = true;
        menu.append(el('div', 'cii-menu-caption', t('state.menu.caption', { name: this.componentName() })));
        choice.type = 'button';
        choice.append(el('span', 'cii-choice-mark'), el('span', 'cii-choice-label', t('state.attach')));
        choice.addEventListener('click', (event) => {
            event.stopPropagation();
            this.setAttachSnapshot(!this.attachSnapshot);
        });
        start.type = 'button';
        start.addEventListener('click', (event) => {
            event.stopPropagation();
            menu.hidden = true;
            this.startWatch();
        });
        menu.append(choice, start);
        this.updateChoiceMark();
        wrapper.append(button, menu);
        return wrapper;
    }

    /** Reflect `attachSnapshot` on the popover row. @returns {void} */
    updateChoiceMark(): void {
        this.snapshotChoice?.classList.toggle('cii-choice-active', this.attachSnapshot);
    }

    /**
     * Close the popover when a click lands outside it (wired from the dialog's mousedown listener).
     * @param {EventTarget | null} target Event target from the dialog mousedown listener.
     * @returns {void}
     */
    closeMenuFromOutside(target: EventTarget | null): void {
        if (!this.menu || !this.button || this.menu.hidden)
            return;
        if (target instanceof Node && !this.button.contains(target) && !this.menu.contains(target))
            this.menu.hidden = true;
    }

    /** Disable/enable the tool during busy dialog states; disabling also closes its popover. @param {boolean} disabled @returns {void} */
    setDisabled(disabled: boolean): void {
        if (this.button)
            this.button.disabled = disabled;
        if (disabled && this.menu)
            this.menu.hidden = true;
    }

    /**
     * Show the floating "watching" pill (count + elapsed time + Stop) and start refreshing it.
     *
     * Boundary: mounts into the shadow root with its own `pointer-events:auto`, so it stays clickable while the host is
     * click-through. Reuses the recording pill's classes; `cii-state-indicator` recolours it. Idempotent.
     * @returns {void}
     */
    showIndicator(): void {
        const parent = this.host.parent();
        if (this.indicator || !parent)
            return;
        const indicator = el('div', 'cii-rec-indicator cii-state-indicator');
        const stop = el('button', 'cii-rec-indicator-stop', t('state.stop'));
        this.indicatorText = el('span', 'cii-rec-indicator-text');
        indicator.style.pointerEvents = 'auto';
        stop.type = 'button';
        stop.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.stopWatch();
        });
        indicator.append(el('span', 'cii-rec-indicator-dot'), this.indicatorText, stop);
        parent.append(indicator);
        this.indicator = indicator;
        this.refreshIndicator();
        this.timerId = window.setInterval(() => this.refreshIndicator(), INDICATOR_TICK_MS);
    }

    /** Update the pill's "Watching X · n changes · 3.2s" text. @returns {void} */
    refreshIndicator(): void {
        if (!this.indicatorText || !this.session)
            return;
        this.indicatorText.textContent = t('state.indicator', {
            name: this.componentName(),
            count: this.session.count(),
            time: durationLabel(this.session.elapsedMs()),
        });
    }

    /** Remove the pill and stop its refresh timer. @returns {void} */
    hideIndicator(): void {
        if (this.timerId) {
            window.clearInterval(this.timerId);
            this.timerId = 0;
        }
        this.indicator?.remove();
        this.indicator = null;
        this.indicatorText = null;
    }

    /** Implemented by the lifecycle layer: toggle the current-state attachment. @param {boolean} on @returns {void} */
    abstract setAttachSnapshot(on: boolean): void;
    /** Implemented by the lifecycle layer: begin a watch. @returns {void} */
    abstract startWatch(): void;
    /** Implemented by the lifecycle layer: end the watch and keep its result. @returns {void} */
    abstract stopWatch(): void;
}
