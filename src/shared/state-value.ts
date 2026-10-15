/**
 * Bounded, JSON-safe views of live component values and a structural diff between two such views.
 *
 * Purpose: component props/state can hold anything (functions, DOM nodes, React elements, cycles, huge arrays). The
 * browser turns them into a small JSON tree with {@link snapshotValue} before they leave the page, the watcher compares
 * two trees with {@link diffValues}, and the server re-bounds the same shape. Living in `shared/` keeps the markers
 * identical on both sides.
 * Boundary: pure — no DOM types, no globals. DOM nodes are recognized structurally (`nodeType` + `nodeName`). Every
 * cap below is a hard limit: deeper/larger input is replaced by a marker string, never thrown on.
 */

/** Deepest nesting kept; anything below becomes `[Object]` / `[Array(n)]`. */
export const STATE_MAX_DEPTH = 4;
/** Most keys kept per object; the rest are summarized under {@link STATE_MORE_KEY}. */
export const STATE_MAX_KEYS = 30;
/** Most items kept per array; the rest are summarized as a trailing `…+n` string. */
export const STATE_MAX_ITEMS = 30;
/** Longest string kept, in UTF-16 units; longer strings end in `…`. */
export const STATE_MAX_STRING = 200;
/** Key that carries the number of object keys dropped by {@link STATE_MAX_KEYS}. */
export const STATE_MORE_KEY = '…';
/** Most leaf changes one {@link diffValues} call reports, so replacing a large array cannot flood the change log. */
export const STATE_MAX_DIFF_CHANGES = 20;

/** A JSON-safe value as produced by {@link snapshotValue}. */
export type StateValue = null | boolean | number | string | StateValue[] | { [key: string]: StateValue };

/** One leaf difference between two snapshots: dotted/bracketed `path`, old and new value. */
export interface StateChange {
    path: string;
    from: StateValue;
    to: StateValue;
}

/**
 * Display name of a function, React element type, or component constructor.
 *
 * @param {unknown} value Function or element `type`. Anything else yields `''`.
 * @returns {string} The `displayName`/`name`, or `''` when there is none.
 */
function displayNameOf(value: unknown): string {
    if (typeof value === 'string')
        return value;
    if (!value || (typeof value !== 'function' && typeof value !== 'object'))
        return '';
    const record = value as { displayName?: unknown; name?: unknown; render?: unknown; type?: unknown };
    if (typeof record.displayName === 'string' && record.displayName)
        return record.displayName;
    if (typeof record.name === 'string' && record.name)
        return record.name;
    if (record.render)
        return displayNameOf(record.render);
    if (record.type)
        return displayNameOf(record.type);
    return '';
}

/**
 * Marker for values that are not plain data, or `null` when the value should be walked as data.
 *
 * Boundary: DOM nodes, React elements, Promises, Errors and Dates become strings so the agent reads what they are
 * without the page serializing a whole subtree. Plain objects, arrays, Maps and Sets return `null` (walked by the
 * caller).
 *
 * @param {object} value Non-null object.
 * @returns {string | null} Marker string, or `null` for walkable data.
 */
function objectMarker(value: object): string | null {
    const record = value as Record<string, unknown>;
    if (typeof record.nodeType === 'number' && typeof record.nodeName === 'string') {
        const name = String(record.nodeName).toLowerCase();
        const id = typeof record.id === 'string' && record.id ? `#${record.id}` : '';
        return `[Element <${name}${id}>]`;
    }
    if (typeof record.$$typeof === 'symbol')
        return `[React element <${displayNameOf(record.type) || 'Unknown'}>]`;
    if (value instanceof Date)
        return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString();
    if (value instanceof Error)
        return `[${value.name}: ${value.message}]`;
    if (typeof (value as { then?: unknown }).then === 'function')
        return '[Promise]';
    return null;
}

/**
 * Turn a live value into a bounded JSON-safe tree.
 *
 * Boundary: never throws on hostile input — getters that throw become `[Unreadable]`. Functions become
 * `[Function name]`, `undefined` becomes `[undefined]` (so it survives JSON), non-finite numbers and bigints become
 * strings, Maps become objects keyed by `String(key)`, Sets become arrays, cycles become `[Circular]`. Keys starting with
 * `__v_` (Vue reactivity flags) are skipped.
 *
 * @param {unknown} value Any value read from a component.
 * @param {number} [depth=0] Current nesting level; callers omit it.
 * @param {WeakSet<object>} [seen] Objects on the current path; callers omit it.
 * @returns {StateValue} JSON-safe view.
 */
