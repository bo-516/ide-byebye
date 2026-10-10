import { t } from '../lib/i18n.js';
import { DialogLayout } from './dialog-layout.js';
import type { EagerClipboardWrite } from './dialog-types.js';

/**
 * Clipboard layer of {@link Dialog}: OS clipboard writes and the Copy-button confirmation flash.
 *
 * Boundary: knows nothing about agents or sessions beyond `setState`/`showError` from the layout
 * layer. `send` (next layer up) drives {@link copyOutput}; this file only owns the write mechanics
 * and never closes the dialog.
 */
export abstract class DialogClipboard extends DialogLayout {
    copyResetTimer: ReturnType<typeof setTimeout> | undefined;

    /**
     * Start an OS clipboard write while the click's user activation is still alive, deferring the actual text.
     *
     * Boundary: must be called synchronously inside the user gesture. Browsers without promise-valued
     * `ClipboardItem` support return null so the caller falls back to the post-response copy path. The returned
     * `written` promise never rejects; the deferred text must be resolved or rejected exactly once, otherwise the
     * pending write is left to the browser's own gesture timeout.
     *
     * @returns {EagerClipboardWrite | null} Deferred write handle. Null when the browser cannot defer a clipboard write.
     */
    beginEagerClipboardWrite(): EagerClipboardWrite | null {
        if (!navigator.clipboard?.write || typeof ClipboardItem !== 'function')
            return null;
        // The executor runs synchronously, so both are assigned before this function reads them. The assertion
        // tells strict null checks that; a browser that throws before the executor would already have thrown above.
        let resolveText!: (value: string) => void;
        let rejectText!: (reason: Error) => void;
        const text = new Promise<string>((resolve, reject) => {
            resolveText = resolve;
            rejectText = reject;
        });
        try {
            const item = new ClipboardItem({
                'text/plain': text.then((value) => new Blob([value], { type: 'text/plain' })),
            });
            const written = navigator.clipboard.write([item]).then(() => true, () => false);
            return { resolveText, rejectText, written };
        }
        catch {
            // ClipboardItem exists but rejects promise-valued entries — settle the deferred so it cannot dangle.
            resolveText('');
            return null;
        }
    }
    /**
     * Copy a clipboard agent's prompt into the OS clipboard and flash success on the Copy button.
     *
     * Boundary: `navigator.clipboard.writeText` runs after the async send, so a browser that requires a fresh user
     * gesture (or a non-secure context) may reject it; that path surfaces a manual-copy hint instead of failing
     * silently. The dialog stays open so the user can read the feedback and still hand off to an app afterwards.
     *
     * @param {string} text Assembled prompt returned by the clipboard adapter.
     * @param {Promise<boolean> | undefined} eagerWritten Outcome of the gesture-time clipboard write, if one started.
     * @returns {Promise<void>} Resolves after the copy attempt and its feedback are applied.
     */
    async copyOutput(text: string, eagerWritten?: Promise<boolean>) {
        // The gesture-time write is the reliable path; retry with the direct APIs only when it failed or never started.
        if ((eagerWritten && (await eagerWritten)) || (await this.writeClipboard(text))) {
            this.flashCopied();
            return;
        }
        // Automatic copy was rejected — most often because the click's user activation lapsed during the
        // screenshot/send round-trip, or another surface (e.g. DevTools) holds focus so the page can't reach the
        // clipboard at all. Surface the assembled prompt in a native prompt, pre-selected, so "copy manually" is
        // actionable instead of a dead-end alert. The dialog returns to idle so the user can still hand off to an app.
        this.setState('idle');
        if (typeof window.prompt === 'function')
            window.prompt(t('clipboard.copyFailed'), text);
        else
            this.showError(t('clipboard.copyFailed'));
    }
    /**
     * Place text on the OS clipboard, preferring the async Clipboard API and falling back to the legacy execCommand
     * path when it is unavailable or rejected.
     *
     * Boundary: `navigator.clipboard.writeText` requires a secure context and a focused document; when either is
     * missing it rejects, so the synchronous execCommand path gets a second chance before the caller surfaces a
     * manual-copy affordance.
     *
     * @param {string} text Prompt text to copy.
     * @returns {Promise<boolean>} True if either path reported success.
     */
    async writeClipboard(text: string) {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        }
        catch {
            // Async path blocked (insecure context, unfocused document, or lapsed activation) — try execCommand.
        }
        return this.execCommandCopy(text);
    }
    /**
     * Legacy clipboard copy via a detached textarea and `document.execCommand('copy')`.
     *
     * Boundary: appended to the light DOM (not the plugin shadow root) because execCommand copies the document
     * selection, which is most reliable outside a shadow boundary. The node is removed synchronously afterwards.
     *
     * @param {string} text Prompt text to copy.
     * @returns {boolean} True if the command reported success.
     */
    execCommandCopy(text: string) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.top = '0';
            ta.style.left = '0';
            ta.style.width = '1px';
            ta.style.height = '1px';
            ta.style.opacity = '0';
            document.body.append(ta);
            ta.select();
            ta.setSelectionRange(0, text.length);
            let ok = false;
            try {
                ok = document.execCommand('copy');
            }
            catch {
                ok = false;
            }
            ta.remove();
            return ok;
        }
        catch {
            return false;
        }
    }
    /**
     * Flash the Copy button into its "copied" confirmation state and reset it after a short delay.
     *
     * Boundary: only toggles `cii-agent-copied`, which swaps which of the button's two pre-rendered labels is visible.
     * Rewriting the button text instead would resize it and re-wrap the footer's action row mid-flash. A repeat copy
     * inside the window restarts the delay; with no Copy button rendered (`agents.clipboard: false`) only the state resets.
     *
     * @returns {void}
     */
    flashCopied() {
        this.setState('idle');
        const button = this.actionButtons.get('clipboard');
        if (!button)
            return;
        if (this.copyResetTimer)
            clearTimeout(this.copyResetTimer);
        button.classList.add('cii-agent-copied');
        this.copyResetTimer = setTimeout(() => button.classList.remove('cii-agent-copied'), 1800);
    }
}
