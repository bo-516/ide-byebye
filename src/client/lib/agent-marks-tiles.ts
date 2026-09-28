/**
 * Redrawn destination marks: one family of app-style tiles whose colours and shapes follow each vendor's logo — the
 * second of the two icon families under review (see `agent-icons.ts`).
 *
 * Purpose: every destination shares one silhouette (a continuous-corner tile with a soft top sheen), so the menu reads
 * as a single set, while each tile keeps its vendor's colour and the gist of its mark: Codex's prompt cloud on its
 * violet-to-blue gradient, Claude's spark on terracotta, Cursor's cube on graphite, Grok's split ring on black, and
 * Antigravity's arch on Google's colours. Custom clients get a neutral tile with the generic plug.
 * Boundary: pure string building at module load. Every document uses single-quoted attributes only, because it is
 * embedded in a double-quoted CSS `url("data:…")`. Gradient ids only need to be unique within one document, since
 * each mark is rendered as its own image.
 */

/** Round to two decimals so generated path data stays short. @param {number} value Coordinate. @returns {number} */
const round = (value) => Math.round(value * 100) / 100;

/**
 * Continuous-curvature rounded square ("squircle") centred on the 24-unit grid, built from the common three-cubic
 * approximation of iOS corners.
 *
 * @param {number} size Side length; the square is centred at 12,12.
 * @param {number} radius Corner radius; must stay below `size / 3` or neighbouring corners overlap.
 * @returns {string} Closed path data.
 */
function squircle(size, radius) {
    const [a, b, c, d, e, f, g] = [1.528665, 1.08849296, 0.86840694, 0.63149379, 0.07491139, 0.37282383, 0.16905956]
        .map((k) => k * radius);
    const h = size / 2;
    // The top-right corner relative to the centre, from the top edge down to the right edge; the other three corners
    // are the same points turned by quarter turns (clockwise on screen: (u, v) -> (-v, u)).
    const corner = [[h - a, -h], [h - b, -h], [h - c, -h], [h - d, e - h], [h - f, g - h], [h - g, f - h],
        [h - e, d - h], [h, c - h], [h, b - h], [h, a - h]];
    const turn = ([u, v], times) => (times ? turn([-v, u], times - 1) : [u, v]);
    let path = '';
    for (let quarter = 0; quarter < 4; quarter += 1) {
        const [start, ...curve] = corner.map((point) => turn(point, quarter)).map(([u, v]) => `${round(12 + u)} ${round(12 + v)}`);
        path += `${quarter ? 'L' : 'M'}${start}C${curve.join(' ')}`;
    }
    return `${path}Z`;
}

/** Tile outline shared by every mark. */
const TILE = squircle(24, 5.4);

/** Hairline just inside the tile edge; keeps dark tiles from melting into a dark menu. */
const RIM = `<path d='${squircle(23.4, 5.2)}' fill='none' stroke='#fff' stroke-opacity='.16' stroke-width='.6'/>`;

/** Soft light falling on the top half of every tile. */
const SHEEN = "<linearGradient id='s' x1='12' y1='0' x2='12' y2='24' gradientUnits='userSpaceOnUse'>"
    + "<stop stop-color='#fff' stop-opacity='.18'/><stop offset='.55' stop-color='#fff' stop-opacity='0'/></linearGradient>";

/**
 * Top-to-bottom gradient on the tile grid.
 * @param {string} id Gradient id. @param {string[]} colors Two or more stops, spread evenly. @returns {string} Markup.
 */
function vertical(id, colors) {
    const stops = colors.map((color, index) => `<stop offset='${round(index / (colors.length - 1))}' stop-color='${color}'/>`);
    return `<linearGradient id='${id}' x1='12' y1='0' x2='12' y2='24' gradientUnits='userSpaceOnUse'>${stops.join('')}</linearGradient>`;
}

/**
 * Assemble one tile document: the base paint layers, the sheen, then the glyph on top.
 *
 * @param {string | string[]} fills Base paint, bottom first (colours or `url(#id)` defined in `defs`).
 * @param {string} defs Gradient definitions the fills or glyph refer to.
 * @param {string} glyph Glyph markup drawn over the tile.
 * @returns {string} Complete SVG document.
 */
