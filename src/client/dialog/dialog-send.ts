import { agentLabel, configuredActions, sourceReferenceLabel } from './dialog-utils.js';
import { deliverPromptToClient } from './dialog-delivery.js';
import { t } from '../lib/i18n.js';
import { DialogClipboard } from './dialog-clipboard.js';
import type { AgentAvailability, ElementSelection, SendResult } from './dialog-types.js';

/**
 * Send/resolve layer of {@link Dialog}: server round-trips — primary resolve, payload build, agent
 * dispatch, and lifecycle `close`.
 *
 * Boundary: `close` lives here (below the pin layer) because both `renderResult` here and
 * `coldRestore` in the pin layer call it. Everything else is the request/response path; DOM building
 * stays in the shell layer and clipboard mechanics in the layer below.
 */
export abstract class DialogSend extends DialogClipboard {
    availability: AgentAvailability[] = [];

    /**
     * Close the dialog and tear down current intent state.
     * Boundary: this cancels hidden reference-picking mode without restoring the hidden dialog. Pending async screenshot
     * work may still settle, but its maps are cleared and no closed dialog is re-rendered. Open destination and session
     * menus are closed so their document key listeners do not outlive the dialog.
     * @returns {void}
     */
    close() {
        if (!this.backdrop)
            return;
        this.references.clear();
        this.styles.clear();
        this.sessions?.dispose();
        this.picker?.close();
        this.disableFocusGuard();
        this.setHostInteractive(false);
        this.parent.removeChild(this.backdrop);
        this.backdrop = null;
        this.dialogEl = null;
        this.editorEl = null;
        this.selectedElement = null;
        this.screenshotElement = null;
        this.anchor = null;
        this.screenshots.clear();
        document.removeEventListener('keydown', this.keyHandler, true);
        this.parent.removeEventListener('keydown', this.keyHandler, true);
        window.removeEventListener('resize', this.resizeHandler, true);
        this.discardPin();
    }
    /**
     * Build the server payload for route resolution and agent dispatch.
     *
     * Boundary: screenshot capture can reject if the originally selected element disappeared; extra code references are
     * serialized inline from the editor in cursor order, then validated server-side before prompt generation.
     *
     * @param {string} agent App agent selected by the user.
     * @returns {Promise<Record<string, unknown>>} JSON payload for the send endpoint.
     */
    async buildPayload(agent: string) {
        const { intent, references } = this.editor.serialize();
        const payload: Record<string, unknown> = {
            pageUrl: location.href,
            intent,
            agent,
            applyMode: 'agent-edit',
            resume: true,
            selection: this.selection,
        };
        if (references.length > 0)
            payload.references = references;
        const screenshots = await this.screenshots.buildPayloadScreenshots();
        if (screenshots)
            payload.screenshots = screenshots;
        const recordings = await this.recordings.buildPayloadRecordings();
        if (recordings)
            payload.recordings = recordings;
        const styles = this.styles.buildPayloadStyles({ strict: true });
        if (styles)
            payload.styles = styles;
        const targetSessionId = this.sessions?.targetIdFor(agent);
        if (targetSessionId)
            payload.targetSessionId = targetSessionId;
        return payload;
    }
    /**
     * Make another entry of a portal pick's mount chain the primary target.
     *
     * Boundary: only `inspPath` changes; the picked element, its attachments and the chain stay, so switching back
     * restores the original target. The chip shows the client label until {@link resolve} upgrades it, and a failed
     * resolve reports like any primary while the chain stays clickable. Ignored while sending.
     *
     * @param {string} inspPath Chain entry to use (`data-insp-path` form).
     * @returns {void}
     */
    switchPrimary(inspPath: string) {
        if (!this.selection || this.state === 'sending' || this.selection.inspPath === inspPath)
            return;
        this.selection = { ...this.selection, inspPath };
        this.primaryLabel = sourceReferenceLabel(this.selection, 0);
        this.editor.setPrimary({ label: this.primaryLabel, selection: this.selection });
        void this.resolve(this.selection);
    }
    /**
     * Validate the primary selected node before the user sends an intent.
     *
     * Boundary: this resolve call does not include extra references because they can be added later and are validated
     * again on send. A failed primary resolve disables app buttons to prevent an unusable prompt. A reply for a
     * selection that is no longer current (the primary was switched, or another element picked) is dropped.
     *
     * @param {ElementSelection} selection Primary browser selection.
     * @returns {Promise<void>} Resolves after validation finishes.
     */
    async resolve(selection: ElementSelection) {
        this.setState('resolving');
        try {
            const res = await this.api.resolve({
                pageUrl: location.href,
                intent: '',
                agent: configuredActions()[0].name,
                applyMode: 'agent-edit',
                resume: true,
                selection,
            });
            if (selection !== this.selection)
                return;
            if (!res.ok) {
                this.setState('failed');
                this.showError(res.error ?? t('resolve.failed'));
                for (const button of this.actionButtons.values())
                    button.disabled = true;
                return;
            }
            this.setState('idle');
            // Upgrade the pinned primary chip from the client fallback label to the server-resolved `@path #range`.
            if (typeof res.reference === 'string' && res.reference.trim()) {
                this.primaryLabel = res.reference.trim();
                this.editor.setPrimary({ label: this.primaryLabel, selection });
            }
            if (res.source?.astError) {
                console.info(`Intent inspector source extraction fell back to line context: ${res.source.astError}`);
            }
        }
        catch (err) {
            if (selection !== this.selection)
                return;
            this.setState('failed');
            this.showError(err instanceof Error ? err.message : String(err));
        }
    }

