import { svgDataUri } from './icons.js';
import { AGENT_MARKS } from './agent-marks.js';

/**
 * Brand mark for each built-in destination. The two Antigravity launchers get separate marks: they share Google's glyph
 * but not its tile (light for Antigravity, dark for the IDE), which is what tells their rows apart.
 *
 * Boundary: keys must match `AGENT_ACTIONS` names and values must be keys of `AGENT_MARKS` (a test enforces both). A
 * destination missing here — every client from `agents.custom` — keeps the glyph for its kind.
 * @type {Record<string, string>} Brand key by agent id.
 */
export const AGENT_MARK_BRANDS = {
    'codex-app': 'codex',
    'claude-app': 'claude',
    'cursor-app': 'cursor',
    'grok-build': 'grok',
    'antigravity-ide': 'antigravity-ide',
    antigravity: 'antigravity',
};

/**
 * Selector for the icon slots that show `brand`'s mark.
 * @param {string} brand Brand key. @param {Record<string, string>} brands Brand key by agent id.
 * @returns {string} Selector list; empty when no destination uses the brand.
 */
function slotSelector(brand, brands) {
    return Object.keys(brands)
        .filter((agent) => brands[agent] === brand)
        .map((agent) => `.cii-agent-kind[data-agent="${agent}"]`)
        .join(',');
}

/**
 * agentIconsStyle(marks, brands): CSS that paints destination icon slots (`.cii-agent-kind`) with brand marks.
 *
 * Purpose: each mark becomes a `--cii-mark-<brand>` custom property (the full `url(…) center/contain no-repeat`
 * shorthand) plus one rule per brand keyed on the slot's `data-agent`; destinations that share a brand share the rule.
 * Full-colour `image` marks replace the slot's mask with a background; single-colour `mask` marks keep the mask and
 * paint it with the theme's text colour (system text colour under forced colours), so a selected row's accent tint
 * never recolours a logo. Selectors carry two classes' weight, which beats the kind glyphs and the forced-colours slot
 * reset.
 * Boundary: pure; must be composed after DESTINATION_STYLE. Mark SVGs must be free of double quotes. Brands no
 * destination uses produce a property but no rule.
 *
 * @param {Record<string, { image?: string, mask?: string }>} marks Marks keyed by brand (normally `AGENT_MARKS`).
 * @param {Record<string, string>} [brands] Brand key by agent id; defaults to `AGENT_MARK_BRANDS`.
 * @returns {string} CSS text.
 */
export function agentIconsStyle(marks, brands = AGENT_MARK_BRANDS) {
    const properties = [];
    const rules = [];
    const monochrome = [];
    for (const [brand, mark] of Object.entries(marks)) {
        properties.push(`--cii-mark-${brand}:${svgDataUri(mark.image ?? mark.mask)} center/contain no-repeat;`);
        const selector = slotSelector(brand, brands);
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
 * Brand-mark stylesheet for the destination picker, composed after DESTINATION_STYLE.
 *
 * Boundary: generated at module load (like ICONS_STYLE), so it is intentionally absent from the build's CSS-template
 * minifier list.
 * @type {string} CSS text.
 */
export const AGENT_ICONS_STYLE = agentIconsStyle(AGENT_MARKS);
