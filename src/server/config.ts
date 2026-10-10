import { DEFAULT_HOTKEY, DEFAULT_MAX_HTML_SNIPPET, DEFAULT_MAX_SOURCE_CONTEXT_LINES, DEFAULT_OUTPUT_DIR, } from '../shared/constants.js';
import { normalizeLocale } from '../shared/locale.js';
import { normalizeTheme } from '../shared/theme.js';

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
function normalizeApiOrigin(apiOrigin: unknown) {
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
 * Normalize the optional element-behavior recording (rrweb) configuration.
 *
 * Boundary: recording is OFF when omitted; `true` or an options object enables it unless the object sets
 * `enabled: false`. Masking defaults to OFF because this is a developer tool where seeing real form state aids
 * reproduction; enable `mask.allInputs` / set `mask.blockClass` for privacy-sensitive pages. `maxDurationMs` bounds
 * the in-browser rolling buffer and is clamped so a forgotten recording cannot grow without limit.
 *
 * @param {unknown} value Raw `recording` option.
 * @returns {{ enabled: boolean, maxDurationMs: number, mask: { allInputs: boolean, blockClass: string } }} Normalized recording options.
 */
function normalizeRecordingConfig(value: unknown) {
    const options: {
        maxDurationMs?: unknown;
        enabled?: unknown;
        mask?: unknown;
    } = value && typeof value === 'object' ? value as {
        maxDurationMs?: unknown;
        enabled?: unknown;
        mask?: unknown;
    } : {};
    const rawMax = Number(options.maxDurationMs);
    const maxDurationMs = Number.isFinite(rawMax) && rawMax > 0 ? Math.min(Math.floor(rawMax), 300000) : 30000;
    const mask: {
        allInputs?: unknown;
        blockClass?: unknown;
    } = options.mask && typeof options.mask === 'object' ? options.mask as {
        allInputs?: unknown;
        blockClass?: unknown;
    } : {};
    return {
        enabled: (value === true || (value !== null && typeof value === 'object')) && options.enabled !== false,
        maxDurationMs,
        mask: {
            allInputs: mask.allInputs === true,
            blockClass: typeof mask.blockClass === 'string' && mask.blockClass ? mask.blockClass : 'rr-block',
        },
    };
}

/**
 * Normalize a prompt path style token for **source files**.
 *
 * Boundary: only the string `'absolute'` enables absolute `@` refs. Any other value (including missing / invalid)
 * falls back to `'relative'` so accidental config typos never flip the historical source-path default.
 *
 * @param {unknown} value Raw config value (`'relative'` | `'absolute'` | other).
 * @returns {'relative' | 'absolute'} Normalized path style.
 */
export function normalizePathStyle(value: unknown): 'relative' | 'absolute' {
    return value === 'absolute' ? 'absolute' : 'relative';
}

/**
 * Normalize a prompt path style token for **artifacts** (screenshots / recording stills).
 *
 * Boundary: artifacts default to **absolute** when the option is omitted — relative `@.intent-inspector/…` chips break
 * when the agent cwd differs from the Vite package root (monorepo handoffs, Grok `--cwd`, multi-package apps). Only the
 * explicit string `'relative'` opts back into project-root-relative artifact refs. Invalid tokens also fall back to
 * absolute so typos cannot reintroduce the fragile relative default.
 *
 * @param {unknown} value Raw config value (`'relative'` | `'absolute'` | undefined | other).
 * @returns {'relative' | 'absolute'} Normalized artifact path style.
 */
export function normalizeArtifactPathStyle(value: unknown): 'relative' | 'absolute' {
    if (value === undefined)
        return 'absolute';
    return value === 'relative' ? 'relative' : 'absolute';
}

/**
 * Resolve how source files and artifacts (screenshots / recording stills) appear in plain `@` prompt refs.
 *
 * Boundary:
 * - `pathStyle` defaults to `'relative'` (project-root relative source chips, same as locked frontend `@src/…` refs).
 * - `artifactPathStyle` defaults to **`'absolute'`** independently (images are openable regardless of agent cwd).
 * - Pass explicit `artifactPathStyle: 'relative'` only when you want short screenshot chips under the same root as
 *   source. Invalid tokens fall back via {@link normalizePathStyle} / {@link normalizeArtifactPathStyle}.
 *
 * @param {{ pathStyle?: unknown, artifactPathStyle?: unknown }} [options] Raw path-style fields from plugin or agent config.
 * @returns {{ pathStyle: 'relative' | 'absolute', artifactPathStyle: 'relative' | 'absolute' }} Options for `buildPrompt`.
 */
export function resolvePromptPathStyleOptions(options: { pathStyle?: unknown, artifactPathStyle?: unknown } = {}): { pathStyle: 'relative' | 'absolute', artifactPathStyle: 'relative' | 'absolute' } {
    return {
        pathStyle: normalizePathStyle(options.pathStyle),
        artifactPathStyle: normalizeArtifactPathStyle(options.artifactPathStyle),
    };
}

/**
 * Resolves ide-byebye runtime options.
 *
 * Boundary: callers may pass partial plugin options; invalid optional values are normalized to safe defaults. Passing
 * the wrong `apiOrigin` can point browser inspector requests at the wrong server, while leaving it empty auto-detects
 * the current Vite dev-server loopback origin. `pathStyle` / `artifactPathStyle` only affect plain `@` prompts
 * (clipboard / file / Grok Build); Codex/Claude markdown or deeplink attachments keep their own formats. `theme` stays
 * `null` when unset or invalid, so the browser can tell "not configured" apart from an explicit `'light'`.
 *
 * @param {Record<string, unknown>} options Raw plugin options supplied from Vite config.
 * @returns {Record<string, unknown>} Fully resolved inspector options used by server and browser config generation.
 */
export function resolveOptions(options: {
    enabled?: unknown;
    locale?: unknown;
    theme?: unknown;
    hotkey?: unknown;
    clickModifier?: unknown;
    defaultAgent?: unknown;
    outputDir?: unknown;
    applyMode?: unknown;
    maxSourceContextLines?: unknown;
    maxDomSnippetLength?: unknown;
    apiOrigin?: unknown;
    recording?: unknown;
    pathStyle?: unknown;
    artifactPathStyle?: unknown;
    agents?: object;
}) {
    const pathStyles = resolvePromptPathStyleOptions(options);
    return {
        enabled: options.enabled ?? true,
        locale: normalizeLocale(options.locale),
        // null = not configured: the browser falls back to DEFAULT_THEME and logs a hint naming the option.
        theme: normalizeTheme(options.theme),
        hotkey: options.hotkey ?? DEFAULT_HOTKEY,
        // 'auto' resolves per-platform in the browser (⌘ on macOS, Ctrl elsewhere) so ⌘/Ctrl-click works with zero
        // config; pass an explicit modifier to override, or `false`/`null` to disable click-picking.
        clickModifier: options.clickModifier ?? 'auto',
        defaultAgent: options.defaultAgent ?? 'claude-app',
        // Callers pass this to `path.resolve`, which requires a string. Non-strings still flow through unchanged.
        outputDir: options.outputDir as string ?? DEFAULT_OUTPUT_DIR,
        // prompt-only is the safer default: the agent proposes a plan rather than
        // editing files until the user opts into agent-edit.
        applyMode: options.applyMode ?? 'prompt-only',
        maxSourceContextLines: options.maxSourceContextLines ?? DEFAULT_MAX_SOURCE_CONTEXT_LINES,
        maxDomSnippetLength: options.maxDomSnippetLength ?? DEFAULT_MAX_HTML_SNIPPET,
        apiOrigin: normalizeApiOrigin(options.apiOrigin),
        recording: normalizeRecordingConfig(options.recording),
        // Source defaults relative (`@src/App.tsx`); screenshots default absolute (`@/abs/…/screenshots/x.webp`).
        pathStyle: pathStyles.pathStyle,
        artifactPathStyle: pathStyles.artifactPathStyle,
        // `object` above so the public `AgentsOptions` interface (no index signature) assigns; consumers read by key.
        agents: (options.agents ?? {}) as Record<string, unknown>,
    };
}
/**
 * Coerce a `boolean | config` agent entry into a config object or undefined.
 *
 * Boundary: `true` becomes `{ enabled: true }`; `false`, nullish, non-objects, and `{ enabled: false }` are undefined
 * (not registered). Any other object is returned as-is — adapters read their own keys and ignore the rest.
 *
 * @param {unknown} value `agents.<name>` from plugin config.
 * @returns {Record<string, unknown> | undefined} The adapter config, or undefined when the agent is off.
 */
export function coerceAgentConfig(value: unknown): Record<string, unknown> | undefined {
    if (value === true)
        return { enabled: true };
    if (!value)
        return undefined;
    if (typeof value === 'object') {
        // Config entries are plain option records; the cast only names that shape for the adapters.
        const config = value as Record<string, unknown>;
        return config.enabled === false ? undefined : config;
    }
    return undefined;
}