    /**
     * Resolve the project-relative `@file #range` text for a newly picked extra code reference.
     *
     * @param {ElementSelection} selection Browser selection collected by the reference picker.
     * @returns {Promise<string | undefined>} Compact source reference returned by the server.
     */
    async resolveReferenceText(selection: ElementSelection) {
        const res = await this.api.resolve({
            pageUrl: location.href,
            intent: '',
            agent: configuredActions()[0].name,
            applyMode: 'agent-edit',
            resume: true,
            selection,
        });
        if (!res.ok) {
            throw new Error(res.error ?? t('reference.resolveFailed'));
        }

        return typeof res.reference === 'string' ? res.reference : undefined;
    }

    /**
     * Load app availability and session support, and hand both to the destination picker.
     *
     * Boundary: availability is best-effort. Failed discovery keeps every destination listed as available and lets the
     * send path report the adapter-specific error if the user submits.
     *
     * @returns {Promise<void>} Resolves when availability has been applied or ignored.
     */
    async loadAgents() {
        try {
            const res = await this.api.agents();
            this.availability = res.agents;
            this.sessions?.applyAgentList(res.agents);
            this.picker?.setAvailability(res.agents);
            this.refreshDestination();
        }
        catch {
            // availability is best-effort; keep the static list.
        }
    }
    /**
     * Send the current intent to the selected app agent.
     *
     * Boundary: disabled and unavailable agents are rejected before screenshots or references are sent. Empty intent is
     * allowed so users can send source references alone. Successful validation stores the app so Enter repeats it next
     * time. While a send is in flight a second one is refused; app sends also lock the dialog's controls, Copy does not.
     *
     * @param {string} agent App agent name requested by click or Enter (`'clipboard'` for the Copy button).
     * @returns {Promise<void>} Resolves after the adapter response is rendered.
     */
    async send(agent: string) {
        if (this.state === 'resolving' || this.state === 'sending')
            return;
        if (!this.selection)
            return;
        const configured = this.config.enabledAgents.includes(agent);
        const unavailable = this.availability.find((a) => a.name === agent && !a.available);
        if (!configured) {
            this.setState('failed');
            this.showError(t('agent.notEnabled', { label: agentLabel(agent) }));
            return;
        }
        if (unavailable) {
            this.setState('failed');
            this.showError(`${t('agent.unavailable', { label: agentLabel(agent) })}\n` +
                (unavailable.reason ?? t('agent.checkSetup')));
            return;
        }
        // Only app agents drive the Enter-key default; clipboard is an auxiliary action that must not hijack it.
        if (configuredActions().some((a) => a.name === agent))
            this.rememberAgent(agent);
        // Copy leaves the dialog open, so locking every control for the round trip would dim the whole dialog and snap it
        // back a moment later — a visible jolt on each copy. App sends close the dialog on success, so they keep the lock.
        this.setState('sending', { lock: agent !== 'clipboard' });
        // Must start synchronously inside the click stack: the screenshot/send round-trip below outlives the user
        // activation that clipboard access is tied to (strictly enforced by Safari).
        const eagerCopy = agent === 'clipboard' ? this.beginEagerClipboardWrite() : null;
        try {
            const payload = await this.buildPayload(agent);
            const result = await this.api.send(payload);
            if (eagerCopy) {
                if (result.ok && typeof result.output === 'string')
                    eagerCopy.resolveText(result.output);
                else
                    eagerCopy.rejectText(new Error(result.error ?? 'No prompt returned'));
            }
            this.renderResult(result, undefined, eagerCopy?.written);
        }
        catch (err) {
            eagerCopy?.rejectText(err instanceof Error ? err : new Error(String(err)));
            this.setState('failed');
            this.showError(err instanceof Error ? err.message : String(err));
        }
    }
    /**
     * Render the send result.
     *
     * Boundary: successful app deeplink sends close the dialog. Failures stay open and surface the adapter error.
     *
     * @param {SendResult} result Agent adapter result from the server.
     * @param {string | undefined} unavailableReason Optional fallback error text.
     * @param {Promise<boolean> | undefined} eagerWritten Outcome of the gesture-time clipboard write, if one started.
     * @returns {void}
     */
    renderResult(result: SendResult, unavailableReason?: string, eagerWritten?: Promise<boolean>) {
        // Only the clipboard agent's `output` is prompt text meant for the browser to copy. App agents also return an
        // `output` status string, but they already acted server-side (deeplink) — copying that string would both spam
        // the clipboard and fail whenever the opened app steals focus from the page.
        if (result.ok && result.agent === 'clipboard' && typeof result.output === 'string') {
            void this.copyOutput(result.output, eagerWritten);
            return;
        }
        // A custom client using the `postMessage` transport is delivered from here: only the page can address the
        // window that embeds it, so the server hands back the instruction instead of sending it itself.
        if (result.ok && result.deliver) {
            this.deliverResult(result);
            return;
        }
        this.setState(result.ok ? 'completed' : 'failed');
        if (result.ok) {
            this.close();
            return;
        }
        if (this.sessions?.handleSendError(result))
            return;
        this.showError(result.error ??
            unavailableReason ??
            t('agent.failedHandle', { label: agentLabel(result.agent) }));
    }
    /**
     * Hand a custom client's prompt to the window embedding this page.
     *
     * Boundary: success here means the message left the page — the receiving client owns inserting it. A page that is
     * not embedded (or a window that refuses the post) keeps the dialog open with the reason, so the typed intent is
     * never lost to a silent no-op.
     *
     * @param {SendResult} result Successful send result carrying a `deliver` instruction. A missing instruction still
     *        throws on property access, matching the previous code; `renderResult` only calls this when one is present.
     * @returns {void}
     */
    deliverResult(result: SendResult) {
        // Non-null assertion erases. Reading `.label` still throws when `deliver` is missing.
        const deliver = result.deliver!;
        const label = deliver.label ?? agentLabel(result.agent);
        const delivered = deliverPromptToClient(deliver);
        if (delivered.ok) {
            this.setState('completed');
            this.close();
            return;
        }
        this.setState('failed');
        this.showError(delivered.reason === 'no-window'
            ? t('deliver.noWindow', { label })
            : t('deliver.failed', { label, error: delivered.error ?? '' }));
    }
}
