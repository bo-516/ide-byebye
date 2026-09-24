import fs from 'node:fs';
import path from 'node:path';
import { CLIENT_CONFIG_GLOBAL } from '../shared/constants.js';
import { PLUGIN_NAME } from './plugin-runtime.js';

/** Marker so HTML rewrites stay idempotent across rebuilds (the config global is only ever set by our snippet). */
export const CLIENT_BOOTSTRAP_MARKER = `window.${CLIENT_CONFIG_GLOBAL}`;

/**
 * Splice the bootstrap snippet into an HTML document's `<head>` (or prepend when no head exists).
 *
 * @param {string} html Original HTML.
 * @param {string} snippet Script tags to inject.
 * @returns {string} HTML with the inspector bootstrap injected.
 */
export function injectHtmlSnippet(html, snippet) {
    return html.includes('</head>')
        ? html.replace('</head>', `${snippet}</head>`)
        : snippet + html;
}

/**
 * webpack/rspack-style HTML injection via `processAssets` at REPORT stage.
 *
 * Boundary: skips production mode so the inspector never ships. Mutates every emitted `.html` asset.
 *
 * @param {object} compiler webpack/rspack compiler.
 * @param {ReturnType<typeof import('./plugin-runtime.js').createInspectorRuntime>} runtime Shared inspector runtime.
 * @param {'webpack' | 'rspack'} bundler Which code-inspector adapter to register.
 */
export function setupWebpackLikeCompiler(compiler, runtime, bundler) {
    if (!runtime.enabled) {
        return;
    }
    if (compiler?.options?.mode === 'production') {
        return;
    }
    runtime.initPaths(compiler?.context || process.cwd());
    runtime.registerCodeInspectorOnCompiler(compiler, bundler);

    const wp = compiler.webpack || compiler.rspack;
    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
        compilation.hooks.processAssets.tapPromise({
            name: PLUGIN_NAME,
            stage: wp.Compilation.PROCESS_ASSETS_STAGE_REPORT,
        }, async (assets) => {
            const snippet = await runtime.injectionHtml();
            for (const name of Object.keys(assets)) {
                if (!/\.html$/.test(name)) {
                    continue;
                }
                const original = assets[name].source().toString();
                compilation.updateAsset(name, new wp.sources.RawSource(injectHtmlSnippet(original, snippet)));
            }
        });
    });
}

/**
 * Resolve which HTML files the esbuild adapter should rewrite after a build.
 *
 * @param {Record<string, unknown>} options Plugin options; may include `htmlFiles: string[]`.
 * @param {Record<string, unknown>} initialOptions esbuild `BuildOptions`.
 * @param {string} absWorkingDir Absolute working directory for relative paths.
 * @returns {string[]} Absolute HTML file paths (may be empty).
 */
export function resolveEsbuildHtmlTargets(options, initialOptions, absWorkingDir) {
    const listed = Array.isArray(options.htmlFiles) ? options.htmlFiles : [];
    if (listed.length > 0) {
        return listed.map((f) => path.isAbsolute(f) ? f : path.resolve(absWorkingDir, f));
    }
    const outdir = initialOptions.outdir
        ? (path.isAbsolute(initialOptions.outdir)
            ? initialOptions.outdir
            : path.resolve(absWorkingDir, initialOptions.outdir))
        : null;
    if (outdir && fs.existsSync(outdir)) {
        return fs.readdirSync(outdir)
            .filter((name) => name.endsWith('.html'))
            .map((name) => path.join(outdir, name));
    }
    if (initialOptions.outfile) {
        const out = path.isAbsolute(initialOptions.outfile)
            ? initialOptions.outfile
            : path.resolve(absWorkingDir, initialOptions.outfile);
        const sibling = path.join(path.dirname(out), 'index.html');
        return fs.existsSync(sibling) ? [sibling] : [];
    }
    return [];
}
