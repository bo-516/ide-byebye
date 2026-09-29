import { INSP_PATH_ATTR } from '../../shared/constants.js';
import { t } from '../lib/i18n.js';

/**
 * Recording scope choices, mirroring the screenshot scopes: the selected node, its parent, or the app mount root.
 * Boundary: `viewport`-style whole-page is intentionally NOT offered for recordings — the still/replay always focus a
 * concrete subtree so the agent sees the element in question, not the whole app chrome.
 */
/** Subtree a recording still and viewer focus: the picked node, its parent, or the app mount root. */
export type RecordingScope = 'selection' | 'parent' | 'root';

export const RECORDING_SCOPES: RecordingScope[] = ['selection', 'parent', 'root'];

/**
 * Localized label for one recording scope.
 * Boundary: unsupported values fall back to the selected-node label so a stale stored scope still reads sensibly.
 * @param {RecordingScope} scope Recording scope value.
 * @returns {string} Human-readable scope label in the active locale.
 */
export function recordingScopeLabel(scope: RecordingScope): string {
    const key = RECORDING_SCOPES.includes(scope) ? scope : 'selection';
    return t(`recording.scope.${key}`);
}

/**
 * Normalize a possibly-stale scope value to a supported one.
 * @param {unknown} scope Raw scope value.
 * @returns {RecordingScope} A valid scope, defaulting to `selection`.
 */
export function normalizeRecordingScope(scope: unknown): RecordingScope {
    // `includes` on the scope union does not accept `unknown`; a string check keeps the same membership test.
    if (typeof scope === 'string' && (RECORDING_SCOPES as readonly string[]).includes(scope))
        return scope as RecordingScope;
    return 'selection';
}

/**
 * Escape a string for use inside a CSS attribute-selector double-quoted value.
 * @param {string} value Raw attribute value.
 * @returns {string} Escaped value safe between double quotes.
 */
function cssAttrValue(value: string): string {
    return String(value).replace(/["\\]/g, '\\$&');
}

/**
 * Escape a string for use as a CSS identifier (id/class) in a selector.
 * Boundary: handles the common cases (leading digit, special chars) well enough for ids produced by app frameworks;
 * exotic identifiers fall back to attribute-style matching by the caller when this is insufficient.
 * @param {string} value Raw identifier.
 * @returns {string} Escaped identifier.
 */
function cssIdent(value: string): string {
    return String(value).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

/**
 * Build a selector that re-locates an element inside the rrweb replay document.
 *
 * Boundary: prefers the `data-insp-path` attribute (present on picker-selected elements and preserved by rrweb), then a
 * stable `#id`, then a structural `nth-of-type` path. The selector is matched against the replay DOM, which rrweb
 * rebuilds with the same tag/attribute structure, so structural paths stay valid. Returns null for non-elements.
 *
 * @param {Element | null} el Live page element.
 * @returns {string | null} A selector usable with `querySelector` in the replay document, or null.
 */
export function uniqueSelector(el: Element | null): string | null {
    if (!el || el.nodeType !== 1)
        return null;
    const insp = el.getAttribute(INSP_PATH_ATTR);
    if (insp)
        return `[${INSP_PATH_ATTR}="${cssAttrValue(insp)}"]`;
    if (el.id)
        return `#${cssIdent(el.id)}`;
    const parts: string[] = [];
    let current: Element | null = el;
    while (current && current.nodeType === 1 && current !== document.body && parts.length < 6) {
        if (current.id) {
            parts.unshift(`#${cssIdent(current.id)}`);
            return parts.join(' > ');
        }
        let part = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (parent) {
            // `current` is reassigned below, so the filter callback would not keep this iteration's Element narrowing.
            const currentEl = current;
            const sameTag = Array.from(parent.children).filter((child) => child.tagName === currentEl.tagName);
            if (sameTag.length > 1)
                part += `:nth-of-type(${sameTag.indexOf(currentEl) + 1})`;
        }
        parts.unshift(part);
        current = current.parentElement;
    }
    return parts.length ? parts.join(' > ') : null;
}

/**
 * Resolve the scope's target element from the selected element.
 *
 * Boundary: `parent` falls back to the element itself at the document edge; `root` walks up to the highest ancestor that
 * is a direct child of `<body>` (the typical app mount container such as `#root`/`#app`), falling back to the element
 * when it is already a body child. Returns null when no selected element is available.
 *
 * @param {Element | null} selectedElement The picker-selected page element.
 * @param {RecordingScope} scope Requested recording scope.
 * @returns {Element | null} The element whose subtree the recording should focus.
 */
export function scopeTargetElement(selectedElement: Element | null, scope: RecordingScope): Element | null {
    if (!selectedElement)
        return null;
    if (scope === 'parent')
        return selectedElement.parentElement || selectedElement;
    if (scope === 'root') {
        let current = selectedElement;
        while (current.parentElement && current.parentElement !== document.body) {
            current = current.parentElement;
        }
        return current;
    }
    return selectedElement;
}
