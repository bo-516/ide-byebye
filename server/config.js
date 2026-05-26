import { DEFAULT_HOTKEY, DEFAULT_MAX_HTML_SNIPPET, DEFAULT_MAX_SOURCE_CONTEXT_LINES, DEFAULT_OUTPUT_DIR, } from '../shared/constants.js';

/**
 * Normalizes an optional inspector API origin.
 *
 * Boundary: this value is injected into the browser client and must be an absolute origin without a trailing slash.
 * Passing a non-string, a blank string, or a non-http(s) URL falls back to automatic local dev-server origin detection;
 * passing a path instead of an origin would make the browser generate malformed inspector endpoint URLs.
 *
 * @param {unknown} apiOrigin Optional absolute origin supplied by the plugin caller.
 * @returns {string | null} Normalized origin such as `http://127.0.0.1:8888`, or null to auto-detect.
 */
function normalizeApiOrigin(apiOrigin) {
    if (typeof apiOrigin !== 'string') {
        return null;
    }

    const trimmed = apiOrigin.trim();
    if (!trimmed) {
        return null;
    }

    try {
        const url = new URL(trimmed);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return null;
        }
        return url.origin;
    }
    catch {
        return null;
    }
}

/**
 * Resolves code-intent inspector runtime options.
 *
 * Boundary: callers may pass partial plugin options; invalid optional values are normalized to safe defaults. Passing
 * the wrong `apiOrigin` can point browser inspector requests at the wrong server, while leaving it empty auto-detects
 * the current Vite dev-server loopback origin.
 *
 * @param {Record<string, unknown>} options Raw plugin options supplied from Vite config.
 * @returns {Record<string, unknown>} Fully resolved inspector options used by server and browser config generation.
 */
export function resolveOptions(options) {
    return {
        enabled: options.enabled ?? true,
        hotkey: options.hotkey ?? DEFAULT_HOTKEY,
        clickModifier: options.clickModifier ?? null,
        defaultAgent: options.defaultAgent ?? 'clipboard',
        outputDir: options.outputDir ?? DEFAULT_OUTPUT_DIR,
        // prompt-only is the safer default: the agent proposes a plan rather than
        // editing files until the user opts into agent-edit.
        applyMode: options.applyMode ?? 'prompt-only',
        maxSourceContextLines: options.maxSourceContextLines ?? DEFAULT_MAX_SOURCE_CONTEXT_LINES,
        maxDomSnippetLength: options.maxDomSnippetLength ?? DEFAULT_MAX_HTML_SNIPPET,
        apiOrigin: normalizeApiOrigin(options.apiOrigin),
        agents: options.agents ?? {},
    };
}
/** Coerce a `boolean | config` agent entry into a config object or undefined. */
export function coerceAgentConfig(value) {
    if (value === true)
        return { enabled: true };
    if (!value)
        return undefined;
    if (typeof value === 'object') {
        return value.enabled === false ? undefined : value;
    }
    return undefined;
}
