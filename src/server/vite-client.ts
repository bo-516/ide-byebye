/**
 * Recognize Vite's own browser client module so the inspector can ride on it.
 *
 * Purpose: every Vite dev page loads `/@vite/client` — SPAs through `index.html`, and SSR frameworks (Nuxt, SvelteKit,
 * SolidStart, Astro, React Router, Vike, Analog, …) through the HTML they render themselves, which never passes Vite's
 * `transformIndexHtml`. Appending the JS bootstrap to that module is the one injection point all of them share.
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
