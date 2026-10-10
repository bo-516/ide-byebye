/**
 * webpack / Turbopack loader that stamps one module.
 *
 * Purpose: Next cannot use the in-process unplugin transform, so this file is the loader both
 * Turbopack rules and `next dev --webpack` point at. It runs before the entry loader, which only
 * inserts the bootstrap on the same line and does not move stamp positions.
 *
 * Boundary: options must be JSON (`include` / `exclude` / `escapeTags` RegExps are `{ source, flags }`).
 * `this.cacheable(true)` lets webpack cache the result. A thrown stamp returns the original source.
 * Incoming source maps are forwarded unchanged.
 */

import { stampModule } from './stamp-module.js';
import { reviveStampOptions } from './stamp-options.js';

/** JSON loader options as serialized by the Next integration; RegExps arrive as `{ source, flags }`. */
type StampLoaderOptions = Parameters<typeof reviveStampOptions>[0];

/**
 * webpack / Turbopack loader-context fields this loader reads.
 *
 * Boundary: structural so both hosts' contexts fit. `getOptions` is the webpack 5 / Turbopack API; `query` is the
 * legacy fallback and holds the same options object because the integration always configures this loader with JSON.
 */
interface StampLoaderContext {
    cacheable?: (flag: boolean) => void;
    getOptions?: () => StampLoaderOptions;
    query?: StampLoaderOptions;
    resourcePath?: string;
    resourceQuery?: string;
    callback?: (error: Error | null, content: string, map?: unknown) => void;
}

/**
 * Loader entry (`this` is the webpack / Turbopack loader context).
 *
 * @param {string} source Module source from the previous loader.
 * @param {unknown} [map] Incoming source map, forwarded unchanged.
 * @returns {string | void} Source when there is no `callback`; otherwise the result goes through `callback`.
 */
export default function ideByebyeStampLoader(this: StampLoaderContext, source: string, map?: unknown) {
    this.cacheable?.(true);
    const raw = (typeof this.getOptions === 'function' ? this.getOptions() : this.query) || {};
    const options = reviveStampOptions(raw);
    let output: string;
    try {
        const id = `${this.resourcePath || ''}${this.resourceQuery || ''}`;
        output = stampModule({
            code: source,
            id,
            family: 'webpack',
            options,
            warnOnce: (_key, message) => console.warn(message),
        }) ?? source;
    }
    catch {
        output = source;
    }
    if (typeof this.callback === 'function') {
        this.callback(null, output, map);
        return;
    }
    return output;
}
