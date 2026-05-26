const PREFIX = '[code-intent-inspector]';
export function createLogger(_outputDirAbs) {
    return {
        info: (...args) => console.info(PREFIX, ...args),
        warn: (...args) => console.warn(PREFIX, ...args),
        error: (...args) => console.error(PREFIX, ...args),
        audit: () => { },
    };
}
