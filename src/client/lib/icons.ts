/**
 * Stroke geometry for every icon the inspector UI draws, on a 24×24 grid (round caps and joins, 2px stroke).
 *
 * Boundary: bodies are static SVG fragments that use single-quoted attributes only, so they can be embedded both in
 * inline markup and in a double-quoted CSS `url("data:…")`. A shape that must be filled sets `fill`/`stroke` itself;
 * everything else inherits the stroke from {@link svgDocument}. Never interpolate page or user data into these strings —
 * {@link iconSvg} output is assigned through `innerHTML`.
 *
 * @type {Record<string, string>} SVG child markup keyed by icon name.
 */
const ICON_PATHS: Record<string, string> = {
    x: "<path d='M17 7 7 17M7 7l10 10'/>",
    check: "<path d='m5 12.5 4.5 4.5L19 7.5'/>",
    'chevron-down': "<path d='m7 10 5 5 5-5'/>",
    at: "<circle cx='12' cy='12' r='3.6'/><path d='M15.6 8.4v4.5a2.7 2.7 0 0 0 5.4 0V12a9 9 0 1 0-3.5 7.1'/>",
    capture: "<path d='M4 8.5v-2A2.5 2.5 0 0 1 6.5 4h2M15.5 4h2A2.5 2.5 0 0 1 20 6.5v2M20 15.5v2a2.5 2.5 0 0 1-2.5 2.5h-2M8.5 20h-2A2.5 2.5 0 0 1 4 17.5v-2'/><rect x='8' y='8.5' width='8' height='7' rx='1.5'/>",
    palette: "<path d='M12 3.5a8.5 8.5 0 1 0 0 17c1.1 0 1.7-.8 1.7-1.7 0-.45-.17-.83-.45-1.12a1.6 1.6 0 0 1-.43-1.1c0-.95.77-1.72 1.72-1.72h2.03A3.93 3.93 0 0 0 20.5 11c0-4.14-3.8-7.5-8.5-7.5Z'/><circle cx='7.75' cy='11.25' r='1.15' fill='black' stroke='none'/><circle cx='9.75' cy='7.5' r='1.15' fill='black' stroke='none'/><circle cx='14.25' cy='7.5' r='1.15' fill='black' stroke='none'/><circle cx='17' cy='10.75' r='1.15' fill='black' stroke='none'/>",
    copy: "<rect x='8.5' y='8.5' width='12' height='12' rx='2.5'/><path d='M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5'/>",
    pin: "<path d='M9 3.5h6M10 3.5v5.2l-2.6 3.1a1.5 1.5 0 0 0-.4 1V14h10v-.7a1.5 1.5 0 0 0-.4-1L14 8.7V3.5M12 14v6.5'/>",
    code: "<path d='m8.5 7.5-4.5 4.5 4.5 4.5M15.5 7.5l4.5 4.5-4.5 4.5M13.5 5l-3 14'/>",
    plus: "<path d='M12 5.5v13M5.5 12h13'/>",
    refresh: "<path d='M19.5 12a7.5 7.5 0 0 1-13.3 4.8M4.5 12a7.5 7.5 0 0 1 13.3-4.8M18.5 3.5v4h-4M5.5 20.5v-4h4'/>",
    'corner-down-right': "<path d='M5 4.5v6a4 4 0 0 0 4 4h10M15 10.5l4 4-4 4'/>",
    search: "<circle cx='11' cy='11' r='6.5'/><path d='m20 20-4.2-4.2'/>",
    play: "<path d='M9 7.2v9.6a.8.8 0 0 0 1.2.7l7.6-4.8a.8.8 0 0 0 0-1.4l-7.6-4.8a.8.8 0 0 0-1.2.7Z' fill='black' stroke='none'/>",
    'arrow-up': "<path d='M12 19V5.5M6 11.5l6-6 6 6'/>",
    'chevron-right': "<path d='m10 7 5 5-5 5'/>",
    'chevron-left': "<path d='m14 7-5 5 5 5'/>",
    record: "<circle cx='12' cy='12' r='8'/><circle cx='12' cy='12' r='3.6' fill='black' stroke='none'/>",
    app: "<rect x='3.5' y='4.5' width='17' height='15' rx='3'/><path d='M3.5 9h17'/>",
    ide: "<rect x='3.5' y='4.5' width='17' height='15' rx='3'/><path d='m10 10-2.5 2.5L10 15M14 10l2.5 2.5L14 15'/>",
    terminal: "<rect x='3.5' y='4.5' width='17' height='15' rx='3'/><path d='m7.5 10 2.5 2.5L7.5 15M12.5 15.5h4'/>",
    custom: "<path d='M9 3.5v4M15 3.5v4M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0zM12 16v4.5'/>",
};

