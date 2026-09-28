import { svgDataUri } from './icons.js';
import { OFFICIAL_MARKS } from './agent-marks-official.js';
import { TILE_MARKS } from './agent-marks-tiles.js';

/**
 * The two destination icon families under review: `official` shows each vendor's own logo, `tiles` a redrawn,
 * uniform set of app-style tiles.
 *
 * Boundary: temporary — once one family is chosen, the other module and {@link ACTIVE_MARK_SET} go away. Both must
 * cover every brand in {@link AGENT_MARK_BRANDS}, or that destination falls back to its generic kind glyph.
 * @type {Record<string, Record<string, { image?: string, mask?: string }>>} Mark families by name.
 */
export const MARK_SETS = { official: OFFICIAL_MARKS, tiles: TILE_MARKS };

/** Family the destination picker shows. @type {'official' | 'tiles'} */
export const ACTIVE_MARK_SET = 'official';

/**
 * Brand mark for each built-in destination; both Antigravity launchers share Google's mark.
 *
 * Boundary: keys must match `AGENT_ACTIONS` names (a test enforces it). A destination missing here — every client from
 * `agents.custom` — keeps the glyph for its kind; the `custom` brand, when a family defines it, styles those.
 * @type {Record<string, string>} Brand key by agent id.
 */
export const AGENT_MARK_BRANDS = {
    'codex-app': 'codex',
    'claude-app': 'claude',
    'cursor-app': 'cursor',
    'grok-build': 'grok',
    'antigravity-ide': 'antigravity',
    antigravity: 'antigravity',
};

/**
 * Selector for the icon slots that show `brand`'s mark.
 * @param {string} brand Brand key. @returns {string} Selector list; empty when no destination uses the brand.
 */
function slotSelector(brand) {
    if (brand === 'custom')
        return '.cii-agent-kind[data-kind="custom"]';
    return Object.keys(AGENT_MARK_BRANDS)
        .filter((agent) => AGENT_MARK_BRANDS[agent] === brand)
        .map((agent) => `.cii-agent-kind[data-agent="${agent}"]`)
        .join(',');
}

/**
 * agentIconsStyle(marks): CSS that paints destination icon slots (`.cii-agent-kind`) with brand marks.
 *
 * Purpose: each mark becomes a `--cii-mark-<brand>` custom property (the full `url(…) center/contain no-repeat`
 * shorthand) plus one rule per brand keyed on the slot's `data-agent` (or `data-kind="custom"`). Full-colour `image`
 * marks replace the slot's mask with a background; single-colour `mask` marks keep the mask and paint it with the
 * theme's text colour (system text colour under forced colours), so a selected row's accent tint never recolours a
 * logo. Selectors carry two classes' weight, which beats the kind glyphs and the forced-colours slot reset.
 * Boundary: pure; must be composed after DESTINATION_STYLE. Mark SVGs must be free of double quotes. Brands no
 * destination uses produce a property but no rule.
 *
 * @param {Record<string, { image?: string, mask?: string }>} marks One family from {@link MARK_SETS}.
 * @returns {string} CSS text.
 */
export function agentIconsStyle(marks) {
    const properties = [];
    const rules = [];
    const monochrome = [];
    for (const [brand, mark] of Object.entries(marks)) {
        properties.push(`--cii-mark-${brand}:${svgDataUri(mark.image ?? mark.mask)} center/contain no-repeat;`);
        const selector = slotSelector(brand);
        if (!selector)
            continue;
        if (mark.image) {
            rules.push(`${selector}{-webkit-mask:none;mask:none;background:var(--cii-mark-${brand})}`);
            continue;
        }
        rules.push(`${selector}{-webkit-mask:var(--cii-mark-${brand});mask:var(--cii-mark-${brand});background:var(--cii-text)}`);
        monochrome.push(selector);
    }
    const forced = monochrome.length ? `@media (forced-colors:active){${monochrome.join(',')}{background:CanvasText}}` : '';
    return `:host{${properties.join('')}}${rules.join('')}${forced}`;
}

/**
 * Brand-mark stylesheet for the active family, composed after DESTINATION_STYLE.
 *
 * Boundary: generated at module load (like ICONS_STYLE), so it is intentionally absent from the build's CSS-template
 * minifier list.
 * @type {string} CSS text.
 */
export const AGENT_ICONS_STYLE = agentIconsStyle(MARK_SETS[ACTIVE_MARK_SET]);
