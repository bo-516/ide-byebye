import { el, isAgentVisible } from './dialog-utils.js';
import { t } from '../lib/i18n.js';
import { iconSvg } from '../lib/icons.js';
import { DialogPins } from './dialog-pins.js';
import type { ElementSelection } from './dialog-types.js';

/**
 * Shell layer of {@link Dialog}: DOM rendering for the open dialog and the Escape/Enter key handling
 * that operates on it.
 *
 * Boundary: topmost internal layer — only the exported `Dialog` subclass sits above it. DOM created
 * here is owned by `this.backdrop`/`this.dialogEl`; controllers own their own buttons and menus.
 */
export abstract class DialogShell extends DialogPins {
    /**
     * Render the dialog shell for the current intent.
     * Boundary: this method creates fresh DOM for one open dialog. State that must survive re-rendering should live on
     * the class fields; passing a stale selection only affects async resolve and send payloads outside this renderer.
     * Layout: header controls (pin, close) sit in the panel's top-right corner; the `.cii-footer` action bar holds the
     * capture tools on the left and, on the right, Copy, the destination picker, and the one Send button. The
     * destination is a setting (it rarely changes), so it is a compact picker rather than a button per agent; Send and
     * Enter both go to it. The session menu observes `.cii-footer` for placement, so the class must stay. Agents
     * turned off in plugin config are never offered (including `clipboard`, which backs Copy); with no destination at
     * all, the picker and Send hide and Copy becomes the primary action.
     * @param {ElementSelection | null} _selection Current primary selection, intentionally unused by static layout.
     * @returns {void}
     */
    render(_selection: ElementSelection | null) {
        const backdrop = el('div', 'cii-backdrop');
        backdrop.addEventListener('mousedown', (e: MouseEvent) => {
            if (e.target === backdrop)
                this.close();
        });
        const dialog = el('div', 'cii-dialog');
        // --- header: pin + close sit in the top-right corner, away from the hand-off keys ---
        const header = el('div', 'cii-header');
        const pinBtn = el('button', 'cii-pin-btn');
        pinBtn.type = 'button';
        pinBtn.dataset.ciiTip = t('dialog.pin.title');
        pinBtn.setAttribute('aria-label', t('dialog.pin.aria'));
        pinBtn.innerHTML = iconSvg('pin', 16);
        pinBtn.addEventListener('click', () => this.pinDialog());
        const closeBtn = el('button', 'cii-close-btn');
        closeBtn.type = 'button';
        closeBtn.dataset.ciiTip = t('dialog.close.title');
        closeBtn.setAttribute('aria-label', t('dialog.close.aria'));
        closeBtn.innerHTML = iconSvg('x', 16);
        closeBtn.addEventListener('click', () => this.close());
        header.append(pinBtn, closeBtn);
        dialog.append(header);
        const body = el('div', 'cii-body');
        const intentField = this.editor.render();
        // The editor closes over `let editorEl = null`, so strict inference types the getter as returning `null`
        // even though `render()` just created the node. The cast matches that post-render element.
        const editorNode = this.editor.getEditorElement() as HTMLElement;
        this.editorEl = editorNode;
        editorNode.addEventListener('keydown', (event: KeyboardEvent) => {
            if (this.closeFromEscape(event))
                return;
            if (this.shouldSubmitIntent(event)) {
                event.preventDefault();
                void this.send(this.lastAgent);
            }
        });
        body.append(intentField);
        const screenshotPreviewEl = el('div', 'cii-screenshot-preview');
        this.screenshots.attachPreview(screenshotPreviewEl);
        body.append(screenshotPreviewEl);
        const recordingPreviewEl = el('div', 'cii-screenshot-preview cii-recording-preview');
        this.recordings.attachPreview(recordingPreviewEl);
        body.append(recordingPreviewEl);
        const stylePreviewEl = el('div', 'cii-screenshot-preview cii-style-preview');
        this.styles.attachPreview(stylePreviewEl);
        body.append(stylePreviewEl);
        dialog.append(body);
        // --- action bar: capture tools on the left; Copy, the destination picker, and Send on the right ---
        const footer = el('div', 'cii-footer');
        const tools = el('div', 'cii-footer-tools');
        tools.append(this.references.renderButton());
        tools.append(this.screenshots.renderPicker());
        tools.append(this.styles.renderButton());
        const recordButton = this.recordings.renderButton();
        if (recordButton)
            tools.append(recordButton);
        const actions = el('div', 'cii-send-group');
        this.actionButtons = new Map();
        // Clipboard is a first-class action: it copies the assembled prompt so the user can paste it into any AI, with
        // no app/deeplink dependency. It is deliberately kept out of `configuredActions()` so the Enter key still
        // targets an app agent rather than the clipboard — which also keeps it out of `visibleAgentActions()`, so
        // `agents.clipboard: false` has to be honored here, or the button could only ever alert "not enabled".
        if (isAgentVisible(this.config, 'clipboard')) {
            const clipboardButton = el('button', 'cii-icon-btn cii-agent-clipboard');
            // Both labels exist up front, stacked in one grid cell, so the confirmation (see `flashCopied`) only swaps
            // visibility and never resizes the bar; the visible icon comes from CSS and the live label names the state.
            clipboardButton.append(el('span', 'cii-copy-label cii-copy-idle', t('agent.clipboard.label')), el('span', 'cii-copy-label cii-copy-done', t('clipboard.copied')));
            clipboardButton.dataset.ciiTip = t('agent.clipboard.label');
            clipboardButton.addEventListener('click', () => void this.send('clipboard'));
            this.actionButtons.set('clipboard', clipboardButton);
            actions.append(clipboardButton);
        }
        this.sessions.attach(dialog);
        actions.append(this.picker.render());
        const sendButton = el('button', 'cii-send-btn');
        sendButton.type = 'button';
        sendButton.innerHTML = iconSvg('arrow-up', 18);
        sendButton.addEventListener('click', () => void this.send(this.lastAgent));
        this.actionButtons.set('send', sendButton);
        actions.append(sendButton);
        footer.append(tools, actions);
        dialog.append(footer);
        this.refreshDestination();
        dialog.addEventListener('mousedown', (event: MouseEvent) => {
            const target = event.target;
            this.screenshots.closeMenuFromOutside(target);
            this.recordings.closeMenuFromOutside(target);
            this.styles.closeMenuFromOutside(target);
            this.sessions.closeMenuFromOutside(target);
            this.picker.closeMenuFromOutside(target);
        }, true);
        backdrop.append(dialog);
        this.parent.append(backdrop);
        this.backdrop = backdrop;
        this.dialogEl = dialog;
        this.setHostInteractive(true);
        // Reflect any persisted style selection in the body preview before measuring: rendered after `positionDialog`,
        // the chip grew the panel past the height it was clamped with and pushed its bottom edge off-screen.
        this.styles.updatePreview();
        this.positionDialog(dialog, this.anchor);
        document.addEventListener('keydown', this.keyHandler, true);
        this.parent.addEventListener('keydown', this.keyHandler, true);
        window.addEventListener('resize', this.resizeHandler, true);
    }