export function snapshotValue(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): StateValue {
    if (value === null)
        return null;
    switch (typeof value) {
        case 'undefined':
            return '[undefined]';
        case 'boolean':
            return value;
        case 'number':
            return Number.isFinite(value) ? value : String(value);
        case 'bigint':
            return `${value}n`;
        case 'string':
            return value.length > STATE_MAX_STRING ? `${value.slice(0, STATE_MAX_STRING)}…` : value;
        case 'symbol':
            return value.toString();
        case 'function':
            return `[Function ${displayNameOf(value) || 'anonymous'}]`;
    }
    const object = value as object;
    const marker = objectMarker(object);
    if (marker !== null)
        return marker;
    if (seen.has(object))
        return '[Circular]';
    const isArrayLike = Array.isArray(object) || object instanceof Set;
    const size = Array.isArray(object) ? object.length : object instanceof Set || object instanceof Map ? object.size : -1;
    if (depth >= STATE_MAX_DEPTH)
        return isArrayLike ? `[Array(${size})]` : '[Object]';
    seen.add(object);
    try {
        if (isArrayLike) {
            const items = Array.isArray(object) ? object : Array.from(object as Set<unknown>);
            const out = items.slice(0, STATE_MAX_ITEMS).map((item) => snapshotValue(item, depth + 1, seen));
            if (items.length > STATE_MAX_ITEMS)
                out.push(`…+${items.length - STATE_MAX_ITEMS}`);
            return out;
        }
        const entries: Array<[string, unknown]> = object instanceof Map
            ? Array.from(object.entries(), ([key, item]) => [String(key), item])
            : Object.keys(object).filter((key) => !key.startsWith('__v_')).map((key) => [key, readKey(object, key)]);
        const out: { [key: string]: StateValue } = {};
        for (const [key, item] of entries.slice(0, STATE_MAX_KEYS))
            out[key] = snapshotValue(item, depth + 1, seen);
        if (entries.length > STATE_MAX_KEYS)
            out[STATE_MORE_KEY] = `+${entries.length - STATE_MAX_KEYS} keys`;
        return out;
    }
    finally {
        seen.delete(object);
    }
}

/**
 * Read one property, turning a throwing getter into a marker.
 *
 * @param {object} object Owner object.
 * @param {string} key Own enumerable key.
 * @returns {unknown} The value, or the `[Unreadable]` marker.
 */
function readKey(object: object, key: string): unknown {
    try {
        return (object as Record<string, unknown>)[key];
    }
    catch {
        return '[Unreadable]';
    }
}

/**
 * Whether a snapshot node is a plain object (not an array, not a leaf).
 *
 * @param {StateValue | undefined} value Snapshot node.
 * @returns {boolean} True for `{...}` nodes.
 */
function isRecord(value: StateValue | undefined): value is { [key: string]: StateValue } {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Append the path segment for `key` under `path`.
 *
 * @param {string} path Parent path (may be empty).
 * @param {string} key Object key or array index.
 * @param {boolean} index Whether `key` is an array index.
 * @returns {string} `path.key`, `path[3]`, or `key` at the top.
 */
function joinPath(path: string, key: string, index: boolean): string {
    if (index)
        return `${path}[${key}]`;
    return path ? `${path}.${key}` : key;
}

/**
 * Collect leaf differences between two snapshots.
 *
 * Boundary: both inputs must come from {@link snapshotValue} (JSON-safe), so equality is structural. Objects and arrays
 * are walked key by key; a type change, a marker change, or a leaf change is reported at that path. A missing key
 * reports `[undefined]` on the missing side. At most {@link STATE_MAX_DIFF_CHANGES} changes are appended per call; the
 * return value says how many more were found.
 *
 * @param {StateValue | undefined} prev Older snapshot.
 * @param {StateValue | undefined} next Newer snapshot.
 * @param {string} path Path of these two nodes (`''` for the top).
 * @param {StateChange[]} out Changes are appended here.
 * @returns {number} Changes found but not appended because the cap was reached.
 */
export function diffValues(prev: StateValue | undefined, next: StateValue | undefined, path: string, out: StateChange[]): number {
    const budget = out.length + STATE_MAX_DIFF_CHANGES;
    const walk = (a: StateValue | undefined, b: StateValue | undefined, at: string) => {
        if (a === b)
            return;
        const bothArrays = Array.isArray(a) && Array.isArray(b);
        if (bothArrays || (isRecord(a) && isRecord(b))) {
            const keys = bothArrays
                ? Array.from({ length: Math.max(a.length, b.length) }, (_, i) => String(i))
                : Array.from(new Set([...Object.keys(a as object), ...Object.keys(b as object)]));
            for (const key of keys)
                walk((a as Record<string, StateValue>)[key], (b as Record<string, StateValue>)[key], joinPath(at, key, bothArrays));
            return;
        }
        if (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b))
            return;
        if (out.length >= budget) {
            dropped += 1;
            return;
        }
        out.push({ path: at, from: a === undefined ? '[undefined]' : a, to: b === undefined ? '[undefined]' : b });
    };
    let dropped = 0;
    walk(prev, next, path);
    return dropped;
}
