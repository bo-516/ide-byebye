/**
 * Map an OS platform string to the default click modifier.
 *
 * Purpose: ⌘-click on macOS, Ctrl-click everywhere else, so the pick gesture matches each platform's native "secondary
 * intent" convention instead of forcing one key on all users.
 * Boundary: pure and side-effect free. `platform` is any UA platform string (`navigator.userAgentData.platform` or the
 * legacy `navigator.platform`); an empty / non-mac string yields `'ctrl'`. Returns DOM-friendly names (`'meta'`/`'ctrl'`)
 * that `normalizeClickModifier` already understands.
 *
 * @param {string} platform OS platform string.
 * @returns {'meta' | 'ctrl'} Default modifier for that platform.
 */
export function platformDefaultModifier(platform) {
    return /mac/i.test(String(platform || '')) ? 'meta' : 'ctrl';
}

/**
 * Resolve the configured click modifier, expanding the `'auto'` sentinel to a platform default.
 *
 * Purpose: the server ships one platform-neutral default (`'auto'`) and the browser — which actually knows the OS —
 * picks ⌘ vs Ctrl. This is what makes ⌘/Ctrl-click work with zero config while still honoring an explicit override.
 * Boundary: pure. `false` / `null` are an explicit opt-out and return `null` (click-picking stays off). `'auto'`, `''`,
 * or `undefined` resolve via `platform`. Any other value is lowercased and returned as-is for `normalizeClickModifier`
 * to alias (`'cmd'`→meta, `'ctrl'`→control, …) — so passing a bad name here disables picking later, it does not throw.
 *
 * @param {string | false | null | undefined} raw Configured `clickModifier` from the injected client config.
 * @param {string} platform OS platform string, used only for the `'auto'` case.
 * @returns {string | null} Resolved modifier name, or `null` to disable click-picking.
 */
export function resolveClickModifier(raw, platform) {
    if (raw === false || raw === null) {
        return null;
    }
    const value = String(raw ?? 'auto').toLowerCase();
    if (value === 'auto' || value === '') {
        return platformDefaultModifier(platform);
    }
    return value;
}
