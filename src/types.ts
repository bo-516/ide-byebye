/**
 * Public TypeScript types for `ide-byebye`.
 *
 * Boundary: these mirror the documented plugin options. Runtime still normalizes invalid values;
 * the types describe the intended config surface for editors and `tsc`. Built into published `.d.ts`
 * via `declaration: true` — do not reintroduce hand-written root declaration files.
 */

/** How source / artifact paths appear in plain `@` prompts. */
export type PathStyle = 'relative' | 'absolute';

/** UI locale for the inspector chrome (prompt text stays language-neutral). */
export type Locale = 'zh' | 'en' | (string & {});

/** Enter-key / default handoff target (adapter id). */
export type AgentId =
  | 'clipboard'
  | 'file'
  | 'codex-app'
  | 'claude-app'
  | 'cursor-app'
  | 'grok-build'
  | (string & {});

/** Hint embedded in the handoff: plan only vs allow the agent to edit. */
export type ApplyMode = 'prompt-only' | 'agent-edit';

/** Click-to-pick modifier; `'auto'` → ⌘ on macOS, Ctrl elsewhere. */
export type ClickModifier =
  | 'auto'
  | 'meta'
  | 'ctrl'
  | 'alt'
  | 'shift'
  | null
  | false;

/** Shared options for footer / launcher agents that open an external app. */
export interface AgentOpenOptions {
  /** `false` unregisters the agent. Default when using an object: on. */
  enabled?: boolean;
  /** Executable for deeplink / launcher (`'open'` on macOS by default). */
  openCommand?: string;
  /** Extra args before the URL / launcher path. */
  openArgs?: string[];
  /**
   * `'file'` writes a Markdown handoff and sends a compact pointer prompt.
   * In `'auto'`, some agents overflow long prompts to file.
   */
  promptMode?: 'auto' | 'file';
}

export interface ClaudeAppAgentOptions extends AgentOpenOptions {
  /** Deeplink scheme (`claude://…`). Default `'claude'`. */
  scheme?: string;
  /** Path → `claude://<route>/new`. Default `'code'`. */
  route?: string;
  /** Extra folders opened with the project root. */
  folders?: string[];
  /** Attach referenced source files (and screenshots) as deeplink `file` params. */
  attachFiles?: boolean;
  /** Include screenshot artifacts when `attachFiles` is true. */
  attachScreenshots?: boolean;
}

export interface CodexAppAgentOptions extends AgentOpenOptions {
  /** Deeplink scheme (`codex://new`). Default `'codex'`. */
  scheme?: string;
  /** Folder opened by the deeplink; relative paths resolve from process cwd. */
  projectRoot?: string;
}

export interface CursorAppAgentOptions extends AgentOpenOptions {
  /**
   * Workspace **name** Cursor routes to (not a path).
   * Default: nearest git-root basename. `false` omits the param.
   */
  workspace?: string | false;
  /** If set, use this directory’s basename as `workspace` (no git walk). */
  projectRoot?: string;
  /** Optional Cursor `mode` deeplink param. */
  mode?: string;
  /** In `auto` mode, URL-encoded prompts over this length switch to file handoff. */
  promptUrlLimit?: number;
  /** Deeplink scheme. Default `'cursor'`. */
  scheme?: string;
  /** Deeplink authority. Default `'anysphere.cursor-deeplink'`. */
  authority?: string;
  /** Deeplink route segment. Default `'prompt'`. */
  route?: string;
}

export interface GrokBuildAgentOptions extends AgentOpenOptions {
  /** CLI binary (`'grok'`, then `~/.grok/bin/grok`). Absolute path if PATH differs. */
  command?: string;
  /** `grok --cwd` and launcher `cd`; relative `@` refs strip against this root. */
  projectRoot?: string;
  /** Source `@` refs in the Grok prompt only. Default `'relative'`. */
  pathStyle?: PathStyle;
  /** Screenshot / still paths in the Grok prompt. Default `'absolute'`. */
  artifactPathStyle?: PathStyle;
  /** Passed as `--permission-mode` (`plan`, `acceptEdits`, `default`, …). */
  permissionMode?: string;
  /** In `auto` mode, longer prompts switch to file handoff. Default `12000`. */
  promptArgLimit?: number;
}

/** Per-agent enable flag or option object. `false` disables; `true` enables. */
export type AgentEntry<T extends object = AgentOpenOptions> =
  | boolean
  | T;

export interface AgentsOptions {
  clipboard?: AgentEntry;
  file?: AgentEntry;
  codexApp?: AgentEntry<CodexAppAgentOptions>;
  claudeApp?: AgentEntry<ClaudeAppAgentOptions>;
  cursorApp?: AgentEntry<CursorAppAgentOptions>;
  grokBuild?: AgentEntry<GrokBuildAgentOptions>;
}

/** rrweb element-behavior recording options. */
export interface RecordingOptions {
  /** `false` hides the Record button. Default on. */
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
 * Extra options forwarded to `code-inspector-plugin`.
 * Do **not** pass `bundler` — each adapter sets it.
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
  /** Picker toggle hotkey, `+`-joined (e.g. `'Alt+Shift+I'`). */
  hotkey?: string;
  /**
   * Click-to-pick modifier. Default `'auto'` (⌘ macOS / Ctrl elsewhere).
   * `null` / `false` disables click-picking (hotkey still works).
   */
  clickModifier?: ClickModifier;
  /** Enter-key target adapter id. Default `'claude-app'`. */
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
   * Element-behavior recording (rrweb). On by default.
   * Pass `false` / `{ enabled: false }` to opt out.
   */
  recording?: boolean | RecordingOptions;
  /** Per-agent enable / overrides. Default `{}` (all six agents on). */
  agents?: AgentsOptions;
  /**
   * Extra options for `code-inspector-plugin` (no `bundler`).
   * Defaults include `pathType: 'absolute'`, `hotKeys: false`, …
   */
  codeInspector?: CodeInspectorOptions;
  /**
   * esbuild only: explicit HTML paths to inject the bootstrap into when they
   * are not under `outdir`.
   */
  htmlFiles?: string[];
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
