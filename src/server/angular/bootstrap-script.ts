import { CLIENT_CONFIG_GLOBAL, ENDPOINTS } from '../../shared/constants.js';

/**
 * Package-relative path of the generated Angular bootstrap script (written by the build, listed in `angular.json`).
 */
export const ANGULAR_BOOTSTRAP_SCRIPT = 'dist/angular/bootstrap.js';

/**
 * Source of the classic script Angular apps add to their development `scripts`.
 *
 * Purpose: Angular CLI concatenates global scripts as classic scripts, so this must be self-contained (no imports, no
 * module syntax). It holds no secret: it asks the dev server — which proxies to the inspector via `angularProxy` — for
 * the session config same-origin, publishes it, and loads the client bundle.
 *
 * Boundary: inert when the proxy is missing (the dev server answers with its HTML fallback: a one-line setup hint is
 * logged) and when a config is already published. Never throws into the app.
 *
 * @returns {string} JavaScript source for `dist/angular/bootstrap.js`.
 */
export function buildAngularBootstrapScript() {
    const hint = '[code-intent-inspector] Angular bootstrap: no inspector session. Add the ide-byebye proxyConfig to `ng serve` (see README).';
    return [
        '/* ide-byebye: Angular dev bootstrap. Add to the development "scripts" in angular.json; inert without angularProxy(). */',
        '(function () {',
        `  var key = ${JSON.stringify(CLIENT_CONFIG_GLOBAL)};`,
        "  if (typeof window === 'undefined' || window[key] || typeof fetch !== 'function') return;",
        `  fetch(${JSON.stringify(ENDPOINTS.session)}, { credentials: 'same-origin', headers: { Accept: 'application/json' } })`,
        '    .then(function (res) {',
        "      var type = res.headers.get('content-type') || '';",
        "      if (res.ok && type.indexOf('json') !== -1) return res.json();",
        `      console.warn(${JSON.stringify(hint)});`,
        '      return null;',
        '    })',
        '    .then(function (session) {',
        '      if (!session || !session.config || window[key]) return;',
        '      window[key] = session.config;',
        "      var script = document.createElement('script');",
        "      script.type = 'module';",
        '      script.src = session.clientSrc;',
        '      (document.head || document.documentElement).appendChild(script);',
        '    })',
        '    .catch(function () { /* inspector unavailable: stay silent */ });',
        '})();',
        '',
    ].join('\n');
}
