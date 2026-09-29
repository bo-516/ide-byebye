import fs from 'node:fs';
import path from 'node:path';
import { CLIENT_CONFIG_GLOBAL } from '../shared/constants.js';
import { PLUGIN_NAME } from './plugin-runtime.js';

/** Runtime passed in by the plugin factory. The stamp hook expects a webpack or rspack compiler. */
type InspectorRuntime = ReturnType<typeof import('./plugin-runtime.js').createInspectorRuntime>;

/** Compiler accepted by {@link InspectorRuntime.registerStampOnCompiler}. */
type StampCompiler = Parameters<InspectorRuntime['registerStampOnCompiler']>[0];

/**
 * webpack compilers have `webpack` only; rspack compilers also have `rspack`.
 * The property is optional so both compilers assign. It is only read when `webpack` is missing.
 */
type CompilerWithRspack = StampCompiler & { rspack?: object };

/**
 * Farm `transformHtml` resource, plus the string / `{ html }` / `{ code }` stand-ins tests pass.
 * Boundary: only `bytes` is read or written. The other fields exist so Farm's `Resource` and the test objects assign.
 */
type FarmHtmlResource = {
    bytes?: number[] | null;
    name?: unknown;
    emitted?: unknown;
    html?: unknown;
    code?: unknown;
    resourceType?: unknown;
    origin?: unknown;
    info?: unknown;
};

/** Fields the Farm dev middleware reads off the Koa context. */
type FarmDevContext = {
    type?: unknown;
    path?: unknown;
    body?: unknown;
};

/** One Farm dev middleware. `next` resolves so `await next()` is valid. */
type FarmDevMiddleware = (ctx: FarmDevContext, next: () => Promise<void>) => Promise<void> | void;

/**
 * Minimal Koa app. `use` is accepted so a test double with `middleware: null` still assigns;
 * this hook only unshifts `middleware`.
 */
type FarmDevApp = {
    middleware?: FarmDevMiddleware[] | null;
    use?: () => void;
};

/** Marker so HTML rewrites stay idempotent across rebuilds (the config global is only ever set by our snippet). */
export const CLIENT_BOOTSTRAP_MARKER = `window.${CLIENT_CONFIG_GLOBAL}`;

/**
 * Splice the bootstrap snippet into an HTML document's `<head>` (or prepend when no head exists).
 *
 * @param {string} html Original HTML.
 * @param {string} snippet Script tags to inject.
 * @returns {string} HTML with the inspector bootstrap injected.
 */
export function injectHtmlSnippet(html: string, snippet: string) {
    return html.includes('</head>')
        ? html.replace('</head>', `${snippet}</head>`)
        : snippet + html;
}

/**
 * Read the document from a Farm `transformHtml` resource.
 *
 * Farm 1.7's Vite adapter round-trips `htmlResource.bytes` only (`number[]` of UTF-8 octets).
 * A string or `{ html }` / `{ code }` is not a Farm resource; those return `''` so the hook
 * leaves the value unchanged.
 *
 * @param {string | FarmHtmlResource | null | undefined} resource Farm `{ bytes }` resource, or a non-Farm stand-in.
 * @returns {string} Decoded HTML. Empty when `bytes` is missing or empty.
 */
export function readFarmHtml(resource: string | FarmHtmlResource | null | undefined) {
    const bytes = resource && typeof resource === 'object' ? resource.bytes : undefined;
    if (bytes && typeof bytes.length === 'number' && bytes.length > 0)
        return Buffer.from(bytes).toString('utf8');
    return '';
}

/**
 * Put `html` back on a Farm resource by replacing `bytes`, matching Farm's own Vite adapter
 * (`htmlResource.bytes = [...Buffer.from(result)]`).
 *
 * A value without `bytes` is returned unchanged. Farm does not read a string return.
 *
 * @param {T} resource The resource {@link readFarmHtml} decoded. The same value is returned so Farm's `Resource` type is preserved.
 * @param {string} html HTML after bootstrap injection.
 * @returns {T} The same resource when `bytes` was written; otherwise `resource` as given.
 */
export function writeFarmHtml<T extends string | FarmHtmlResource | null | undefined>(resource: T, html: string): T {
    if (!resource || typeof resource !== 'object' || !resource.bytes)
        return resource;
    resource.bytes = [...Buffer.from(html)];
    return resource as T;
}

