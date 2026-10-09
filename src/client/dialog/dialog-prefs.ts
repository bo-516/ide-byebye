import { t } from '../lib/i18n.js';
import { validStyleKeys } from '../style/style-keys.js';
import { clampNodeLimit, DEFAULT_NODE_LIMIT } from '../style/style-capture.js';

/**
 * Preference storage for the dialog: screenshot scopes, style-capture choices, and style tree scope,
 * all read/written through a single failure-swallowing JSON store.
 *
 * Boundary: storage can be missing, blocked, or hand-edited — every loader filters against the
 * supported value set so a stale or hostile preference cannot widen a capture unexpectedly.
 */

export const SCREENSHOT_PREF_KEY = 'code-intent-inspector:screenshot-scopes';
export const STYLE_KEYS_PREF_KEY = 'code-intent-inspector:style-keys';
export const STYLE_SCOPE_PREF_KEY = 'code-intent-inspector:style-scope';
export const STYLE_NODES_PREF_KEY = 'code-intent-inspector:style-nodes';

/**
 * Style-capture scopes in render and persistence order.
 * Boundary: values must match the `captureStyles` scope branches; a stale or unsupported stored value falls back to
 * `self` in {@link loadStyleScope} so a bad preference cannot widen the capture unexpectedly.
 */
export const STYLE_SCOPE_ORDER = ['self', 'children', 'ancestors', 'both'];

/**
 * Screenshot scopes in render and persistence order.
 * Boundary: values must match `captureScreenshot` branches; stale or unsupported stored values are filtered out by
 * `loadScreenshotChoices` before they reach the capture pipeline.
 */
export const SCREENSHOT_SCOPE_ORDER = ['selection', 'parent', 'viewport'];

/** Persisted style-capture scope. Anything else stored under the preference key is treated as `self`. */
type StyleScope = 'self' | 'children' | 'ancestors' | 'both';

/**
 * Preference set passed to the savers.
 *
 * Boundary: `choices = new Set()` is `Set<unknown>` under strict checking, and `Set` is invariant, so a `Set<string>`
 * parameter would reject those fields. Screenshot saving only calls `has` with known scope strings.
 */
interface ChoiceSet {
    has(value: string): boolean;
}

/**
 * Whether `value` is one of {@link STYLE_SCOPE_ORDER}.
 *
 * Boundary: `localStorage.getItem` returns `string | null`, and `Array.includes` on `string[]` rejects null. The
 * predicate lets {@link loadStyleScope} return the four-value union instead of `string | null`. The union must stay
 * in sync with `STYLE_SCOPE_ORDER`.
 *
 * @param {string | null} value Stored scope, or null when the key is missing.
 * @returns {boolean} True when `value` is a supported scope.
 */
function isStyleScope(value: string | null): value is StyleScope {
    return value != null && STYLE_SCOPE_ORDER.includes(value);
}

/**
 * Read and JSON-parse a stored preference, returning a fallback on any failure.
 *
 * Boundary: the single choke point for best-effort preference reads. Missing, unparsable, or storage-blocked values all
 * collapse to `fallback`, so private browsing / quota errors never throw into the dialog. `T` is the shape the caller
 * promises the stored value has — the parsed JSON is cast to it unchecked, so callers must still validate structure
 * (array/enum checks) before trusting fields.
 *
 * @param {string} key Storage key.
 * @param {T} fallback Value returned when missing or malformed. Also sets `T` when the caller does not.
 * @param {Storage} [store] Storage area; defaults to `window.localStorage`.
 * @returns {T} Parsed value or fallback.
 */
export function readJsonStore<T>(key: string, fallback: T, store: Storage = window.localStorage): T {
    try {
        const raw = store.getItem(key);
        if (!raw)
            return fallback;
        const value: unknown = JSON.parse(raw);
        return (value as T) ?? fallback;
    }
    catch {
        return fallback;
    }
}

/**
 * JSON-stringify and write a stored preference, swallowing failures.
 *
 * @param {string} key Storage key.
 * @param {unknown} value Serializable value.
 * @param {Storage} [store] Storage area; defaults to `window.localStorage`.
 * @returns {void}
 */
export function writeJsonStore(key: string, value: unknown, store: Storage = window.localStorage): void {
    try {
        store.setItem(key, JSON.stringify(value));
    }
    catch {
        // Preference persistence is best effort.
    }
}

/**
 * Load persisted screenshot choices from localStorage.
 *
 * Boundary: malformed storage, unavailable storage, and stale values are ignored. The returned set contains only
 * scopes in `SCREENSHOT_SCOPE_ORDER`; callers must still capture the screenshots before sending.
 *
 * @returns {Set<string>} Valid screenshot scopes selected by the user.
 */
export function loadScreenshotChoices() {
    const value = readJsonStore<unknown>(SCREENSHOT_PREF_KEY, null);
    if (!Array.isArray(value))
        return new Set();
    return new Set(value.filter((scope) => SCREENSHOT_SCOPE_ORDER.includes(scope)));
}

