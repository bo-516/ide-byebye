/**
 * Recognize Vite's own browser client module so the inspector can ride on it.
 *
 * Purpose: Vite's browser client is the injection point when HTML never passes `transformIndexHtml`
 * (SvelteKit, SolidStart, Astro, React Router, Vike, Analog, …). Those pages request `/@vite/client`.
 * Nuxt serves the same module at `/_nuxt/@vite/client`. The match is the file path, not that URL.
 *
 * Boundary: matches by resolved file path (`…vite/dist/client/client.mjs`, including forks published as
 * `rolldown-vite`, plus the full-bundle-mode `bundledDevClient.mjs`). Query strings and Windows separators are
 * normalized first. Any other id — including user modules that happen to be named `client.mjs` — returns `false`.
 *
 * @param {string} id Vite module id (resolved path, possibly with `?query`).
 * @returns {boolean} `true` only for Vite's browser client entry.
 */
export function isViteClientModule(id) {
    const clean = String(id ?? '').split('?')[0].replace(/\\/g, '/');
    return /vite\/dist\/client\/(?:client|bundledDevClient)\.mjs$/.test(clean);
}
