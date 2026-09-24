/**
 * Angular element hint: what the browser tells the server about a picked element in an Angular dev build.
 *
 * Purpose: Angular templates carry no `data-insp-path` (code-inspector cannot stamp them), but Angular dev mode knows
 * each element's owning component and that component's source file. The browser sends that location plus a compact
 * description of the element and its ancestors declared in the same template; the server matches it against the
 * template AST. Shared so both sides agree on field names and size limits.
 *
 * Boundary: runs in browser and Node (no DOM, no `node:*`). The server treats every field as untrusted input: strings
 * are only compared, never used as paths, and {@link normalizeAngularHint} caps every array and string.
 */

/** Size caps applied on both sides. */
export const ANGULAR_HINT_LIMITS = {
    pathSteps: 24,
    classes: 12,
    attrs: 8,
    stringLength: 160,
} as const;

/** Static attributes worth comparing with the template (dynamic / framework attributes are ignored). */
export const ANGULAR_HINT_ATTRS = ['type', 'name', 'role', 'aria-label', 'placeholder', 'href', 'for', 'alt'];

/** One element in the owner-declared chain (outermost first; the last step is the picked element). */
export interface AngularHintStep {
    tag: string;
    id?: string;
    classes?: string[];
    attrs?: Record<string, string>;
    /** Index among preceding siblings with the same tag that the same component declared (DOM order). */
    index?: number;
}

/** Hint attached to a selection as `selection.angular`. */
export interface AngularHint {
    className?: string;
    path: AngularHintStep[];
    /** Trimmed text content of the picked element. */
    text?: string;
}

/**
 * Clamp a value to a bounded string.
 *
 * @param {unknown} value Raw value.
 * @returns {string | undefined} Trimmed string within the length cap, or `undefined` for non-strings / empty.
 */
function boundedString(value: unknown) {
    if (typeof value !== 'string')
        return undefined;
    const text = value.trim().slice(0, ANGULAR_HINT_LIMITS.stringLength);
    return text || undefined;
}

/**
 * Normalize one path step.
 *
 * @param {unknown} raw Raw step.
 * @returns {AngularHintStep | null} Clean step, or `null` without a usable tag.
 */
function normalizeStep(raw: any): AngularHintStep | null {
    const tag = boundedString(raw?.tag)?.toLowerCase();
    if (!tag || !/^[a-z][\w.-]*$/.test(tag))
        return null;
    const step: AngularHintStep = { tag };
    const id = boundedString(raw.id);
    if (id)
        step.id = id;
    if (Array.isArray(raw.classes)) {
        const classes = raw.classes.map(boundedString).filter(Boolean).slice(0, ANGULAR_HINT_LIMITS.classes);
        if (classes.length)
            step.classes = classes;
    }
    if (raw.attrs && typeof raw.attrs === 'object') {
        const attrs: Record<string, string> = {};
        for (const name of ANGULAR_HINT_ATTRS) {
            const value = boundedString(raw.attrs[name]);
            if (value)
                attrs[name] = value;
        }
        if (Object.keys(attrs).length)
            step.attrs = attrs;
    }
    if (Number.isInteger(raw.index) && raw.index >= 0 && raw.index < 10_000)
        step.index = raw.index;
    return step;
}

/**
 * Validate and bound an Angular hint from an untrusted payload.
 *
 * @param {unknown} raw `selection.angular` as received.
 * @returns {AngularHint | null} Normalized hint, or `null` when it has no usable path.
 */
export function normalizeAngularHint(raw: any): AngularHint | null {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.path))
        return null;
    const path = raw.path.slice(-ANGULAR_HINT_LIMITS.pathSteps).map(normalizeStep).filter(Boolean);
    if (path.length === 0)
        return null;
    const hint: AngularHint = { path };
    const className = boundedString(raw.className);
    if (className)
        hint.className = className;
    const text = boundedString(raw.text);
    if (text)
        hint.text = text;
    return hint;
}
