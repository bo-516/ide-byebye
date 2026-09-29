export function parseHotkey(input: string): {
    alt: boolean;
    shift: boolean;
    ctrl: boolean;
    meta: boolean;
    key: string;
    code?: string;
} {
    const hk: {
        alt: boolean;
        shift: boolean;
        ctrl: boolean;
        meta: boolean;
        key: string;
        code?: string;
    } = { alt: false, shift: false, ctrl: false, meta: false, key: '' };
    for (const raw of input.split('+')) {
        const part = raw.trim().toLowerCase();
        if (!part)
            continue;
        if (part === 'alt' || part === 'option' || part === 'opt')
            hk.alt = true;
        else if (part === 'shift')
            hk.shift = true;
        else if (part === 'ctrl' || part === 'control')
            hk.ctrl = true;
        else if (part === 'meta' || part === 'cmd' || part === 'command' || part === 'mod')
            hk.meta = true;
        else
            hk.key = part;
    }
    if (/^[a-z]$/.test(hk.key))
        hk.code = 'Key' + hk.key.toUpperCase();
    else if (/^[0-9]$/.test(hk.key))
        hk.code = 'Digit' + hk.key;
    return hk;
}
/**
 * Whether a keydown matches a parsed hotkey.
 *
 * Boundary: every modifier bit must agree, including bits the hotkey left off. When `hk.code` is set it wins over
 * `key`, so a layout-shifted character still matches the physical key. Passing a non-keyboard event reads empty
 * `code` / `key` and misses.
 *
 * @param {KeyboardEvent} e Keydown (or keyup) to test.
 * @param {ReturnType<typeof parseHotkey>} hk Result of {@link parseHotkey}. An empty `key` matches only an empty event key.
 * @returns {boolean} True when the modifiers and the key or code agree.
 */
export function matchHotkey(e: KeyboardEvent, hk: ReturnType<typeof parseHotkey>): boolean {
    if (e.altKey !== hk.alt)
        return false;
    if (e.shiftKey !== hk.shift)
        return false;
    if (e.ctrlKey !== hk.ctrl)
        return false;
    if (e.metaKey !== hk.meta)
        return false;
    if (hk.code)
        return e.code === hk.code;
    return e.key.toLowerCase() === hk.key;
}