/**
 * Decode a Farm dev-server response body. Koa sets `ctx.body` to a string, a Buffer, or a Uint8Array.
 * This is not the `transformHtml` resource shape.
 *
 * @param {unknown} body `ctx.body` after Farm's resource middleware.
 * @returns {string} UTF-8 text, or `''` for any other body.
 */
export function readFarmDevBody(body: unknown) {
    if (typeof body === 'string')
        return body;
    if (Buffer.isBuffer(body))
        return body.toString('utf8');
    if (body instanceof Uint8Array)
        return Buffer.from(body).toString('utf8');
    return '';
}

/**
 * Outermost Farm dev middleware. Farm 1.7 calls `configureDevServer` after
 * `http.createServer(app.callback())`. Koa composes `app.middleware` on each request, so
 * `unshift` still runs first and sees `ctx.body` after the resource middleware assigns it.
 * `app.use` appends and runs inside that middleware, before the body exists, so it cannot inject.
 *
 * Does nothing when `app.middleware` is not an array. This Koa app always exposes that array.
 *
 * @param {FarmDevApp | null | undefined} app Koa app from `server.app()`. A missing `middleware` array is a no-op.
 * @param {() => Promise<string>} injectionHtml Bootstrap snippet. Called only for an HTML body that lacks the marker.
 * @returns {void}
 */
export function installFarmDevInjection(app: FarmDevApp | null | undefined, injectionHtml: () => Promise<string>) {
    if (!app || !Array.isArray(app.middleware))
        return;
    const inject: FarmDevMiddleware = async (ctx, next) => {
        await next();
        const type = String(ctx?.type || '');
        const pathName = String(ctx?.path || '');
        const htmlResponse = type.includes('html') || pathName === '/' || pathName.endsWith('.html');
        if (!htmlResponse || ctx.body == null)
            return;
        const html = readFarmDevBody(ctx.body);
        if (!html.includes('<') || html.includes(CLIENT_BOOTSTRAP_MARKER))
            return;
        ctx.body = injectHtmlSnippet(html, await injectionHtml());
    };
    app.middleware.unshift(inject);
}

/**
 * webpack/rspack-style HTML injection via `processAssets` at REPORT stage.
 *
 * Boundary: skips production mode so the inspector never ships. Mutates every emitted `.html` asset.
 *
 * @param {CompilerWithRspack} compiler webpack/rspack compiler. `rspack` is absent on a webpack compiler.
 * @param {InspectorRuntime} runtime Shared inspector runtime.
 * @param {'webpack' | 'rspack'} bundler Which stamp adapter to register. Production mode is left untouched,
 *   including `cache.version`.
 */
export function setupWebpackLikeCompiler(compiler: CompilerWithRspack, runtime: InspectorRuntime, bundler: 'webpack' | 'rspack') {
    if (!runtime.enabled) {
        return;
    }
    if (compiler?.options?.mode === 'production') {
        return;
    }
    runtime.initPaths(compiler?.context || process.cwd());
    runtime.registerStampOnCompiler(compiler, bundler);

    // `rspack` is only on rspack compilers. Both namespaces expose `Compilation` and `sources` at runtime.
    const wp: {
        Compilation: { PROCESS_ASSETS_STAGE_REPORT: number };
        sources: { RawSource: new (value: string) => object };
    } = compiler.webpack || compiler.rspack as {
        Compilation: { PROCESS_ASSETS_STAGE_REPORT: number };
        sources: { RawSource: new (value: string) => object };
    };
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
                compilation.updateAsset(name, new wp.sources.RawSource(injectHtmlSnippet(original, snippet)) as Parameters<typeof compilation.updateAsset>[1]);
            }
        });
    });
}

/**
 * Resolve which HTML files the esbuild adapter should rewrite after a build.
 *
 * @param {{ htmlFiles?: readonly string[] | null }} options Plugin options; may include `htmlFiles`.
 * @param {{ outdir?: string | null, outfile?: string | null }} initialOptions esbuild `BuildOptions` fields this resolver reads.
 * @param {string} absWorkingDir Absolute working directory for relative paths.
 * @returns {string[]} Absolute HTML file paths (may be empty).
 */
export function resolveEsbuildHtmlTargets(options: { htmlFiles?: readonly string[] | null }, initialOptions: { outdir?: string | null, outfile?: string | null }, absWorkingDir: string) {
    // `Array.isArray` widens the element type; these entries are path strings.
    const listed: readonly string[] = Array.isArray(options.htmlFiles) ? options.htmlFiles : [];
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
