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

/** Colour theme of the inspector UI; `'auto'` follows the OS `prefers-color-scheme`. */
export type Theme = 'light' | 'auto' | 'dark';

/**
 * Agent adapter id (`agents.custom` names too). As `defaultAgent`, only footer agents drive Enter:
 * `'clipboard'` / `'file'` are valid adapter ids but never Enter targets.
 */
export type AgentId =
  | 'clipboard'
  | 'file'
  | 'codex-app'
  | 'claude-app'
  | 'cursor-app'
  | 'grok-build'
  | 'antigravity-ide'
  | 'antigravity'
  | (string & {});

/** Hint embedded in the handoff: plan only vs allow the agent to edit. */
export type ApplyMode = 'prompt-only' | 'agent-edit';

/** Click-to-pick modifier; `'auto'` → ⌘ or Ctrl (so DevTools PC ↔ mobile toggling keeps working). */
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
  /** Executable for deeplink / launcher. Default: `open` (macOS), `cmd` (Windows), `xdg-open` (Linux). */
  openCommand?: string;
  /**
   * Extra args before the URL / launcher path.
   * Appended after the platform default prefix when `openCommand` is omitted.
   */
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

/**
 * Options for the existing-session menu.
 *
 * Boundary: `false` on the agent (`sessions: false`) disables the menu entirely — that is not a field of this object.
 * `limit` outside 1–50 is clamped. `home` is a server path; the page cannot set it.
 */
export interface SessionPickerOptions {
  /** Menu length. Default 20, clamped to 1–50. */
  limit?: number;
  /** Codex only: ignore rollouts whose mtime is older than this many days. Default 30. */
  lookbackDays?: number;
  /** Data root. Codex defaults to `$CODEX_HOME` or `~/.codex`; Grok defaults to `~/.grok`. */
  home?: string;
}

