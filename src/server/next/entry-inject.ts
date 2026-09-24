/**
 * Next.js entry injection: mount the inspector bootstrap without the app writing any code.
 *
 * Purpose: Next renders HTML itself (no bundler HTML hook), so the bootstrap has to arrive through a module the page
 * always loads:
 * - App Router: every file that renders a `<body>` JSX element (root layouts, `global-error`, `global-not-found`, or a
 *   shell component they delegate to) gets `<__IdeByebyeBootstrap />` rendered as the last child of `<body>`. The
 *   bootstrap is a `'use client'` module, so rendering it from a Server Component is what makes the browser load it —
 *   a bare side-effect import would not.
 * - Pages Router: `_app` (or, when the app has no custom `_app`, every page module) gets a side-effect import; those
 *   modules always run in the browser.
 *
 * Boundary: pure string/AST work (the loader supplies fs facts). Edits never move existing code: imports are appended
 * after the last line (ES imports hoist) and the JSX element is inserted immediately before `</body>` on the same line,
 * so every `data-insp-path` line/column stays valid whichever loader order the bundler uses. Idempotent: a module that
 * already references the bootstrap identifier is returned unchanged. Parse failures leave the module untouched so Next
 * reports the user's own syntax error.
 */

import path from 'node:path';
import { parseSync } from 'oxc-parser';
import { walkAst } from '../ast/jsx-locator.js';

/** Local binding for the injected component; unlikely to collide with user code. */
export const BOOTSTRAP_IDENTIFIER = '__IdeByebyeBootstrap';

/** How a module takes part in bootstrap injection. */
export type NextModuleRole =
    | { kind: 'pages', pagesDir: string, name: string }
    | { kind: 'app' }
    | null;

/**
 * Classify a module by its location inside the Next project.
 *
 * Boundary: `node_modules` code is never touched. Only `pages/` and `src/pages/` directly under `projectDir` count as
 * the Pages Router (Next ignores other `pages` folders); `api/` routes and `_document` (server-only) are skipped.
 * Everything else is an App Router candidate — {@link injectNextBootstrap} still requires a `<body>` element there.
 *
 * @param {string} resourcePath Absolute module path.
 * @param {string} projectDir Absolute Next project directory (loader `rootContext`).
 * @returns {NextModuleRole} Role, or `null` when the module must not be modified.
 */
export function classifyNextModule(resourcePath: string, projectDir: string): NextModuleRole {
    if (/[\\/]node_modules[\\/]/.test(resourcePath))
        return null;
    const rel = path.relative(projectDir, resourcePath).split(path.sep).join('/');
    const pagesMatch = /^((?:src\/)?pages)\/(.+)$/.exec(rel);
    if (!pagesMatch)
        return { kind: 'app' };
    const inner = pagesMatch[2];
    const name = path.posix.basename(inner).split('.')[0];
    if (inner.startsWith('api/') || name === '_document')
        return null;
    return { kind: 'pages', pagesDir: path.join(projectDir, pagesMatch[1]), name };
}

/**
 * Relative import specifier from a module to the bootstrap file (POSIX, always `./`- or `../`-prefixed).
 *
 * Boundary: when no relative path exists (different Windows drives) the absolute path is returned with forward
 * slashes, which both Turbopack and webpack resolve.
 *
 * @param {string} fromFile Absolute path of the importing module.
 * @param {string} toFile Absolute path of the bootstrap module.
 * @returns {string} Import specifier.
 */
export function bootstrapSpecifier(fromFile: string, toFile: string) {
    const rel = path.relative(path.dirname(fromFile), toFile);
    if (path.isAbsolute(rel))
        return toFile.split(path.sep).join('/');
    const posix = rel.split(path.sep).join('/');
    // `.intent-inspector/…` starts with a dot but is not relative; only `./` / `../` prefixes are.
    return posix.startsWith('./') || posix.startsWith('../') ? posix : `./${posix}`;
}

/**
 * oxc language for a module that may contain JSX, or `null` when JSX is impossible (`.ts`, `.mts`, `.cts`).
 *
 * @param {string} resourcePath Module path (extension only is used).
 * @returns {'tsx' | 'jsx' | null} Parser language.
 */
function jsxLang(resourcePath: string) {
    const ext = path.extname(resourcePath).toLowerCase();
    if (ext === '.tsx')
        return 'tsx';
    if (ext === '.jsx' || ext === '.js' || ext === '.mjs' || ext === '.cjs')
        return 'jsx';
    return null;
}

/**
 * Offsets of every `</body>` closing tag rendered by a JSX `<body>` element, in source order.
 *
 * @param {string} source Module source.
 * @param {'tsx' | 'jsx'} lang Parser language.
 * @returns {number[] | null} Closing-tag offsets (possibly empty), or `null` when the module does not parse.
 */
function bodyClosingOffsets(source: string, lang: 'tsx' | 'jsx') {
    const result = parseSync(`entry.${lang}`, source, { sourceType: 'module', lang });
    if (Array.isArray(result.errors) && result.errors.length > 0)
        return null;
    const offsets: number[] = [];
    walkAst(result.program, (node: any) => {
        const name = node.type === 'JSXElement' ? node.openingElement?.name : null;
        if (name?.type === 'JSXIdentifier' && name.name === 'body' && node.closingElement)
            offsets.push(node.closingElement.start);
    });
    return offsets.sort((a, b) => a - b);
}

/**
 * Inject the bootstrap into one Next module when its role calls for it.
 *
 * @param {object} input
 * @param {string} input.source Module source as seen by the loader.
 * @param {string} input.resourcePath Absolute module path.
 * @param {string} input.projectDir Absolute Next project directory.
 * @param {string} input.bootstrapFile Absolute path of the generated `'use client'` bootstrap module.
 * @param {(pagesDir: string) => boolean} input.hasCustomApp Whether that pages directory has an `_app` module; only
 *   called for Pages Router modules. Answering wrongly either skips injection (no custom `_app` → nothing mounts) or
 *   injects into every page (harmless: the bootstrap is a shared, idempotent module).
 * @returns {string | null} Rewritten source, or `null` when the module is left unchanged.
 */
export function injectNextBootstrap({ source, resourcePath, projectDir, bootstrapFile, hasCustomApp }) {
    if (!bootstrapFile || typeof source !== 'string' || source.includes(BOOTSTRAP_IDENTIFIER))
        return null;
    const role = classifyNextModule(resourcePath, projectDir);
    if (!role)
        return null;
    const specifier = JSON.stringify(bootstrapSpecifier(resourcePath, bootstrapFile));
    if (role.kind === 'pages') {
        if (hasCustomApp(role.pagesDir) && role.name !== '_app')
            return null;
        // Side-effect import, tagged with the identifier in a comment so the idempotency check above still holds.
        return `${source}\n;import ${specifier}; /* ${BOOTSTRAP_IDENTIFIER} */\n`;
    }
    const lang = jsxLang(resourcePath);
    if (!lang || !source.includes('<body'))
        return null;
    const offsets = bodyClosingOffsets(source, lang);
    if (!offsets || offsets.length === 0)
        return null;
    let out = source;
    for (let i = offsets.length - 1; i >= 0; i -= 1)
        out = `${out.slice(0, offsets[i])}<${BOOTSTRAP_IDENTIFIER} />${out.slice(offsets[i])}`;
    return `${out}\n;import ${BOOTSTRAP_IDENTIFIER} from ${specifier};\n`;
}