/**
 * Persist screenshot choices as a best-effort UI preference.
 *
 * Boundary: storage failures are swallowed so private browsing or quota issues do not block the dialog. Passing scopes
 * outside `SCREENSHOT_SCOPE_ORDER` drops them instead of leaking unsupported values into storage.
 *
 * @param {ChoiceSet} choices Screenshot scope set from the current dialog. `Set<unknown>` is accepted because
 *        `new Set()` infers that, and `Set` is invariant.
 * @returns {void}
 */
export function saveScreenshotChoices(choices: ChoiceSet): void {
    writeJsonStore(SCREENSHOT_PREF_KEY, SCREENSHOT_SCOPE_ORDER.filter((scope) => choices.has(scope)));
}

/**
 * Convert a screenshot scope into the localized label used in previews.
 *
 * Boundary: unknown scopes are treated as viewport screenshots so stale stored choices still get a stable label.
 *
 * @param {string} scope Screenshot scope value.
 * @returns {string} Human-readable label.
 */
export function screenshotScopeLabel(scope: string): string {
    const key = SCREENSHOT_SCOPE_ORDER.includes(scope) ? scope : 'viewport';
    return t(`screenshot.scope.${key}`);
}

/**
 * Convert a screenshot scope into the compact localized label used in the picker title.
 *
 * Boundary: unknown scopes are treated as viewport screenshots; callers should still validate persisted choices through
 * `SCREENSHOT_SCOPE_ORDER` before using them.
 *
 * @param {string} scope Screenshot scope value.
 * @returns {string} Compact title label without the screenshot suffix.
 */
export function screenshotScopeTitleLabel(scope: string): string {
    const key = SCREENSHOT_SCOPE_ORDER.includes(scope) ? scope : 'viewport';
    return t(`screenshot.scopeTitle.${key}`);
}

/**
 * Load persisted style-capture property choices from localStorage.
 *
 * Boundary: style capture is opt-in, so an absent preference returns an empty set (no styles are attached until the user
 * picks properties or applies the common defaults from the panel). Malformed or stale values are filtered against the
 * curated catalog.
 *
 * @returns {Set<string>} Selected computed-style property names.
 */
export function loadStyleChoices() {
    const value = readJsonStore<unknown>(STYLE_KEYS_PREF_KEY, null);
    if (!Array.isArray(value))
        return new Set();
    return new Set(validStyleKeys(value));
}

/**
 * Persist style-capture property choices as a best-effort preference.
 *
 * Boundary: storage failures are swallowed so private browsing or quota issues do not block the dialog. Only catalog
 * properties are written so unsupported values cannot leak into storage. The parameter stays {@link ChoiceSet} (just
 * `has`) so a `Set<unknown>` field still typechecks. `validStyleKeys` iterates; callers pass a `Set`, which is iterable
 * at runtime. `ChoiceSet` and `Iterable` do not overlap, so the value is cast through `unknown` with no runtime change.
 *
 * @param {ChoiceSet} choices Selected property set from the current dialog. See {@link saveScreenshotChoices}.
 * @returns {void}
 */
export function saveStyleChoices(choices: ChoiceSet): void {
    writeJsonStore(STYLE_KEYS_PREF_KEY, validStyleKeys(choices as unknown as Iterable<string>));
}

/**
 * Load the persisted style-capture scope.
 *
 * Boundary: only values in {@link STYLE_SCOPE_ORDER} are valid; any other stored value falls back to `self` so a stale
 * preference cannot widen the capture unexpectedly.
 *
 * @returns {'self' | 'children' | 'ancestors' | 'both'} Persisted scope, defaulting to `self`.
 */
export function loadStyleScope(): StyleScope {
    try {
        const value = window.localStorage.getItem(STYLE_SCOPE_PREF_KEY);
        return isStyleScope(value) ? value : 'self';
    }
    catch {
        return 'self';
    }
}

/**
 * Persist the style-capture scope as a best-effort preference.
 *
 * @param {string} scope Scope chosen in the current dialog. Only `'self' | 'children' | 'ancestors' | 'both'` are stored;
 *        anything else is written as `self`. Callers iterate `STYLE_SCOPE_ORDER` (`string[]`), so the parameter is `string`.
 * @returns {void}
 */
export function saveStyleScope(scope: string): void {
    try {
        window.localStorage.setItem(STYLE_SCOPE_PREF_KEY, isStyleScope(scope) ? scope : 'self');
    }
    catch {
        // Preference persistence is best effort.
    }
}

/**
 * Load the persisted node-count cap for the tree scopes (children/ancestors).
 *
 * Boundary: the cap is a per-user preference reused as the initial value on the next open; an absent or malformed value
 * yields {@link DEFAULT_NODE_LIMIT}. The value is clamped into the supported range so a hand-edited store cannot push
 * the capture past what the server also enforces.
 *
 * @returns {number} Node cap in the supported range.
 */
export function loadStyleNodeLimit() {
    return clampNodeLimit(readJsonStore<unknown>(STYLE_NODES_PREF_KEY, DEFAULT_NODE_LIMIT));
}

/**
 * Persist the node-count cap as a best-effort preference.
 *
 * @param {number} limit Node cap chosen in the current dialog.
 * @returns {void}
 */
export function saveStyleNodeLimit(limit: number): void {
    writeJsonStore(STYLE_NODES_PREF_KEY, clampNodeLimit(limit));
}
