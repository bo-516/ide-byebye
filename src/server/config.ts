import { DEFAULT_HOTKEY, DEFAULT_MAX_HTML_SNIPPET, DEFAULT_MAX_SOURCE_CONTEXT_LINES, DEFAULT_OUTPUT_DIR, } from '../shared/constants.js';
import { normalizeLocale } from '../shared/locale.js';

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
 * Normalize the optional element-behavior recording (rrweb) configuration.
 *
 * Boundary: recording is ON by default; pass `recording: false` or `{ enabled: false }` to opt out. Masking defaults to
 * OFF because this is a developer tool where seeing real form state aids reproduction; enable `mask.allInputs` / set
 * `mask.blockClass` for privacy-sensitive pages. `maxDurationMs` bounds the in-browser rolling buffer and is clamped to
 * a sane ceiling so a forgotten recording cannot grow without limit.
 *
 * @param {unknown} value Raw `recording` option.
 * @returns {{ enabled: boolean, maxDurationMs: number, mask: { allInputs: boolean, blockClass: string } }} Normalized recording options.
 */
function normalizeRecordingConfig(value) {
    // Explicit opt-out only: `recording: false` disables it; everything else — including no config at all — keeps it on.
    if (value === false) {
        return { enabled: false, maxDurationMs: 30000, mask: { allInputs: false, blockClass: 'rr-block' } };
    }
    const options = value && typeof value === 'object' ? value : {};
    const rawMax = Number(options.maxDurationMs);
    const maxDurationMs = Number.isFinite(rawMax) && rawMax > 0 ? Math.min(Math.floor(rawMax), 300000) : 30000;
    const mask = options.mask && typeof options.mask === 'object' ? options.mask : {};
    return {
        enabled: options.enabled !== false,
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
export function normalizePathStyle(value) {
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
export function normalizeArtifactPathStyle(value) {
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
export function resolvePromptPathStyleOptions(options: any = {}) {
    return {
        pathStyle: normalizePathStyle(options.pathStyle),
        artifactPathStyle: normalizeArtifactPathStyle(options.artifactPathStyle),
    };
}

/**
 * Resolves code-intent inspector runtime options.
 *
 * Boundary: callers may pass partial plugin options; invalid optional values are normalized to safe defaults. Passing
 * the wrong `apiOrigin` can point browser inspector requests at the wrong server, while leaving it empty auto-detects
 * the current Vite dev-server loopback origin. `pathStyle` / `artifactPathStyle` only affect plain `@` prompts
 * (clipboard / file / Grok Build); Codex/Claude markdown or deeplink attachments keep their own formats.
 *
 * @param {Record<string, unknown>} options Raw plugin options supplied from Vite config.
 * @returns {Record<string, unknown>} Fully resolved inspector options used by server and browser config generation.
 */
export function resolveOptions(options) {
    const pathStyles = resolvePromptPathStyleOptions(options);
    return {
        enabled: options.enabled ?? true,
        locale: normalizeLocale(options.locale),
        hotkey: options.hotkey ?? DEFAULT_HOTKEY,
        // 'auto' resolves per-platform in the browser (⌘ on macOS, Ctrl elsewhere) so ⌘/Ctrl-click works with zero
        // config; pass an explicit modifier to override, or `false`/`null` to disable click-picking.
        clickModifier: options.clickModifier ?? 'auto',
        defaultAgent: options.defaultAgent ?? 'claude-app',
        outputDir: options.outputDir ?? DEFAULT_OUTPUT_DIR,
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
