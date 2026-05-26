export function parseHotkey(input) {
    const hk = { alt: false, shift: false, ctrl: false, meta: false, key: '' };
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
export function matchHotkey(e, hk) {
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
