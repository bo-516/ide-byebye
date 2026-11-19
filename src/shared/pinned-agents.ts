/**
 * Normalization for the "pinned" destination list, shared by the server (plugin option `pinnedAgents`) and the client
 * (the same list read back from `localStorage`).
 *
 * Boundary: environment-neutral (no DOM, no `node:*`). Both sources are untrusted in shape — config can be any value
 * and storage can be hand-edited — so this only ever returns a bounded list of short, distinct strings.
 */

/** Most ids kept from one list. The catalog has under 20 built-ins; the cap only bounds hostile input. */
export const PINNED_AGENTS_MAX = 64;

/** Longest id kept. Built-in and `agents.custom` names are far shorter; longer strings are dropped, not truncated. */
export const PINNED_AGENT_ID_MAX = 64;

/**
 * Normalize a pinned-destination list.
 *
 * Purpose: keep non-empty string ids, trimmed, without duplicates, in input order, capped at {@link PINNED_AGENTS_MAX}.
 * An explicit empty array stays empty (the user pinned nothing), which is distinct from "no list".
 *
 * @param {unknown} value Raw list (config option or parsed storage). Anything but an array means "no list".
 * @returns {string[] | null} Normalized ids, or null when `value` is not an array so the caller can fall back.
 */
export function normalizePinnedAgents(value: unknown): string[] | null {
    if (!Array.isArray(value))
        return null;
    const ids: string[] = [];
    for (const item of value) {
        if (typeof item !== 'string')
            continue;
        const id = item.trim();
        if (id && id.length <= PINNED_AGENT_ID_MAX && !ids.includes(id))
            ids.push(id);
        if (ids.length >= PINNED_AGENTS_MAX)
            break;
    }
    return ids;
}
