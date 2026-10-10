import type { Locale, Theme, ClickModifier, AgentId, ApplyMode, PathStyle } from './primitives.js';
import type { AgentsOptions } from './agents.js';

/**
 * Top-level plugin option types: recording, source stamping, the `IdeByebyeOptions` surface, and
 * the bundler-flavored option extensions.
 */

/** rrweb element-behavior recording options. */
export interface RecordingOptions {
  /** `false` hides the Record button. Defaults to `true` when an options object is supplied. */
  enabled?: boolean;
  /** Rolling buffer length in ms; positive only; clamped to ≤ 300000. Default 30000. */
  maxDurationMs?: number;
  mask?: {
    /** Mask input values in replay / still. Default `false`. */
    allInputs?: boolean;
    /** Class marking excluded elements. Default `'rr-block'`. */
    blockClass?: string;
  };
}

/**
 * Tag the stamper skips, in addition to the built-in list.
 * A string matches case-insensitively. A RegExp is tested against the tag and its lowercased form.
 */
export type EscapeTag = string | RegExp;

/**
 * Which files receive `data-insp-path`.
 * Omit the object (or pass nothing) to stamp. `false` turns stamping off.
 */
export interface SourceStampOptions {
  /**
   * Paths to stamp even under `node_modules` or Vite's `cacheDir`.
   * A string matches as a substring; a RegExp is tested against the module id.
   */
  include?: string | RegExp | Array<string | RegExp>;
  /**
   * Extra paths to skip. `/node_modules/` and Vite's `cacheDir` (pre-bundled deps) are always
   * skipped unless `include` matches.
   */
  exclude?: string | RegExp | Array<string | RegExp>;
  /** Appended to the built-in escape tags. Strings are case-insensitive. */
  escapeTags?: EscapeTag[];
}

/**
 * Legacy code-inspector options.
 * @deprecated 0.6.0 — only `include`, `exclude`, `escapeTags`, and `close` are mapped onto `sourceStamp`. Removed in 0.7.0.
 */
export type CodeInspectorOptions = Record<string, unknown>;

/**
 * Plugin options for every bundler entry (`ide-byebye`, `ide-byebye/vite`, …).
 * All fields are optional; invalid values fall back to documented defaults.
 */
export interface IdeByebyeOptions {
  /** Fully disable (no server, no inject). Default `true`. */
  enabled?: boolean;
  /** UI locale; any string starting with `zh` → Chinese, else English. */
  locale?: Locale;
  /**
   * Colour theme of the dialog, menus and recording editor. Default `'light'`; `'auto'` follows the OS
   * light/dark setting. Left unset (or invalid), the page logs a console hint naming this option once it loads.
   */
  theme?: Theme;
  /** Picker toggle hotkey, `+`-joined (e.g. `'Alt+Shift+I'`). */
  hotkey?: string;
  /**
   * Click-to-pick modifier. Default `'auto'` (⌘ or Ctrl, including DevTools mobile emulation).
   * `null` / `false` disables modifier-picking (hotkey and 4s long-press still work).
   */
  clickModifier?: ClickModifier;
  /**
   * Enter-key target: a footer agent (`'codex-app'` / `'claude-app'` / `'cursor-app'` /
   * `'grok-build'` / `'claude-cli'` / `'opencode'` / `'antigravity-ide'` / `'antigravity'` or an `agents.custom` name).
   * Default `'claude-app'`. `'clipboard'` / `'file'` and unknown / disabled ids fall back to the
   * first enabled footer agent; once the user clicks a footer agent, Enter follows that remembered choice instead.
   * `'antigravity-ide'` and `'antigravity'` are only enabled after `agents.antigravityIde` / `agents.antigravity`.
   */
  defaultAgent?: AgentId;
  /** Handoff hint: plan only vs allow edits. Default `'prompt-only'`. */
  applyMode?: ApplyMode;
  /** Project-relative dir for handoff files. Default `'.intent-inspector'`. */
  outputDir?: string;
  /** Source lines around the mapped location in the prompt. Default `60`. */
  maxSourceContextLines?: number;
  /** Max characters of the captured DOM/HTML snippet. Default `1000`. */
  maxDomSnippetLength?: number;
  /**
   * Absolute `http(s)://…` origin (no trailing slash) for the inspector API.
   * Default: auto-detect loopback dev-server origin.
   */
  apiOrigin?: string | null;
  /** How **source** paths appear in plain `@` prompts. Default `'relative'`. */
  pathStyle?: PathStyle;
  /**
   * How screenshot / recording still paths appear in `@` prompts.
   * Default `'absolute'`.
   */
  artifactPathStyle?: PathStyle;
  /**
   * Element-behavior recording (rrweb). Off when omitted.
   * Pass `true` or an options object to enable it; `{ enabled: false }` keeps it off.
   */
  recording?: boolean | RecordingOptions;
  /**
   * Per-agent enable / overrides, plus `custom` clients.
   * Default `{}` (clipboard, file, Codex, Claude, Cursor, Grok Build, Claude Code CLI, OpenCode on).
   * `antigravityIde` and `antigravity` stay off until set.
   */
  agents?: AgentsOptions;
  /**
   * Built-in `data-insp-path` stamping. Default on.
   * `false` stamps nothing and warns nothing (bring your own code-inspector if you need the old pipeline).
   */
  sourceStamp?: false | SourceStampOptions;
  /**
   * @deprecated 0.6.0 — mapped onto {@link sourceStamp}: `include`, `exclude`, `escapeTags`, and `close: true`.
   * Other keys are ignored. One deprecation warning per process. Removed in 0.7.0.
   */
  codeInspector?: CodeInspectorOptions;
  /**
   * esbuild only: explicit HTML paths to inject the bootstrap into when they
   * are not under `outdir`.
   */
  htmlFiles?: string[];
}

/**
 * Options for `ide-byebye/next` (`withIdeByebye`) and `ide-byebye/turbopack`.
 */
export interface NextIdeByebyeOptions extends IdeByebyeOptions {
  /**
   * Next.js project directory (where `app/` / `pages/` live).
   * Default: the folder of the `next.config.*` that calls the wrapper, else `process.cwd()`.
   */
  root?: string;
}

/**
 * Options for `ide-byebye/angular` (`angularProxy`).
 */
export interface AngularIdeByebyeOptions extends IdeByebyeOptions {
  /** Angular workspace directory (where `angular.json` lives). Default: `process.cwd()` of `ng serve`. */
  root?: string;
}

/**
 * Structural Vite / Rollup plugin shape (required `name` + optional hooks).
 *
 * Why not `object` / `any`: Vite's `plugins` is `PluginOption[]`, and
 * `PluginOption` includes nested `PluginOption[]` but **not** `object[]`.
 * Returning this type lets consumers write `plugins: [ideByebye()]` with no cast.
 *
 * Boundary: only the Vite adapter (`vite` / default export) uses this. Other
 * bundlers keep {@link PluginInstance} because their host plugin shapes differ
 * (webpack `apply`, rsbuild `setup`, turbopack rules object, …).
 */
export type VitePlugin = { name: string };

/**
 * Bundler plugin instance (shape varies by host).
 * Prefer {@link VitePlugin} when the value goes into Vite's `plugins` array.
 */
export type PluginInstance = object;
