import { readJsonStore, writeJsonStore } from './dialog-prefs.js';
import { el } from './dialog-utils.js';
import { t } from '../lib/i18n.js';

/**
 * Storage key for destination notices the user closed for good ("Don't show again"): a JSON array of notice ids.
 *
 * Boundary: per browser, like the other dialog preferences. One key for every notice, so a later notice for another
 * agent needs no new key; ids that no longer exist in {@link AGENT_NOTICES} are harmless and stay stored.
 * @type {string}
 */
export const AGENT_NOTICE_DISMISSED_PREF_KEY = 'code-intent-inspector:agent-notices-dismissed';

/**
 * Destinations that need a heads-up when they become the Enter target, keyed by agent id, valued by notice id.
 *
 * Purpose: the notice id names the copy (`agent.notice.<id>.title` / `.text` in `i18n-agents.ts`) and is what
 * "Don't show again" stores. `workbuddy-app`: WorkBuddy 5.11+ only keeps the deeplink's project folder when an existing
 * WorkBuddy group already points at it, and the link cannot create or pick a group, so first-time users must create
 * one by hand or the task runs in a scratch folder.
 * @type {Readonly<Record<string, string>>}
 */
export const AGENT_NOTICES: Readonly<Record<string, string>> = { 'workbuddy-app': 'workbuddyGroup' };

/**
 * Show-state of the notice for one dialog: which destination it was last armed for, and whether the user closed it
 * once for that arming.
 */
export interface AgentNoticeState {
    agent: string | null;
    closedOnce: boolean;
}

/** Facts {@link visibleAgentNotice} needs besides the state. */
interface AgentNoticeContext {
    unavailable: boolean;
    dismissed: readonly string[];
}

/**
 * Notice id for a destination, or null when it has none.
 *
 * @param {string | null} agent Agent id of the current Enter target; null or unknown ids have no notice.
 * @returns {string | null} Notice id from {@link AGENT_NOTICES}.
 */
export function agentNoticeId(agent: string | null): string | null {
    if (!agent || !Object.prototype.hasOwnProperty.call(AGENT_NOTICES, agent))
        return null;
    return AGENT_NOTICES[agent];
}

/**
 * Notice ids the user closed for good.
 *
 * Boundary: malformed or blocked storage reads as "none dismissed", so the notice shows rather than silently vanishing.
 *
 * @param {Storage} [store] Storage area; defaults to `window.localStorage`.
 * @returns {string[]} Stored ids (strings only).
 */