function tile(fills, defs, glyph) {
    const base = [fills].flat().map((fill) => `<path d='${TILE}' fill='${fill}'/>`).join('');
    return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><defs>${defs}${SHEEN}</defs>`
        + `${base}<path d='${TILE}' fill='url(#s)'/>${glyph}</svg>`;
}

/** Codex: white six-lobed cloud with the prompt cut back into the tile's violet-to-blue gradient. @returns {string} */
function codexTile() {
    const lobes = [0, 60, 120, 180, 240, 300].map((degrees) => {
        const angle = (degrees * Math.PI) / 180;
        return `<circle cx='${round(12 + 4.1 * Math.cos(angle))}' cy='${round(12 + 3.75 * Math.sin(angle))}' r='3.3'/>`;
    });
    const prompt = "<path d='M8.9 9.75 11.15 12 8.9 14.25M12.85 14.4h2.6' fill='none' stroke='url(#g)' stroke-width='1.75'"
        + " stroke-linecap='round' stroke-linejoin='round'/>";
    return tile('url(#g)', vertical('g', ['#B1A7FF', '#7A9DFF', '#3941FF']),
        `<g fill='#fff'>${lobes.join('')}<circle cx='12' cy='12' r='4.6'/></g>${prompt}`);
}

/** Claude spark rays as [length, angle offset in degrees]: twelve rays, deliberately uneven like the original. */
const CLAUDE_RAYS = [[7.3, 0], [5.5, 5], [6.7, -4], [5.1, 3], [7.5, -2], [5.9, 6], [6.9, -5], [5.3, 2], [7.1, 4],
    [5.7, -3], [6.5, 5], [5.2, -6]];

/** Claude: ivory spark of tapered, round-tipped rays on terracotta. @returns {string} */
function claudeTile() {
    const rays = CLAUDE_RAYS.map(([length, offset], index) => {
        const angle = ((index * 30 - 90 + offset) * Math.PI) / 180;
        const [ux, uy, nx, ny] = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle)];
        const [base, tip] = [1.05, 0.72];
        const [tx, ty] = [12 + ux * length, 12 + uy * length];
        return `M${round(12 + nx * base)} ${round(12 + ny * base)}L${round(tx + nx * tip)} ${round(ty + ny * tip)}`
            + `A${tip} ${tip} 0 0 0 ${round(tx - nx * tip)} ${round(ty - ny * tip)}L${round(12 - nx * base)} ${round(12 - ny * base)}Z`;
    });
    return tile('#D97757', '', `<path fill='#FFF8F1' d='${rays.join('')}'/><circle cx='12' cy='12' r='1.7' fill='#FFF8F1'/>`);
}

/** Cursor: hexagonal cube shaded in three greys, its pointer facet cut back to the graphite tile. @returns {string} */
function cursorTile() {
    const vertex = (degrees) => {
        const angle = (degrees * Math.PI) / 180;
        return `${round(12 + 7.5 * Math.cos(angle))} ${round(12.1 + 7.5 * Math.sin(angle))}`;
    };
    const [top, upperRight, lowerRight, bottom, lowerLeft, upperLeft] = [-90, -30, 30, 90, 150, 210].map(vertex);
    const centre = '12 12.1';
    const face = (points, color) => `<path fill='${color}' d='M${points.join('L')}Z'/>`;
    return tile('url(#g)', vertical('g', ['#34343A', '#111113']), face([top, upperRight, upperLeft], '#FAFAFA')
        + face([upperLeft, centre, bottom, lowerLeft], '#C4C4CB') + face([upperRight, lowerRight, bottom], '#85858F')
        + face([upperLeft, upperRight, bottom, centre], '#26262B') + RIM);
}

/** Grok: two offset half-rings split by a long tapered slash, white on black. @returns {string} */
function grokTile() {
    const [radius, gap] = [5.2, 22];
    const point = (centre, degrees) => {
        const angle = (degrees * Math.PI) / 180;
        return `${round(centre + radius * Math.cos(angle))} ${round(centre + radius * Math.sin(angle))}`;
    };
    const arc = (centre, from, to) => `M${point(centre, from)}A${radius} ${radius} 0 0 1 ${point(centre, to)}`;
    const ring = `<path d='${arc(11.55, 135 + gap, 315 - gap)}${arc(12.45, gap - 45, 135 - gap)}' fill='none' stroke='#fff'`
        + " stroke-width='1.9' stroke-linecap='round'/>";
    const slash = "<path fill='#fff' d='M19.9 4.1 12.7 12.3 11.7 11.3ZM4.1 19.9 11.3 11.7 12.3 12.7Z'/>";
    return tile('url(#g)', vertical('g', ['#2A2A2E', '#050505']), ring + slash + RIM);
}

/** Antigravity: white arch over a soft mesh of Google's blue, green, yellow and red. @returns {string} */
function antigravityTile() {
    const glow = (id, x, y, r, color) => `<radialGradient id='${id}' cx='${x}' cy='${y}' r='${r}' gradientUnits='userSpaceOnUse'>`
        + `<stop stop-color='${color}'/><stop offset='1' stop-color='${color}' stop-opacity='0'/></radialGradient>`;
    const arch = "<path fill='#fff' d='M5.2 18.3C8.3 15.6 8.1 5.6 12 5.6S15.7 15.6 18.8 18.3c.8.7.1 1.6-.9 1.1-3.2-2-2.9-6.2"
        + "-5.9-6.2s-2.7 4.2-5.9 6.2c-1 .5-1.7-.4-.9-1.1Z'/>";
    return tile(['#3186FF', 'url(#n)', 'url(#y)', 'url(#r)'],
        glow('n', -1, 17, 12, '#00B95C') + glow('y', 6, 1, 13, '#FFD83A') + glow('r', 23, 5, 12, '#FC413D'), arch);
}

/** Custom clients: the generic plug on a neutral grey tile. @returns {string} */
function customTile() {
    return tile('url(#g)', vertical('g', ['#9A9AA6', '#62626E']), "<path d='M9.9 6.9v2.4M14.1 6.9v2.4M8.3 9.3h7.4v1.9a3.7 3.7"
        + " 0 0 1-7.4 0zM12 14.9v2.6' fill='none' stroke='#fff' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/>");
}

/**
 * Redrawn tile marks, keyed by brand like `OFFICIAL_MARKS`, plus `custom` for clients declared in `agents.custom`.
 * @type {Record<string, { image: string }>} Full-colour marks.
 */
export const TILE_MARKS = {
    codex: { image: codexTile() },
    claude: { image: claudeTile() },
    cursor: { image: cursorTile() },
    grok: { image: grokTile() },
    antigravity: { image: antigravityTile() },
    custom: { image: customTile() },
};
