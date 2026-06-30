/**
 * Curated catalog of computed CSS properties the user can attach to the prompt context.
 *
 * Purpose: backs the searchable multi-select in the style-capture panel. These are kebab-case property names passed to
 * `getComputedStyle().getPropertyValue()`, grouped only for ordering/readability in the list.
 * Boundary: the list is intentionally curated rather than the full computed-style enumeration (which returns hundreds of
 * longhand values per element). Adding a name here makes it selectable; it does not need any other wiring.
 *
 * @type {Array<{ group: string, keys: string[] }>} Ordered property groups.
 */
export const STYLE_PROPERTY_GROUPS = [
    {
        group: 'layout',
        keys: [
            'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'clear',
            'box-sizing', 'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
            'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
            'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
            'overflow', 'overflow-x', 'overflow-y', 'inset',
        ],
    },
    {
        group: 'flex-grid',
        keys: [
            'flex', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
            'justify-content', 'justify-items', 'justify-self', 'align-items', 'align-self', 'align-content',
            'gap', 'row-gap', 'column-gap', 'order',
            'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row', 'grid-auto-flow',
            'place-items', 'place-content',
        ],
    },
    {
        group: 'typography',
        keys: [
            'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
            'letter-spacing', 'word-spacing', 'text-align', 'text-decoration', 'text-transform',
            'text-overflow', 'text-shadow', 'white-space', 'word-break', 'overflow-wrap',
            'vertical-align', 'list-style', 'writing-mode', 'direction',
        ],
    },
    {
        group: 'visual',
        keys: [
            'background', 'background-color', 'background-image', 'background-size', 'background-position',
            'background-repeat', 'background-clip',
            'border', 'border-width', 'border-style', 'border-color', 'border-radius',
            'border-top', 'border-right', 'border-bottom', 'border-left',
            'box-shadow', 'outline', 'outline-offset', 'opacity', 'visibility',
            'filter', 'backdrop-filter', 'mix-blend-mode', 'clip-path',
        ],
    },
    {
        group: 'motion',
        keys: [
            'transform', 'transform-origin', 'transition', 'animation', 'will-change',
        ],
    },
    {
        group: 'interaction',
        keys: [
            'cursor', 'pointer-events', 'user-select', 'content', 'object-fit', 'object-position', 'aspect-ratio',
        ],
    },
];

/**
 * Flattened, de-duplicated ordered property list backing the picker and the persistence filter.
 *
 * @type {string[]} Ordered unique computed-style property names.
 */
export const STYLE_PROPERTY_KEYS = (() => {
    const seen = new Set();
    const out = [];
    for (const { keys } of STYLE_PROPERTY_GROUPS) {
        for (const key of keys) {
            if (!seen.has(key)) {
                seen.add(key);
                out.push(key);
            }
        }
    }
    return out;
})();

/** Fast membership lookup used to drop stale stored keys. @type {Set<string>} */
const STYLE_PROPERTY_SET = new Set(STYLE_PROPERTY_KEYS);

/**
 * Default pre-checked properties — the box/layout/typography basics most useful for reproducing a look.
 *
 * @type {string[]} Default selected property names (must all exist in {@link STYLE_PROPERTY_KEYS}).
 */
export const DEFAULT_STYLE_KEYS = [
    'display', 'position', 'width', 'height', 'margin', 'padding',
    'color', 'background-color', 'font-size', 'font-weight', 'line-height',
    'border', 'border-radius', 'box-shadow',
    'flex-direction', 'justify-content', 'align-items', 'gap', 'text-align', 'opacity',
];

/**
 * Filter out any property names that are not part of the curated catalog.
 *
 * Boundary: keeps the caller-provided order so a persisted selection round-trips stably; unknown values (from an older
 * stored preference) are dropped instead of reaching the capture pipeline.
 *
 * @param {Iterable<string>} keys Candidate property names.
 * @returns {string[]} Valid property names in their incoming order.
 */
export function validStyleKeys(keys) {
    const out = [];
    const seen = new Set();
    for (const key of keys ?? []) {
        if (STYLE_PROPERTY_SET.has(key) && !seen.has(key)) {
            seen.add(key);
            out.push(key);
        }
    }
    return out;
}

/**
 * Order an arbitrary selection by the catalog order so captured output is stable regardless of click order.
 *
 * @param {Set<string> | Iterable<string>} selected Selected property names.
 * @returns {string[]} Selected names ordered by the catalog.
 */
export function orderStyleKeys(selected) {
    const set = selected instanceof Set ? selected : new Set(selected ?? []);
    return STYLE_PROPERTY_KEYS.filter((key) => set.has(key));
}
