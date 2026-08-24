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
export function platformDefaultModifier(platform: string): 'meta' | 'ctrl' {
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
export function resolveClickModifier(raw: any, platform: string): string | null {
    if (raw === false || raw === null) {
        return null;
    }
    const value = String(raw ?? 'auto').toLowerCase();
    if (value === 'auto' || value === '') {
        return platformDefaultModifier(platform);
    }
    return value;
}

/**
 * Whether the configured modifier is the `'auto'` sentinel (including unset / empty).
 *
 * Purpose: `'auto'` must match both ⌘ and Ctrl at event time so Chrome device-mode UA spoofing (iPhone / Android
 * `navigator.platform`) does not lock the picker to the wrong key when the developer toggles PC ↔ mobile.
 * Boundary: `false` / `null` are an explicit opt-out and return `false` here — they disable modifier-picking entirely,
 * they are not treated as auto. Explicit `'meta'` / `'ctrl'` also return `false`.
 *
 * @param {string | false | null | undefined} raw Configured `clickModifier`.
 * @returns {boolean} True when matching should accept both Command and Ctrl.
 */
export function isAutoClickModifier(raw: any): boolean {
    if (raw === false || raw === null) {
        return false;
    }
    const value = String(raw ?? 'auto').toLowerCase();
    return value === 'auto' || value === '';
}

/**
 * Modifier token used when matching pointer / click events.
 *
 * Purpose: keep `'auto'` as a dual-match token instead of freezing ⌘ vs Ctrl from the boot-time platform string.
 * Device-mode reloads rewrite `navigator.platform` to `iPhone` / `Linux armv…`, which would otherwise turn a Mac
 * Command-click into a Ctrl-click matcher.
 * Boundary: `false` / `null` still return `null` (modifier-picking off). Explicit names pass through
 * `resolveClickModifier` so `'cmd'` stays `'cmd'` for `normalizeClickModifier` to alias.
 *
 * @param {string | false | null | undefined} raw Configured `clickModifier`.
 * @param {string} platform OS platform string, unused for `'auto'` matching but kept so callers can share the resolve
 *   signature; passing a spoofed mobile platform must not change the `'auto'` result.
 * @returns {string | null} `'auto'`, an explicit modifier name, or `null` to disable modifier-picking.
 */
export function matchingClickModifier(raw: any, platform: string): string | null {
    const resolved = resolveClickModifier(raw, platform);
    if (resolved == null) {
        return null;
    }
    if (isAutoClickModifier(raw)) {
        return 'auto';
    }
    return resolved;
}

/**
 * Normalize configured click modifier aliases to matcher tokens.
 *
 * Purpose: keeps config-friendly names like `cmd` and `ctrl` working with DOM event properties, and preserves `'auto'`
 * as a first-class dual-match token (⌘ or Ctrl).
 * Boundary: only `auto`, `alt`, `control`, `meta`, and `shift` are supported; missing or misspelled values return
 * `null`, which disables modifier-click picking rather than guessing.
 *
 * @param {string | null | undefined} modifier Raw configured or resolved modifier value.
 * @returns {'auto' | 'alt' | 'control' | 'meta' | 'shift' | null} Normalized token, or `null` when unsupported.
 */
export function normalizeClickModifier(modifier: string | null | undefined): 'auto' | 'alt' | 'control' | 'meta' | 'shift' | null {
    const value = String(modifier ?? '').toLowerCase();
    if (value === 'auto')
        return 'auto';
    if (value === 'command' || value === 'cmd')
        return 'meta';
    if (value === 'ctrl')
        return 'control';
    if (value === 'alt' || value === 'control' || value === 'meta' || value === 'shift') {
        return value;
    }
    return null;
}

/**
 * Check whether modifier flags include the configured click modifier.
 *
 * Purpose: lets the picker distinguish ordinary page clicks from inspector selection clicks, including the `'auto'`
 * dual-match used when toggling PC / mobile emulation.
 * Boundary: `modifier` is normalized through `normalizeClickModifier`; missing or unsupported values always return
 * `false`. `'auto'` is true when either `metaKey` or `ctrlKey` is set — so omitting both flags is a miss, not a match.
 * Passing a non-mouse-like object without modifier booleans also behaves as not matched.
 *
 * @param {{ altKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean }} e Mouse-like flag object.
 * @param {string | null | undefined} modifier Configured / matching modifier name.
 * @returns {boolean} Whether the flags currently satisfy the normalized modifier.
 */
export function matchesClickModifier(e, modifier: string | null | undefined): boolean {
    switch (normalizeClickModifier(modifier)) {
        case 'auto':
            return !!(e.metaKey || e.ctrlKey);
        case 'alt':
            return !!e.altKey;
        case 'control':
            return !!e.ctrlKey;
        case 'meta':
            return !!e.metaKey;
        case 'shift':
            return !!e.shiftKey;
        default:
            return false;
    }
}

/**
 * Check whether a keyboard event key is the configured click modifier.
 *
 * Purpose: used to hide the hover preview when the pick modifier is released.
 * Boundary: `'auto'` treats both Meta/OS and Control as the pick key. Unsupported modifier names return `false`;
 * passing a non-string `key` is coerced via `String` so a missing key does not throw.
 *
 * @param {string} key Keyboard event key value.
 * @param {string | null | undefined} modifier Configured / matching modifier name.
 * @returns {boolean} Whether `key` is a release key for the normalized modifier.
 */
export function isClickModifierKey(key: string, modifier: string | null | undefined): boolean {
    const normalized = normalizeClickModifier(modifier);
    const eventKey = String(key || '').toLowerCase();
    const isMeta = eventKey === 'meta' || eventKey === 'os';
    const isCtrl = eventKey === 'control';
    if (normalized === 'auto')
        return isMeta || isCtrl;
    return ((normalized === 'alt' && eventKey === 'alt') ||
        (normalized === 'control' && isCtrl) ||
        (normalized === 'meta' && isMeta) ||
        (normalized === 'shift' && eventKey === 'shift'));
}

/**
 * Empty held-modifier bitfield used to track Command/Ctrl independently of pointer events.
 *
 * Purpose: Chrome device mode synthesizes `click` / `pointerup` from touch and typically reports `metaKey`/`ctrlKey`
 * as `false` even while the physical key is down. The keyboard tracker fills that gap.
 * Boundary: all bits start false; callers must apply keydown/keyup (and reset on blur) or every pick looks unmodified.
 *
 * @returns {{ alt: boolean, ctrl: boolean, meta: boolean, shift: boolean }} Fresh all-false modifier state.
 */
export function emptyHeldModifiers() {
    return { alt: false, ctrl: false, meta: false, shift: false };
}

/**
 * Copy modifier bits off a keyboard event into the held-modifier tracker.
 *
 * Purpose: keep a source of truth that pointer/touch events can consult after device-mode drops the flags.
 * Boundary: overwrites every bit from the event; it does not OR with previous state. Missing `altKey` etc. become
 * false, so calling this with a non-keyboard object clears the tracker. Keyup of Meta/Control reports the bit as
 * false in current browsers — that is how a release is recorded.
 *
 * @param {{ alt: boolean, ctrl: boolean, meta: boolean, shift: boolean }} held Mutable tracker.
 * @param {{ altKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean }} event Keyboard-like event.
 * @returns {{ alt: boolean, ctrl: boolean, meta: boolean, shift: boolean }} The same `held` object, mutated.
 */
export function applyKeyboardModifierEvent(held, event) {
    held.alt = !!event.altKey;
    held.ctrl = !!event.ctrlKey;
    held.meta = !!event.metaKey;
    held.shift = !!event.shiftKey;
    return held;
}

/**
 * OR event flags with the keyboard tracker so touch-synthesized clicks still see a held Command/Ctrl.
 *
 * Purpose: device-mode and real touch fire `click`/`pointerup` with all modifier bits false; without the merge,
 * `matchesClickModifier` would miss a physical ⌘/Ctrl that `keydown` already recorded.
 * Boundary: a missing event or missing held object treats that side as all-false. The result is a new flag object;
 * it does not mutate `event`.
 *
 * @param {{ altKey?: boolean, ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean } | null | undefined} event
 *   Pointer/click-like event (flags often empty on touch).
 * @param {{ alt?: boolean, ctrl?: boolean, meta?: boolean, shift?: boolean } | null | undefined} held Tracker from
 *   `applyKeyboardModifierEvent`.
 * @returns {{ altKey: boolean, ctrlKey: boolean, metaKey: boolean, shiftKey: boolean }} Merged flags.
 */
export function mergeModifierFlags(event, held) {
    return {
        altKey: !!(event?.altKey || held?.alt),
        ctrlKey: !!(event?.ctrlKey || held?.ctrl),
        metaKey: !!(event?.metaKey || held?.meta),
        shiftKey: !!(event?.shiftKey || held?.shift),
    };
}
