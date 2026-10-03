/**
 * Google's Antigravity glyph: the inner markup of its 24×24 mark (no `<svg>` wrapper; source and trademark notes are on
 * {@link AGENT_MARKS}). Both Antigravity launchers show it, each on its own tile via {@link appTile}.
 *
 * Boundary: its mask and filter ids are only unique within one document, so embed it at most once per SVG document.
 * @type {string} SVG fragment with single-quoted attributes.
 */
const ANTIGRAVITY_GLYPH = "<mask height='23' id='a0' maskUnits='userSpaceOnUse' width='24' x='0' y='1'><path d='M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z' fill='#fff'/></mask><g mask='url(#a0)'><g filter='url(#a1)'><path d='M-1.018-3.992c-.408 3.591 2.686 6.89 6.91 7.37 4.225.48 7.98-2.043 8.387-5.633.408-3.59-2.686-6.89-6.91-7.37-4.225-.479-7.98 2.043-8.387 5.633z' fill='#FFE432'/></g><g filter='url(#a2)'><path d='M15.269 7.747c1.058 4.557 5.691 7.374 10.348 6.293 4.657-1.082 7.575-5.653 6.516-10.21-1.058-4.556-5.691-7.374-10.348-6.292-4.657 1.082-7.575 5.653-6.516 10.21z' fill='#FC413D'/></g><g filter='url(#a3)'><path d='M-12.443 10.804c1.338 4.703 7.36 7.11 13.453 5.378 6.092-1.733 9.947-6.95 8.61-11.652C8.282-.173 2.26-2.58-3.833-.848-9.925.884-13.78 6.1-12.443 10.804z' fill='#00B95C'/></g><g filter='url(#a4)'><path d='M-12.443 10.804c1.338 4.703 7.36 7.11 13.453 5.378 6.092-1.733 9.947-6.95 8.61-11.652C8.282-.173 2.26-2.58-3.833-.848-9.925.884-13.78 6.1-12.443 10.804z' fill='#00B95C'/></g><g filter='url(#a5)'><path d='M-7.608 14.703c3.352 3.424 9.126 3.208 12.896-.483 3.77-3.69 4.108-9.459.756-12.883C2.69-2.087-3.083-1.871-6.853 1.82c-3.77 3.69-4.108 9.458-.755 12.883z' fill='#00B95C'/></g><g filter='url(#a6)'><path d='M9.932 27.617c1.04 4.482 5.384 7.303 9.7 6.3 4.316-1.002 6.971-5.448 5.93-9.93-1.04-4.483-5.384-7.304-9.7-6.301-4.316 1.002-6.971 5.448-5.93 9.93z' fill='#3186FF'/></g><g filter='url(#a7)'><path d='M2.572-8.185C.392-3.329 2.778 2.472 7.9 4.771c5.122 2.3 11.042.227 13.222-4.63 2.18-4.855-.205-10.656-5.327-12.955-5.122-2.3-11.042-.227-13.222 4.63z' fill='#FBBC04'/></g><g filter='url(#a8)'><path d='M-3.267 38.686c-5.277-2.072 3.742-19.117 5.984-24.83 2.243-5.712 8.34-8.664 13.616-6.592 5.278 2.071 11.533 13.482 9.29 19.195-2.242 5.713-23.613 14.298-28.89 12.227z' fill='#3186FF'/></g><g filter='url(#a9)'><path d='M28.71 17.471c-1.413 1.649-5.1.808-8.236-1.878-3.135-2.687-4.531-6.201-3.118-7.85 1.412-1.649 5.1-.808 8.235 1.878s4.532 6.2 3.119 7.85z' fill='#749BFF'/></g><g filter='url(#a10)'><path d='M18.163 9.077c5.81 3.93 12.502 4.19 14.946.577 2.443-3.612-.287-9.727-6.098-13.658-5.81-3.931-12.502-4.19-14.946-.577-2.443 3.612.287 9.727 6.098 13.658z' fill='#FC413D'/></g><g filter='url(#a11)'><path d='M-.915 2.684c-1.44 3.473-.97 6.967 1.05 7.804 2.02.837 4.824-1.3 6.264-4.772 1.44-3.473.97-6.967-1.05-7.804-2.02-.837-4.824 1.3-6.264 4.772z' fill='#FFEE48'/></g></g><defs><filter filterUnits='userSpaceOnUse' height='17.587' id='a1' width='19.838' x='-3.288' y='-11.917'><feGaussianBlur stdDeviation='1.117'/></filter><filter filterUnits='userSpaceOnUse' height='38.565' id='a2' width='38.9' x='4.251' y='-13.493'><feGaussianBlur stdDeviation='5.4'/></filter><filter filterUnits='userSpaceOnUse' height='36.517' id='a3' width='40.955' x='-21.889' y='-10.592'><feGaussianBlur stdDeviation='4.591'/></filter><filter filterUnits='userSpaceOnUse' height='36.517' id='a4' width='40.955' x='-21.889' y='-10.592'><feGaussianBlur stdDeviation='4.591'/></filter><filter filterUnits='userSpaceOnUse' height='36.595' id='a5' width='36.632' x='-19.099' y='-10.278'><feGaussianBlur stdDeviation='4.591'/></filter><filter filterUnits='userSpaceOnUse' height='34.087' id='a6' width='33.533' x='.981' y='8.758'><feGaussianBlur stdDeviation='4.363'/></filter><filter filterUnits='userSpaceOnUse' height='35.276' id='a7' width='35.978' x='-6.143' y='-21.659'><feGaussianBlur stdDeviation='3.954'/></filter><filter filterUnits='userSpaceOnUse' height='46.523' id='a8' width='45.114' x='-11.96' y='-.46'><feGaussianBlur stdDeviation='3.531'/></filter><filter filterUnits='userSpaceOnUse' height='24.054' id='a9' width='25.094' x='10.485' y='.58'><feGaussianBlur stdDeviation='3.159'/></filter><filter filterUnits='userSpaceOnUse' height='30.007' id='a10' width='33.508' x='5.833' y='-12.467'><feGaussianBlur stdDeviation='2.669'/></filter><filter filterUnits='userSpaceOnUse' height='26.151' id='a11' width='22.194' x='-8.355' y='-8.876'><feGaussianBlur stdDeviation='3.303'/></filter></defs>";