    /**
     * Decide whether an Enter press in the intent editor should submit to the remembered app.
     *
     * Boundary: IME composition and modified Enter presses are ignored so Chinese candidate selection and
     * Shift+Enter line breaks keep working. Callers must still validate intent text before sending.
     *
     * @param {KeyboardEvent} event Editor keydown event.
     * @returns {boolean} True when this key should submit the dialog.
     */
    shouldSubmitIntent(event: KeyboardEvent) {
        return (event.key === 'Enter' &&
            this.state !== 'resolving' &&
            this.state !== 'sending' &&
            !event.isComposing &&
            !event.shiftKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey);
    }

    /**
     * Handle Escape before page handlers can consume the key: close the innermost open menu, else the dialog.
     *
     * Boundary: layered, like any popover UI — the session menu, then the destination menu, then a capture tool's
     * dropdown each take one Escape (focus returns to the editor) before the next Escape closes the dialog. Reference
     * picking owns Escape itself, so it is left alone.
     *
     * @param {KeyboardEvent} event Keydown event from the page, shadow root, or textarea.
     * @returns {boolean} True when Escape closed a menu or the dialog.
     */
    closeFromEscape(event: KeyboardEvent) {
        if (event.key !== 'Escape')
            return false;
        if (this.references?.isPicking())
            return false;
        if (this.sessions?.consumeEscape() || this.picker?.consumeEscape() || this.closeToolMenus()) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            this.restoreIntentFocus();
            return true;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.close();
        return true;
    }

    /**
     * Hide any open capture-tool dropdown (screenshot, style, recording).
     *
     * Boundary: those controllers read their menu's `hidden` flag as their open state, so hiding it is a full close.
     * A closed dialog has nothing to hide.
     *
     * @returns {boolean} True when at least one dropdown was open.
     */
    closeToolMenus() {
        const open = this.dialogEl ? Array.from(this.dialogEl.querySelectorAll('.cii-footer-tools .cii-screenshot-menu:not([hidden])')) : [];
        for (const menu of open)
            (menu as HTMLElement).hidden = true;
        return open.length > 0;
    }
}
