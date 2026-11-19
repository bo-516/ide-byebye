import { DEFAULT_PINNED_AGENTS } from '../../shared/constants.js';
import { normalizePinnedAgents } from '../../shared/pinned-agents.js';
import { readJsonStore, writeJsonStore } from './dialog-prefs.js';

/**
 * Pinned destinations and the pin tip: which agents sit above "More agents" in the destination menu, and whether the
 * one-line tip under the menu was dismissed.
 *
 * Boundary: storage is best effort (missing, blocked, or hand-edited storage never throws); every read goes through
 * {@link normalizePinnedAgents}, so a hostile value can only shrink to a bounded list of ids. Ids here never add a
 * destination: the menu only shows rows the page already offers.
 */

/** localStorage key for the user's pinned ids (a JSON array). Present, even empty, means the user has chosen. */
export const PINNED_AGENTS_PREF_KEY = 'code-intent-inspector:pinned-agents';

/** localStorage key set to `true` once the user closes the pin tip. */
export const AGENT_PIN_TIP_PREF_KEY = 'code-intent-inspector:agent-pin-tip-dismissed';

/**
 * Pinned ids to use now: the browser's own choice, else the plugin config, else {@link DEFAULT_PINNED_AGENTS}.
 *
 * @param {unknown} configPinned `pinnedAgents` from the injected page config. A non-array (older server, malformed)
 *        skips to the built-in default.
 * @param {Storage} [store] Storage area; defaults to `window.localStorage`.
 * @returns {string[]} Pinned ids, possibly empty (the user or config pinned nothing).
 */
export function loadPinnedAgents(configPinned: unknown, store?: Storage): string[] {
    return normalizePinnedAgents(readJsonStore<unknown>(PINNED_AGENTS_PREF_KEY, null, store))
        ?? normalizePinnedAgents(configPinned)
        ?? [...DEFAULT_PINNED_AGENTS];
}

/**
 * Pin or unpin one destination and persist the whole list, so later loads stop falling back to config.
 *
 * Purpose: starts from {@link loadPinnedAgents} (so the first change copies the config default) and keeps ids the
 * current page does not offer — another project may offer them. Pinning appends; unpinning removes.
 *
 * @param {string} name Agent id of the row the user toggled.
 * @param {boolean} pinned True to pin, false to unpin.
 * @param {unknown} configPinned Same config value as {@link loadPinnedAgents}; needed for the first change.
 * @param {Storage} [store] Storage area; defaults to `window.localStorage`.
 * @returns {string[]} The list now stored.
 */
export function setAgentPinned(name: string, pinned: boolean, configPinned: unknown, store?: Storage): string[] {
    const current = loadPinnedAgents(configPinned, store).filter((id) => id !== name);
    const next = normalizePinnedAgents(pinned ? [...current, name] : current) ?? [];
    writeJsonStore(PINNED_AGENTS_PREF_KEY, next, store);
    return next;
}

/**
 * Whether the user has closed the pin tip.
 * @param {Storage} [store] Storage area; defaults to `window.localStorage`. @returns {boolean} True once dismissed.
 */
export function isPinTipDismissed(store?: Storage): boolean {
    return readJsonStore<unknown>(AGENT_PIN_TIP_PREF_KEY, false, store) === true;
}

/**
 * Remember that the user closed the pin tip; it stays hidden on later opens.
 * @param {Storage} [store] Storage area; defaults to `window.localStorage`. @returns {void}
 */
export function dismissPinTip(store?: Storage): void {
    writeJsonStore(AGENT_PIN_TIP_PREF_KEY, true, store);
}
