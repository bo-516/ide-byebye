import { INSP_PATH_ATTR, PLUGIN_NODE_ATTR } from '../../shared/constants.js';
import { collapseWhitespace, truncateSnippet } from '../../shared/util.js';
import { DEFAULT_MAX_TEXT_SNIPPET } from '../../shared/constants.js';
import { angularComponentOf, angularLocationLabel, angularSelection } from './angular-source.js';
import { componentLocationOf, isFrameworkBoundary, pickRenderChain, vueFallbackElement } from './component-tree.js';
import { promoteToOuterSameSizeElement, type SameSizeNode } from './same-size.js';
/**
 * True if the node belongs to the plugin's own UI.
 *
 * @param {unknown} el Event target or test double. A node without `closest` is not plugin UI.
 * @returns {boolean} Whether the node sits inside a plugin host.
 */
export function isPluginNode(el: unknown): boolean {
    // Cast erases. `closest` stays a double read so a getter runs for the truthiness check and again for the query.
    const node = el as { closest?: (selector: string) => unknown } | null;
    return !!(node && node.closest && node.closest(`[${PLUGIN_NODE_ATTR}]`));
}
/** `stopAt` for same-size promotion: never climb above a portal / Teleport root. */
function isBoundaryNode(node: SameSizeNode): boolean {
    return isFrameworkBoundary(node as unknown as Element);
}

/**
 * Nearest element at or above `target` carrying `data-insp-path`, without climbing past a framework boundary.
 *
 * Boundary: a boundary that is itself stamped counts as a hit. Elements are matched with `hasAttribute`, the same test
 * as the `[data-insp-path]` selector, so an empty attribute still stops the walk.
 *
 * @param {Element} target Event target.
 * @returns {{ stamped: Element | null, boundary: Element | null }} The stamped element, else the unstamped boundary
 *          the walk stopped at; both null when the walk reached the top of the tree.
 */
function walkToStamp(target: Element): { stamped: Element | null; boundary: Element | null } {
    for (let node: Element | null = target; node; node = node.parentElement) {
        if (node.hasAttribute(INSP_PATH_ATTR))
            return { stamped: node, boundary: null };
        if (isFrameworkBoundary(node))
            return { stamped: null, boundary: node };
    }
    return { stamped: null, boundary: null };
}

/**
 * Resolve the event target to the element a pick is about.
 *
 * Purpose: walk up to the nearest element carrying a `data-insp-path` and promote it to the outermost ancestor
 * occupying (almost) the same box. Portal / Teleport roots stop both walks: content rendered into `<body>` or another
 * container must not resolve to that container. When the walk stops at an unstamped root, the root is the pick and
 * its location comes from the component tree. In Angular dev builds (no stamped attributes) the target itself is
 * inspectable when Angular knows its owning component; Teleported Vue library markup with no stamp anywhere above
 * resolves to the outermost element its owner rendered.
 * Boundary: elements outside portals resolve exactly as a plain `closest('[data-insp-path]')` plus promotion. A root
 * without component-tree information falls back to that plain rule from its parent.
 *
 * @param {unknown} target Event target. Non-elements and plugin UI yield null.
 * @returns {HTMLElement | null} Inspectable element, or null.
 */
export function findInspectableElement(target: unknown): HTMLElement | null {
    if (!(target instanceof HTMLElement))
        return null;
    if (isPluginNode(target))
        return null;
    const { stamped, boundary } = walkToStamp(target);
    if (boundary && componentLocationOf(boundary))
        return boundary instanceof HTMLElement ? boundary : null;
    const found = boundary ? boundary.parentElement?.closest(`[${INSP_PATH_ATTR}]`) : stamped;
    if (found instanceof HTMLElement) {
        // Promotion accepts layout doubles. Both assertions erase, so this still returns the element (or an ancestor).
        return promoteToOuterSameSizeElement(found as unknown as SameSizeNode, undefined, isBoundaryNode) as unknown as HTMLElement;
    }
    if (angularComponentOf(target))
        return target;
    const fallback = found ? null : vueFallbackElement(target);
    return fallback instanceof HTMLElement ? fallback : null;
}

