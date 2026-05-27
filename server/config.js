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
 * Normalize the optional persistent Codex dock configuration.
 *
 * Boundary: the dock is disabled unless the caller explicitly opts in. A string
 * `sessionsRoot` is accepted for tests or custom Codex homes; normal use reads
 * from `~/.codex/sessions`.
 *
 * @param {unknown} value Raw `codexDock` option.
 * @returns {{ enabled: boolean, days: number, sessionsRoot?: string, projectRoot?: string, models: Array<{ label: string, value: string }> }} Normalized dock options.
 */
function normalizeCodexDock(value) {
    if (value !== true && (value == null || typeof value !== 'object')) {
        return { enabled: false, days: 15, models: defaultCodexDockModels() };
    }

    const options = value === true ? {} : value;
    const rawDays = Number(options.days);
    const days = Number.isFinite(rawDays) && rawDays > 0
        ? Math.min(Math.floor(rawDays), 90)
        : 15;
    const sessionsRoot = typeof options.sessionsRoot === 'string' && options.sessionsRoot.trim()
        ? options.sessionsRoot.trim()
        : undefined;
    const projectRoot = typeof options.projectRoot === 'string' && options.projectRoot.trim()
        ? options.projectRoot.trim()
        : undefined;
    const models = normalizeCodexDockModels(options.models);

    return {
        enabled: options.enabled === false ? false : true,
        days,
        sessionsRoot,
        projectRoot,
        models,
    };
}

function defaultCodexDockModels() {
    return [
        { label: 'Default', value: '' },
        { label: '5.5 Extra High', value: 'gpt-5.5-codex' },
        { label: '5.5 Fast', value: 'gpt-5.5-codex-spark' },
        { label: 'GPT-5 Codex', value: 'gpt-5-codex' },
    ];
}

function normalizeCodexDockModels(value) {
    if (!Array.isArray(value))
        return defaultCodexDockModels();

    const models = value
        .map((entry) => {
        if (typeof entry === 'string') {
            const text = entry.trim();
            return text ? { label: text, value: text } : null;
        }
        if (!entry || typeof entry !== 'object')
            return null;
        const label = String(entry.label ?? entry.value ?? '').trim();
        const modelValue = String(entry.value ?? '').trim();
        return label ? { label, value: modelValue } : null;
    })
        .filter(Boolean);

    return models.length ? models : defaultCodexDockModels();
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
    const codexDock = normalizeCodexDock(options.codexDock);

    return {
        enabled: options.enabled ?? true,
        hotkey: options.hotkey ?? DEFAULT_HOTKEY,
        clickModifier: options.clickModifier ?? (codexDock.enabled ? 'meta' : null),
        defaultAgent: options.defaultAgent ?? 'clipboard',
        outputDir: options.outputDir ?? DEFAULT_OUTPUT_DIR,
        // prompt-only is the safer default: the agent proposes a plan rather than
        // editing files until the user opts into agent-edit.
        applyMode: options.applyMode ?? 'prompt-only',
        maxSourceContextLines: options.maxSourceContextLines ?? DEFAULT_MAX_SOURCE_CONTEXT_LINES,
        maxDomSnippetLength: options.maxDomSnippetLength ?? DEFAULT_MAX_HTML_SNIPPET,
        apiOrigin: normalizeApiOrigin(options.apiOrigin),
        codexDock,
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