export function loadDismissedAgentNotices(store?: Storage): string[] {
    const value = readJsonStore<unknown>(AGENT_NOTICE_DISMISSED_PREF_KEY, null, store);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * Remember that the user closed a notice for good; failures are swallowed (it then shows again next time).
 *
 * @param {string} id Notice id from {@link AGENT_NOTICES}.
 * @param {Storage} [store] Storage area; defaults to `window.localStorage`.
 * @returns {void}
 */
export function dismissAgentNoticeForever(id: string, store?: Storage): void {
    const ids = loadDismissedAgentNotices(store);
    if (!ids.includes(id))
        writeJsonStore(AGENT_NOTICE_DISMISSED_PREF_KEY, [...ids, id], store);
}

/**
 * Next state after the Enter target is (re)read: a different destination re-arms the notice, the same one keeps it.
 *
 * Boundary: "closed once" lasts until the destination changes, the user picks the destination again (the picker
 * re-arms first), or a new dialog opens; repaints of the same target (availability, sessions) never bring it back.
 *
 * @param {AgentNoticeState} state Current state.
 * @param {string | null} agent Current Enter target; null when the page offers no destination.
 * @returns {AgentNoticeState} Same object when nothing changed.
 */
export function nextAgentNoticeState(state: AgentNoticeState, agent: string | null): AgentNoticeState {
    return state.agent === agent ? state : { agent, closedOnce: false };
}

/**
 * Notice id to show now, or null.
 *
 * Boundary: hidden for an unavailable destination (sending there fails anyway, so the advice is noise), after
 * "Dismiss" for this arming, and after "Don't show again".
 *
 * @param {AgentNoticeState} state Current state.
 * @param {AgentNoticeContext} context `unavailable` of the current row and the ids closed for good.
 * @returns {string | null} Notice id to render.
 */
export function visibleAgentNotice(state: AgentNoticeState, context: AgentNoticeContext): string | null {
    const id = agentNoticeId(state.agent);
    if (!id || state.closedOnce || context.unavailable || context.dismissed.includes(id))
        return null;
    return id;
}

/**
 * Keep the editor focused when a notice button is pressed (the click still fires).
 * @param {Event} event `mousedown` on a notice button. @returns {void}
 */
function keepFocus(event: Event): void {
    event.preventDefault();
}

/**
 * Sticky warning card that appears when a destination with a caveat becomes the Enter target.
 *
 * Purpose: it never times out; the user closes it with "Dismiss" (this arming only) or "Don't show again"
 * (persisted per browser). It sits in the dialog's flow between the body and the action bar, so it covers neither the
 * editor nor the destination menu, and it moves and closes with the dialog.
 *
 * Boundary: owned by the destination picker, which calls {@link sync} on every repaint and {@link rearm} when a row is
 * chosen; the dialog calls {@link rearm} on each new open. `onLayout` runs after the card shows or hides on a mounted
 * dialog so the panel can stay inside the viewport. Methods before the first {@link render} only update state.
 */
export class DialogAgentNotice {
    onLayout: () => void;
    store: Storage | undefined;
    state: AgentNoticeState = { agent: null, closedOnce: false };
    unavailable = false;
    root: HTMLElement | null = null;
    title: HTMLElement | null = null;
    text: HTMLElement | null = null;

    /**
     * @param {() => void} onLayout Runs after the card's visibility changes on a rendered dialog.
     * @param {Storage} [store] Storage area for "Don't show again"; defaults to `window.localStorage`.
     */
    constructor(onLayout: () => void, store?: Storage) {
        this.onLayout = onLayout;
        this.store = store;
    }

    /**
     * Build a fresh, hidden card for a newly rendered dialog; the next {@link sync} paints it. Keeps the state, so a
     * re-render of the same dialog (pin restore) does not bring back a dismissed card.
     * @returns {HTMLElement} Card element, not yet attached.
     */
    render(): HTMLElement {
        const root = el('div', 'cii-agent-notice');
        root.setAttribute('role', 'status');
        root.hidden = true;
        const body = el('div', 'cii-agent-notice-body');
        this.title = el('strong', 'cii-agent-notice-title');
        this.text = el('span', 'cii-agent-notice-text');
        const actions = el('div', 'cii-agent-notice-actions');
        actions.append(
            this.button(t('agent.notice.dismissOnce'), 'cii-agent-notice-btn', () => this.dismissOnce()),
            this.button(t('agent.notice.dismissForever'), 'cii-agent-notice-btn cii-agent-notice-btn-strong', () => this.dismissForever()),
        );
        body.append(this.title, this.text, actions);
        root.append(el('span', 'cii-agent-notice-icon'), body);
        this.root = root;
        return root;
    }

    /**
     * Apply the current Enter target: re-arm on a new destination, then show or hide the card.
     * @param {string | null} agent Current Enter target row id; null when none is offered.
     * @param {boolean} unavailable Whether that row is unavailable. @returns {void}
     */
    sync(agent: string | null, unavailable: boolean): void {
        this.state = nextAgentNoticeState(this.state, agent);
        this.unavailable = unavailable;
        this.paint();
    }

    /** Forget the armed destination so the next {@link sync} shows its notice again. @returns {void} */
    rearm(): void {
        this.state = { agent: null, closedOnce: false };
    }

    /** "Dismiss": hide until the destination changes, is picked again, or a new dialog opens. @returns {void} */
    dismissOnce(): void {
        this.state = { ...this.state, closedOnce: true };
        this.paint();
    }

    /** "Don't show again": persist the notice id and hide. @returns {void} */
    dismissForever(): void {
        const id = agentNoticeId(this.state.agent);
        if (id)
            dismissAgentNoticeForever(id, this.store);
        this.paint();
    }

    /**
     * Fill and show the card for the visible notice, or hide it; reports a visibility change through `onLayout` only
     * while the card is attached (during render the dialog measures itself afterwards).
     * @returns {void}
     */
    paint(): void {
        if (!this.root)
            return;
        const id = visibleAgentNotice(this.state, {
            unavailable: this.unavailable,
            dismissed: loadDismissedAgentNotices(this.store),
        });
        const wasHidden = this.root.hidden;
        if (id) {
            (this.title as HTMLElement).textContent = t(`agent.notice.${id}.title`);
            (this.text as HTMLElement).textContent = t(`agent.notice.${id}.text`);
        }
        this.root.hidden = id == null;
        if (this.root.hidden !== wasHidden && this.root.isConnected)
            this.onLayout();
    }

    /**
     * One notice action button that leaves the editor focus alone.
     * @param {string} label Visible text. @param {string} className Classes. @param {() => void} onClick Action.
     * @returns {HTMLButtonElement} Button, not yet attached.
     */
    button(label: string, className: string, onClick: () => void): HTMLButtonElement {
        const button = el('button', className, label);
        button.type = 'button';
        button.addEventListener('mousedown', keepFocus);
        button.addEventListener('click', onClick);
        return button;
    }
}
