import { LOG_PREFIX } from '../shared/constants.js';

/**
 * Console logger for one inspector output directory.
 *
 * Purpose: stamp a stable prefix on info, warn, and error lines. `audit` is a no-op kept so older callers can
 * still invoke it.
 * Boundary: `_outputDirAbs` is accepted so call sites can name the directory they log for, and is not read here.
 * Omitting it does not change what is printed.
 *
 * @param {string} _outputDirAbs Absolute output directory this logger is associated with.
 * @returns {{ info: (...args: unknown[]) => void, warn: (...args: unknown[]) => void, error: (...args: unknown[]) => void, audit: () => void }}
 */
export function createLogger(_outputDirAbs: string) {
    return {
        info: (...args: unknown[]) => console.info(LOG_PREFIX, ...args),
        warn: (...args: unknown[]) => console.warn(LOG_PREFIX, ...args),
        error: (...args: unknown[]) => console.error(LOG_PREFIX, ...args),
        audit: () => { },
    };
}