export interface CodexAppAgentOptions extends AgentOpenOptions {
  /** Deeplink scheme (`codex://new`). Default `'codex'`. */
  scheme?: string;
  /** Folder opened by the deeplink; relative paths resolve from process cwd. */
  projectRoot?: string;
  /**
   * Existing-thread list (the `›` beside this agent in the dialog's destination picker). Default on. `false` removes
   * it. An object overrides limit, lookback, or home.
   */
  sessions?: boolean | SessionPickerOptions;
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

/**
 * Antigravity IDE. Off unless `agents.antigravityIde` is set.
 * The CLI opens the project folder; the prompt is placed in the agent input and is not submitted.
 * `openCommand` / `openArgs` on this object are ignored.
 */
export interface AntigravityIdeAgentOptions extends AgentOpenOptions {
  /** CLI binary. Default: `antigravity-ide`, then the macOS app-bundle path. */
  command?: string;
  /** Folder opened as the chat workspace. Default: bundler project root. */
  projectRoot?: string;
  /** Chat mode (`ask`, `edit`, `agent`, or a custom mode id). Omitted → IDE default `agent`. */
  mode?: string;
  /** Force the last active IDE window. Ignored when `newWindow` is true. */
  reuseWindow?: boolean;
  /** Open an empty new window for the chat. Wins over `reuseWindow`. */
  newWindow?: boolean;
  /** Maximize the chat session view. */
  maximize?: boolean;
  /** IDE profile name passed as `--profile`. */
  profile?: string;
  /**
   * Attach referenced source files, screenshots, and recording stills with `--add-file`.
   * Default `true`. Paths outside the project root are dropped.
   */
  addFiles?: boolean;
  /** In `auto` mode, longer prompts switch to a file pointer. Default `12000`. */
  promptArgLimit?: number;
  /**
   * When `true`, the `›` beside this agent in the destination picker lists IDE conversations and send delivers into
   * the selected one.
   * Default `false`. Reads the language-server CSRF token from the IDE process command line.
   */
  experimentalSessions?: boolean;
}

/**
 * Antigravity CLI (`agy`). Off unless `agents.antigravity` is set.
 * Opens a Terminal session; `openCommand` / `openArgs` choose how that launcher is started.
 */
export interface AntigravityAgentOptions extends AgentOpenOptions {
  /** CLI binary (`agy`, then `~/.local/bin/agy`). Absolute path if PATH differs. */
  command?: string;
  /** Launcher `cd`. Relative `@` refs strip against this root. */
  projectRoot?: string;
  /** Source `@` refs in the Antigravity prompt only. Default `'relative'`. */
  pathStyle?: PathStyle;
  /** Screenshot / still paths in the Antigravity prompt. Default `'absolute'`. */
  artifactPathStyle?: PathStyle;
  /** Passed as `agy --mode` (`plan`, `accept-edits`). Omitted → CLI default. */
  mode?: string;
  /** In `auto` mode, longer prompts switch to file handoff. Default `12000`. */
  promptArgLimit?: number;
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
  /**
   * Existing-session list (the `›` beside this agent in the dialog's destination picker). Default on. `false` removes
   * it. Only closed sessions can be targeted.
   */
  sessions?: boolean | SessionPickerOptions;
}

/**
 * A client that receives the assembled prompt in its own input box instead of
 * having an app opened for it. Declared per project through `agents.custom`;
 * nothing is registered when the option is absent.
 */
export interface CustomAgentOptions {
  /** Adapter id and storage key, e.g. `'grok-desktop'`. Must not shadow a built-in agent. */
  name: string;
  /** Footer button text. Default: `name`. */
  label?: string;
  /** Button tooltip. Default: localized generic copy naming `label`. */
  title?: string;
  /** `false` skips registration, matching the built-in agents. */
  enabled?: boolean;
  /**
   * How the prompt reaches the client.
   * Default: `'http'` when `url` is set, otherwise `'postMessage'`.
   */
  transport?: 'http' | 'postMessage';
  /** **http**: absolute `http(s)` endpoint the dev server POSTs the payload to. */
  url?: string;
  /** **http**: request method. Default `'POST'` (`PUT` / `PATCH` also accepted). */
  method?: 'POST' | 'PUT' | 'PATCH';
  /** **http**: extra request headers, e.g. an auth token. */
  headers?: Record<string, string>;
  /** **http**: request timeout in ms. Default `8000`. */
  timeoutMs?: number;
  /** **postMessage**: payload `type` field. Default `'ide-byebye:prompt'`. */
  messageType?: string;
  /** **postMessage**: window the previewed page posts to. Default `'parent'`. */
  windowTarget?: 'parent' | 'top' | 'opener';
  /** **postMessage**: `targetOrigin` argument. Default `'*'`. */
  targetOrigin?: string;
  /** Source `@` refs in this client's prompt only. Default: plugin-level value. */
  pathStyle?: PathStyle;
  /** Screenshot / still paths in this client's prompt only. Default: plugin-level value. */
  artifactPathStyle?: PathStyle;
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
  /**
   * Antigravity IDE chat handoff. Omit it (the default) and the button is not registered.
   * `true` or an options object turns it on.
   */
  antigravityIde?: AgentEntry<AntigravityIdeAgentOptions>;
  /**
   * Antigravity CLI (`agy`) handoff. Omit it (the default) and the button is not registered.
   * `true` or an options object turns it on.
   */
  antigravity?: AgentEntry<AntigravityAgentOptions>;
  /**
   * Extra footer agents that deliver the prompt straight into a running
   * client's input box. Omit it and the plugin behaves exactly as before.
   */
  custom?: CustomAgentOptions[] | CustomAgentOptions;
}

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
   * Paths to stamp even under `node_modules`.
   * A string matches as a substring; a RegExp is tested against the module id.
   */
  include?: string | RegExp | Array<string | RegExp>;
  /** Extra paths to skip. `/node_modules/` is always skipped unless `include` matches. */
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
   * `'grok-build'` / `'antigravity-ide'` / `'antigravity'` or an `agents.custom` name).
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
   * Default `{}` (clipboard, file, Codex, Claude, Cursor, Grok Build on).
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