/**
 * Source location string for labelling an inspectable element (hover overlay).
 *
 * Boundary: the stamped `data-insp-path` wins; Angular elements get their component's `file:line` (cheap enough for
 * mousemove — the unique per-element path is built by {@link collectSelection} at pick time); portal roots and
 * Teleported library markup get their component-tree location; anything else yields `''` ("no mapping").
 *
 * @param {Element} el Inspectable element.
 * @returns {string} `data-insp-path`-shaped location, or `''`.
 */
export function inspPathOf(el: Element): string {
    return el.getAttribute(INSP_PATH_ATTR) || angularLocationLabel(el) || componentLocationOf(el) || '';
}
function classList(el: Element): string | undefined {
    // SVG `className` is an object. Both reads stay so a string getter still runs twice, as before the cast.
    const raw = typeof (el as { className?: unknown }).className === 'string'
        ? (el as { className?: unknown }).className as string
        : el.getAttribute('class');
    const trimmed = (raw ?? '').trim();
    return trimmed || undefined;
}
/**
 * Build a short CSS-like DOM path, e.g. `body > div#root > button.primary`.
 *
 * @param {Element} el Start element. Non-elements stop the walk.
 * @param {number} [maxDepth] Maximum segments. Omitted uses 6.
 * @returns {string} Path from an ancestor down to `el`.
 */
export function buildDomPath(el: Element, maxDepth = 6): string {
    const segments: string[] = [];
    // `parentElement` is `HTMLElement | null`, so the cursor has to admit null or the climb cannot move up.
    let node: Element | null = el;
    while (node && node.nodeType === 1 && segments.length < maxDepth) {
        let seg = node.tagName.toLowerCase();
        if (node.id) {
            segments.unshift(`${seg}#${node.id}`);
            break;
        }
        const cls = classList(node);
        if (cls) {
            seg += '.' + cls.split(/\s+/).slice(0, 2).join('.');
        }
        // Alias so the sibling filter does not close over `node` while `node` is assigned `parent`.
        // The annotation breaks the inference cycle; `tagName` is still read once per sibling.
        const current: Element = node;
        const parent: HTMLElement | null = current.parentElement;
        if (parent) {
            const sameTag = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
            if (sameTag.length > 1) {
                seg += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
            }
        }
        segments.unshift(seg);
        node = parent;
    }
    return segments.join(' > ');
}
/**
 * Collect the DOM summary that travels to the server.
 *
 * Boundary: the location comes from the stamped attribute, then Angular, then the component tree (portal roots,
 * Teleported library markup). Angular elements (no stamped attribute) also carry `angular`, the owner-declared
 * ancestor hint the server matches against the component template; stamped elements never send it. With `withChain`
 * (the primary pick only), a pick inside a portal / Teleport also carries `renderChain` (the pick plus its mount
 * points) and `portal: true`; every other selection keeps exactly the fields it had before. An omitted `maxHtml` is
 * forwarded as-is (`undefined` still reaches `truncateSnippet`); callers that pass a number cap the outerHTML snippet.
 *
 * @param {HTMLElement} el Picked element.
 * @param {number | undefined} maxHtml OuterHTML cap. `undefined` is not coerced.
 * @param {{ withChain?: boolean }} [options] `withChain` adds the render chain to portal picks. Omitted never adds it,
 *        which is what extra `@code` references want.
 * @returns {object} DOM summary. `inspPath` may be empty when nothing maps.
 */
export function collectSelection(el: HTMLElement, maxHtml: number | undefined, options: { withChain?: boolean } = {}) {
    const text = (el.innerText || el.textContent || '').trim();
    const stamped = el.getAttribute(INSP_PATH_ATTR);
    const angular = stamped ? null : angularSelection(el);
    const inspPath = stamped ?? angular?.inspPath ?? componentLocationOf(el) ?? '';
    const chain = options.withChain && inspPath && !angular ? pickRenderChain(el, inspPath) : null;
    return {
        inspPath,
        ...(angular ? { angular: angular.hint } : {}),
        ...(chain?.portal ? { renderChain: chain.renderChain, portal: true } : {}),
        tagName: el.tagName.toLowerCase(),
        id: el.id || undefined,
        className: classList(el),
        role: el.getAttribute('role') ?? undefined,
        ariaLabel: el.getAttribute('aria-label') ?? undefined,
        textSnippet: truncateSnippet(collapseWhitespace(text), DEFAULT_MAX_TEXT_SNIPPET),
        outerHTMLSnippet: truncateSnippet(el.outerHTML, maxHtml as number),
        domPath: buildDomPath(el),
    };
}
