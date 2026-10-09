/**
 * webpack-compatible loader that mounts the inspector bootstrap into Next.js entries.
 *
 * Purpose: thin fs/loader-API shell around {@link injectNextBootstrap}. The same file runs under Turbopack
 * (`turbopack.rules`, in a Node worker) and under `next dev --webpack` (`module.rules`, in-process).
 *
 * Boundary: options must be JSON (`{ bootstrapFile: string, projectDir?: string }`) because Turbopack serializes them.
 * The project directory comes from the loader's `rootContext` (the Next project), falling back to `options.projectDir`.
 * Incoming source maps are passed through: injection never changes existing line numbers.
 */

import fs from 'node:fs';
import { injectNextBootstrap } from './entry-inject.js';

/** JSON options the Next integration passes to this loader (Turbopack serializes them). */
interface EntryLoaderOptions {
    bootstrapFile?: string;
    projectDir?: string;
}

/**
 * webpack / Turbopack loader-context fields this loader reads.
 *
 * Boundary: structural so both hosts' contexts fit. `getOptions` is the webpack 5 / Turbopack API; `query` is the
 * legacy fallback and holds the same options object because the integration always configures this loader with JSON.
 */
interface EntryLoaderContext {
    getOptions?: () => EntryLoaderOptions | null | undefined;
    query?: EntryLoaderOptions | null;
    rootContext?: string;
    resourcePath: string;
    callback?: (error: Error | null, content: string, map?: unknown) => void;
}

/**
 * Whether a Pages Router directory holds a custom `_app` (any extension, including custom `pageExtensions`).
 *
 * @param {string} pagesDir Absolute `pages` directory.
 * @returns {boolean} `true` when a file named `_app.*` exists there.
 */
function hasCustomApp(pagesDir: string) {
    try {
        return fs.readdirSync(pagesDir).some((name) => name.startsWith('_app.'));
    }
    catch {
        return false;
    }
}

/**
 * Loader entry point (`this` is the webpack / Turbopack loader context).
 *
 * @param {string} source Module source from the previous loader.
 * @param {unknown} [map] Incoming source map, forwarded unchanged.
 * @returns {string | void} Source when the loader context has no `callback`; otherwise results go through `callback`.
 */
export default function ideByebyeNextEntryLoader(this: EntryLoaderContext, source: string, map?: unknown) {
    const options: EntryLoaderOptions = (typeof this.getOptions === 'function' ? this.getOptions() : this.query) || {};
    const projectDir = this.rootContext || options.projectDir || process.cwd();
    let output: string;
    try {
        output = injectNextBootstrap({
            source,
            resourcePath: this.resourcePath,
            projectDir,
            bootstrapFile: options.bootstrapFile,
            hasCustomApp,
        }) ?? source;
    }
    catch {
        // Never break the user's build over the inspector: leave the module as it was.
        output = source;
    }
    if (typeof this.callback === 'function') {
        this.callback(null, output, map);
        return;
    }
    return output;
}
