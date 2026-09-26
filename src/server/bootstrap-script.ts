import { CLIENT_CONFIG_GLOBAL } from '../shared/constants.js';

/**
 * Build the JavaScript statement that installs the inspector from inside a bundled module.
 *
 * Purpose: HTML injection (`<script>` tags in `index.html`) is not available when an SSR framework renders the page
 * (Next.js, Nuxt, SvelteKit, SolidStart, Astro, …). This statement does the same job from a JS module that the page
 * already loads: publish the client config global, then load the client bundle once.
 *
 * Boundary: safe to evaluate on the server (no-op without `window` / `document`) and idempotent in the browser:
 * - same token already published (HTML injection or an earlier run) → nothing happens;
 * - a different token (inspector server restarted, module hot-reloaded) → the live config object is updated in place,
 *   which a running client follows because it reads token / origin per request;
 * - the client is loaded only when it is not running yet (`window.__CII_INSTALLED__`).
 * `config` and `clientSrc` are embedded as JSON literals, so they must be JSON-serializable; the token lands in dev-only
 * bundled JS, exactly as HTML injection already exposes it to the page.
 *
 * @param {{ config: Record<string, unknown>, clientSrc: string }} input Client config (with `token`) and the absolute
 *   URL of the token-guarded client bundle.
 * @returns {string} A self-contained statement (IIFE) with a leading `;` so it can be appended to any module.
 */
/**
 * Idempotent page-side filter for Vue's "Extraneous non-props attributes" warning.
 *
 * Purpose: a fragment-root component receives `data-insp-path` from its parent and Vue warns.
 * The first three arguments of `console.warn` / `console.error` are inspected; a string containing
 * `data-insp-path` drops that call. `__IDE_BYEBYE_CONSOLE__` makes a second install a no-op.
 *
 * Boundary: no-ops when `window` is missing, so evaluating the bootstrap on the server does not wrap
 * Node's console. Unrelated messages still reach the original method.
 *
 * @returns {string} Statements safe to prepend to an inline script or the bootstrap IIFE.
 */
export function consoleFilterSnippet() {
    return [
        'if (typeof window !== "undefined" && window.console && !window.__IDE_BYEBYE_CONSOLE__) {',
        '  window.__IDE_BYEBYE_CONSOLE__ = 1;',
        '  ["warn", "error"].forEach(function (method) {',
        '    var orig = window.console[method];',
        '    window.console[method] = function () {',
        '      for (var i = 0; i < 3 && i < arguments.length; i++) {',
        '        if (typeof arguments[i] === "string" && arguments[i].indexOf("data-insp-path") !== -1) return;',
        '      }',
        '      return orig.apply(this, arguments);',
        '    };',
        '  });',
        '}',
    ].join('\n');
}

export function buildBootstrapStatement({ config, clientSrc }) {
    return [
        ';(function () {',
        consoleFilterSnippet(),
        "  if (typeof window === 'undefined' || typeof document === 'undefined') return;",
        `  var key = ${JSON.stringify(CLIENT_CONFIG_GLOBAL)};`,
        `  var next = ${JSON.stringify(config)};`,
        '  var prev = window[key];',
        '  if (prev && prev.token === next.token) return;',
        '  if (prev) { for (var k in next) prev[k] = next[k]; } else { window[key] = next; }',
        '  if (window.__CII_INSTALLED__) return;',
        "  var script = document.createElement('script');",
        "  script.type = 'module';",
        `  script.src = ${JSON.stringify(clientSrc)};`,
        '  (document.head || document.documentElement).appendChild(script);',
        '})();',
    ].join('\n');
}
