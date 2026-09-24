import { ANGULAR_HINT_ATTRS, ANGULAR_HINT_LIMITS } from '../../shared/angular-hint.js';

/**
 * Angular source resolution in the browser (dev builds only).
 *
 * Purpose: Angular templates carry no `data-insp-path`, but Angular dev mode publishes `window.ng` and stamps every
 * component definition with `debugInfo` (`{ className, filePath, lineNumber }`). From a picked element this module
 * derives the owning component's source location plus a compact description of the element and of its ancestors that
 * the same component declared; the server matches that against the component template.
 *
 * Boundary: read-only DOM walks, no rendering. Returns `null` outside Angular dev builds (no `ng.getOwningComponent`,
 * or no `debugInfo`), so every other framework keeps using `data-insp-path` untouched. Angular's debugging API may
 * throw for nodes it does not manage; those are treated as "not Angular".
 */

/** Minimal shape of Angular's dev-mode global. */
interface AngularDebugApi {
    getOwningComponent(el: Element): any;
    getHostElement?(component: any): Element | null;
}

/**
 * Angular dev-mode debugging API from a window-like object.
 *
 * @param {any} [win] Window to read `ng` from; defaults to the global window (absent in Node tests).
 * @returns {AngularDebugApi | null} `window.ng` when it exposes `getOwningComponent`, else `null`.
 */
export function angularDebugApi(win: any = typeof window === 'undefined' ? undefined : window): AngularDebugApi | null {
    const ng = win?.ng;
    return ng && typeof ng.getOwningComponent === 'function' ? ng : null;
}

/**
 * Owning component of an element, or `null` when Angular does not manage it.
 *
 * @param {AngularDebugApi} ng Debug API.
 * @param {Element} el Element to look up.
 * @returns {any} Component instance or `null`.
 */
function ownerOf(ng: AngularDebugApi, el: Element) {
    try {
        return ng.getOwningComponent(el) ?? null;
    }
    catch {
        return null;
    }
}

/**
 * Owning component and its source `debugInfo` for an element.
 *
 * @param {Element} el Picked or hovered element.
 * @param {AngularDebugApi | null} [ng] Debug API (defaults to `window.ng`).
 * @returns {{ owner: any, info: { className?: string, filePath: string, lineNumber?: number } } | null} Owner and
 *   debug info, or `null` outside Angular dev builds.
 */
export function angularComponentOf(el: Element, ng: AngularDebugApi | null = angularDebugApi()) {
    if (!ng || !el)
        return null;
    const owner = ownerOf(ng, el);
    const info = owner?.constructor?.ɵcmp?.debugInfo;
    if (!info || typeof info.filePath !== 'string' || !info.filePath)
        return null;
    return { owner, info };
}

/**
 * Cheap location label for hover feedback: the owning component's file and class line, without the per-element
 * fingerprint (which needs sibling scans and is only computed at pick time by {@link angularSelection}).
 *
 * @param {Element} el Hovered element.
 * @param {AngularDebugApi | null} [ng] Debug API (defaults to `window.ng`).
 * @returns {string | null} `<file>:<line>:1:<tag>`, or `null` outside Angular dev builds.
 */
export function angularLocationLabel(el: Element, ng: AngularDebugApi | null = angularDebugApi()) {
    const found = angularComponentOf(el, ng);
    return found ? `${found.info.filePath}:${Number(found.info.lineNumber) || 1}:1:${el.localName}` : null;
}

/**
 * Describe one element for template matching (static-looking attributes only).
 *
 * @param {Element} el Element owned by the component.
 * @param {number} index Index among preceding same-tag siblings owned by the same component.
 * @returns {Record<string, unknown>} Hint step (see `AngularHintStep`).
 */
function describeStep(el: Element, index: number) {
    const step: Record<string, unknown> = { tag: el.localName, index };
    if (el.id)
        step.id = el.id;
    // `ng-*` classes are Angular's own state markers (ng-star-inserted, ng-valid, …), never template-authored.
    const classes = Array.from(el.classList ?? []).filter((name) => !name.startsWith('ng-')).slice(0, ANGULAR_HINT_LIMITS.classes);
    if (classes.length)
        step.classes = classes;
    const attrs: Record<string, string> = {};
    for (const name of ANGULAR_HINT_ATTRS) {
        const value = el.getAttribute(name);
        if (value)
            attrs[name] = value.slice(0, ANGULAR_HINT_LIMITS.stringLength);
    }
    if (Object.keys(attrs).length)
        step.attrs = attrs;
    return step;
}

/**
 * Index of `el` among preceding siblings with the same tag that the same component owns.
 *
 * @param {AngularDebugApi} ng Debug API.
 * @param {Element} el Element.
 * @param {any} owner Owning component of `el`.
 * @returns {number} Zero-based index.
 */
function sameTagIndex(ng: AngularDebugApi, el: Element, owner: any) {
    let index = 0;
    for (let node = el.previousElementSibling; node; node = node.previousElementSibling) {
        if (node.localName === el.localName && ownerOf(ng, node) === owner)
            index += 1;
    }
    return index;
}

/**
 * Build the selection location for an element in an Angular dev build.
 *
 * Purpose: `inspPath` is a synthetic `data-insp-path`-shaped string (`<file>:<line>:1:<tag>@<fingerprint>`) so every
 * consumer of `inspPath` (labels, dedupe, the server parser) keeps working; the fingerprint makes it unique per element.
 * `hint` carries the owner-declared ancestor chain (nearest `pathSteps` kept) for server-side template matching.
 *
 * @param {Element} el Picked element.
 * @param {AngularDebugApi | null} [ng] Debug API (defaults to `window.ng`).
 * @returns {{ inspPath: string, hint: Record<string, unknown> } | null} Location, or `null` outside Angular dev builds.
 */
export function angularSelection(el: Element, ng: AngularDebugApi | null = angularDebugApi()) {
    const found = angularComponentOf(el, ng);
    if (!found)
        return null;
    const { owner, info } = found;
    let host: Element | null = null;
    try {
        host = ng.getHostElement?.(owner) ?? null;
    }
    catch {
        host = null;
    }
    const chain: Element[] = [];
    for (let node: Element | null = el; node && node !== host && chain.length < ANGULAR_HINT_LIMITS.pathSteps; node = node.parentElement) {
        if (ownerOf(ng, node) === owner)
            chain.unshift(node);
    }
    const path = chain.map((node) => describeStep(node, sameTagIndex(ng, node, owner)));
    const fingerprint = path.map((step) => `${step.tag}${step.index}`).join('>');
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, ANGULAR_HINT_LIMITS.stringLength);
    const hint: Record<string, unknown> = { path };
    if (info.className)
        hint.className = String(info.className);
    if (text)
        hint.text = text;
    return {
        inspPath: `${info.filePath}:${Number(info.lineNumber) || 1}:1:${el.localName}@${fingerprint}`,
        hint,
    };
}