/**
 * appTile(fill, edge, glyph): a mark drawn as a small app icon — `glyph` on a rounded square tile.
 *
 * Why: Antigravity and Antigravity IDE ship the same glyph and differ only in their app tiles (light for Antigravity,
 * dark for the IDE), so the tile is what tells their rows apart. The tile keeps a 1-unit margin in the 24-unit box so
 * it reads the same size as the bare glyphs beside it, and the glyph is scaled and raised slightly, as on the app icons.
 * A hairline in `edge` keeps a light tile visible on a light menu and a dark tile on a dark menu.
 * Boundary: `fill` and `edge` must be static colours and `glyph` the inner markup of a 24×24 mark with single-quoted
 * attributes — never page data — because the result lands in a double-quoted CSS `url()`.
 *
 * @param {string} fill Tile colour.
 * @param {string} edge Hairline colour, drawn at 12% opacity; use the opposite of `fill`.
 * @param {string} glyph Inner markup of a 24×24 mark, such as {@link ANTIGRAVITY_GLYPH}.
 * @returns {string} Complete SVG document for an `image` mark.
 */
function appTile(fill: string, edge: string, glyph: string): string {
    return "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>"
        + `<rect x='1.5' y='1.5' width='21' height='21' rx='4.95' fill='${fill}' stroke='${edge}' stroke-opacity='.12'/>`
        + `<g transform='translate(3.12 2.57) scale(.74)'>${glyph}</g></svg>`;
}

/**
 * Destination marks: each vendor's own logo as published, shown in the destination picker by `agent-icons.ts`.
 *
 * Source: the glyphs come from @lobehub/icons (MIT, © 2023 LobeHub), a collection of AI vendors' published logos. They
 * are only re-encoded for embedding: the Codex app tile is dropped so its mark is a bare glyph, and Antigravity's
 * no-op filter steps are dropped and its ids shortened. Antigravity and Antigravity IDE share that glyph, so their marks
 * put it back on each app's own tile ({@link appTile}): light for Antigravity, dark for the IDE, as on their app icons.
 * Claude App and Claude Code CLI use Anthropic's two product marks (the Claude spark and the Claude Code pixel mark),
 * which is what tells those rows apart. The logos are trademarks of OpenAI (Codex), Anthropic (Claude, Claude Code),
 * Anysphere (Cursor), xAI (Grok), Google (Antigravity) and OpenCode's authors (OpenCode); they are shown only to
 * identify where a prompt is sent.
 * Boundary: complete SVG documents with single-quoted attributes only, because they are embedded in a double-quoted CSS
 * `url("data:…")`; never interpolate page data into them. `image` marks keep the vendor's colours in both themes;
 * `mask` marks are single-colour logos that the stylesheet paints with the theme's text colour, so they turn white in
 * dark mode like the vendors' reversed logos.
 *
 * @type {Record<string, { image: string, mask?: string } | { mask: string, image?: string }>} Marks keyed by brand
 *   (see `AGENT_MARK_BRANDS`). Each entry has `image` or `mask`, so `image ?? mask` is a string at runtime.
 */
export type AgentMark = { image: string; mask?: string } | { mask: string; image?: string };

export const AGENT_MARKS: Record<string, AgentMark> = {
    codex: {
        image: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><defs><linearGradient id='g' x1='12' y1='0' x2='12' y2='24' gradientUnits='userSpaceOnUse'><stop stop-color='#B1A7FF'/><stop offset='.5' stop-color='#7A9DFF'/><stop offset='1' stop-color='#3941FF'/></linearGradient></defs><path fill='url(#g)' fill-rule='evenodd' d='M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z'/></svg>",
    },
    claude: {
        image: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='#D97757' d='M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z'/></svg>",
    },
    cursor: {
        mask: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill-rule='evenodd' d='M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z'/></svg>",
    },
    'claude-code': {
        image: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill='#D97757' fill-rule='evenodd' clip-rule='evenodd' d='M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z'/></svg>",
    },
    opencode: {
        mask: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill-rule='evenodd' d='M16 6H8v12h8V6zm4 16H4V2h16v20z'/></svg>",
    },
    grok: {
        mask: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path fill-rule='evenodd' d='M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815'/></svg>",
    },
    antigravity: {
        image: appTile('#ffffff', '#000000', ANTIGRAVITY_GLYPH),
    },
    'antigravity-ide': {
        image: appTile('#1d1e22', '#ffffff', ANTIGRAVITY_GLYPH),
    },
};
