/**
 * Element table of a stamped module: one entry per `data-insp-path` value.
 *
 * Purpose: parity compares this table, not source bytes. A static stamp is a string attribute or
 * object value. A propagated stamp is an expression whose fallback is the string after `||`.
 * The destructure binding `"data-insp-path": __ideByebyePath` is not an element and is ignored.
 *
 * Boundary: string scan only. The key is `line:column:tag` taken from the end of the path value,
 * so Windows drive letters and extra colons in the directory stay in the value and out of the key.
 */

export interface StampEntry {
    kind: 'static' | 'propagated';
    /** Full `path:line:column:tag` fallback (the element's own location). */
    value: string;
}

/**
 * Collect stamps from source that already went through a stamper.
 *
 * @param {string} code Stamped source.
 * @returns {Map<string, StampEntry>} Keyed by `line:column:tag`. Later duplicates overwrite.
 */
export function elementTable(code: string): Map<string, StampEntry> {
    const table = new Map<string, StampEntry>();
    const marker = 'data-insp-path';
    let from = 0;
    while (from < code.length) {
        const index = code.indexOf(marker, from);
        if (index === -1)
            break;
        from = index + marker.length;
        const entry = readStamp(code.slice(index + marker.length));
        if (!entry)
            continue;
        const key = entry.value.match(/:(\d+):(\d+):([^:]+)$/);
        if (!key)
            continue;
        table.set(`${key[1]}:${key[2]}:${key[3]}`, entry);
    }
    return table;
}

/**
 * @param {string} after Text immediately after `data-insp-path`.
 * @returns {StampEntry | null} Null when this occurrence is the injected binding, not an element.
 */
function readStamp(after: string): StampEntry | null {
    if (after.startsWith('="') || after.startsWith("='"))
        return staticString(after.slice(2), after[1]);
    if (after.startsWith('={'))
        return expressionStamp(after.slice(2));
    const keyed = after.match(/^['"]?\s*:\s*([\s\S]*)/);
    if (!keyed)
        return null;
    const rest = keyed[1];
    if (rest.startsWith('"') || rest.startsWith("'"))
        return staticString(rest.slice(1), rest[0]);
    return expressionStamp(rest);
}

function staticString(text: string, quote: string): StampEntry | null {
    const end = text.indexOf(quote);
    if (end === -1)
        return null;
    const value = text.slice(0, end);
    return isPath(value) ? { kind: 'static', value } : null;
}

function expressionStamp(text: string): StampEntry | null {
    // The first `||` is the fallback operator we emit. A later one belongs to another element.
    const or = text.indexOf('||');
    const literal = (or === -1 ? text : text.slice(or + 2)).trim();
    if (!literal.startsWith('"') && !literal.startsWith("'"))
        return null;
    const value = literal.slice(1, literal.indexOf(literal[0], 1));
    if (!isPath(value))
        return null;
    return { kind: or === -1 ? 'static' : 'propagated', value };
}

function isPath(value: string): boolean {
    return /:\d+:\d+:[^:]+$/.test(value);
}