/**
 * Icons exposed to the stylesheet as `--cii-mask-<name>` custom properties.
 * Boundary: a name missing here can still be used inline via {@link iconSvg}, but CSS referencing its mask property
 * would resolve to nothing and paint an empty box.
 */
const MASK_ICONS = Object.keys(ICON_PATHS);

/**
 * Wrap icon geometry in a standalone SVG document.
 *
 * @param {string} body Child markup from {@link ICON_PATHS}.
 * @param {string} stroke Stroke colour; masks only read alpha, so black is the neutral default.
 * @param {string} [extra] Extra attributes for the root element (size, class, aria).
 * @returns {string} SVG markup.
 */
function svgDocument(body: string, stroke: string, extra = ''): string {
    return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${stroke}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'${extra}>${body}</svg>`;
}

/**
 * Encode an SVG document as a CSS `url("data:…")` value.
 *
 * Purpose: escapes only the characters that would end the data URI early (`#`, `%`) or confuse parsers (`<`, `>`),
 * so the generated stylesheet stays compact and readable in DevTools.
 * Boundary: the SVG must not contain double quotes (they would close the CSS string); {@link ICON_PATHS} guarantees
 * that. The result is safe to place in a declaration value or a custom property.
 *
 * @param {string} svg SVG markup.
 * @returns {string} CSS `url()` token.
 */
export function svgDataUri(svg: string): string {
    const encoded = svg.replace(/[%#<>]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return `url("data:image/svg+xml,${encoded}")`;
}

/**
 * Inline SVG markup for one icon, stroked with `currentColor` so the surrounding control decides its tint.
 *
 * Boundary: `name` must be a key of {@link ICON_PATHS}; an unknown name returns an empty string (an invisible, but
 * harmless, button face). The markup is decorative (`aria-hidden`), so the host control must carry its own label.
 *
 * @param {string} name Icon name.
 * @param {number} [size=16] Rendered width and height in CSS pixels.
 * @returns {string} SVG markup for `innerHTML`.
 */
export function iconSvg(name: string, size = 16): string {
    const body = ICON_PATHS[name];
    if (!body)
        return '';
    return svgDocument(body, 'currentColor', ` width='${size}' height='${size}' aria-hidden='true' focusable='false'`);
}

/**
 * Build the `:host` block declaring one mask custom property per icon.
 *
 * Purpose: components paint an icon with `background: currentColor` through `mask: var(--cii-mask-<name>)`, which keeps
 * every glyph theme-aware without per-colour image variants and without changing any component's DOM.
 * Boundary: each property holds the full mask shorthand (`url(...) center / contain no-repeat`), so consumers must use
 * it as the entire `mask`/`-webkit-mask` value, not as a bare image.
 *
 * @returns {string} CSS text.
 */
function buildIconStyle() {
    const declarations = MASK_ICONS
        .map((name) => `--cii-mask-${name}:${svgDataUri(svgDocument(ICON_PATHS[name], 'black'))} center/contain no-repeat;`)
        .join('');
    // The search glyph sits in an <input> background, which cannot be masked; a mid grey reads in both themes.
    const searchImage = `--cii-image-search:${svgDataUri(svgDocument(ICON_PATHS.search, '#8e8e99'))};`;
    return `:host{${declarations}${searchImage}}`;
}

/**
 * Icon custom properties composed into the shadow-root stylesheet.
 *
 * Boundary: generated at module load from compact static strings rather than written as a CSS template literal, so it
 * is intentionally absent from the build's CSS-template minifier list (there is no whitespace to strip). Must be
 * composed before any fragment that reads `--cii-mask-*` or `--cii-image-*`.
 *
 * @type {string} CSS text.
 */
export const ICONS_STYLE = buildIconStyle();
