import type { PathStyle } from './primitives.js';

/**
 * Agent option types: shared open options, every built-in adapter's option object, custom
 * (`postMessage` / `http`) clients, and the `agents` map itself.
 */

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
  /** In `auto` mode, longer prompts switch to a file pointer. Default `12000`. */
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
  /** In `auto` mode, longer prompts switch to a file pointer. Default `12000`. */
  promptArgLimit?: number;
  /**
   * Existing-session list (the `›` beside this agent in the destination picker). Default on. `false` removes
   * it. Only closed sessions can be targeted.
   */
  sessions?: boolean | SessionPickerOptions;
}

/**
 * Claude Code CLI (`claude`). On by default.
 * `'auto'` opens `claude-cli://` in your last-used terminal with the prompt prefilled (you press Enter) when the
 * handler is registered and the prompt fits; otherwise a Terminal launcher runs `claude -- "<prompt>"`, which submits it.
 */
export interface ClaudeCliAgentOptions extends AgentOpenOptions {
  /**
   * Route. `'auto'` (default): deeplink when registered and ≤ 5000 characters, else Terminal launcher.
   * `'deeplink'` never uses the launcher (long prompts become a file pointer); `'terminal'` never opens the link.
   */
  launch?: 'auto' | 'deeplink' | 'terminal';
  /** CLI for the Terminal route. Default: `claude`, `~/.local/bin/claude`, `~/.claude/local/claude`. */
  command?: string;
  /** Session folder for both routes; relative paths resolve from process cwd. Default: project root. */
  projectRoot?: string;
  /** Source `@` refs in this prompt only. Default `'relative'` (to `projectRoot`). */
  pathStyle?: PathStyle;
  /** Screenshot / still paths in this prompt only. Default `'absolute'`. */
  artifactPathStyle?: PathStyle;
  /** Terminal route only → `--permission-mode <value>` (`plan`, `acceptEdits`, …). */
  permissionMode?: string;
  /** Terminal route: longer prompts switch to a file pointer. Default `12000`. */
  promptArgLimit?: number;
}

/**
 * OpenCode. On by default.
 * `'auto'` opens a new desktop session with the prompt prefilled on macOS when the app is 1.x; 2.x desktops, CLI-only
 * installs and other platforms get a Terminal launcher running `opencode <dir> --prompt=<prompt>`, which submits it.
 */
export interface OpenCodeAgentOptions extends AgentOpenOptions {
  /**
   * Route. `'auto'` (default): desktop 1.x deeplink on macOS, else Terminal launcher.
   * `'app'` always sends `opencode://new-session` (1.x desktops on Windows / Linux); `'terminal'` always uses the CLI.
   */
  launch?: 'auto' | 'app' | 'terminal';
  /** Desktop bundle (macOS). Default: `/Applications/OpenCode.app`, then `~/Applications/OpenCode.app`. */
  appPath?: string;
  /** CLI. Default: `opencode`, `~/.opencode/bin/opencode`, then the CLI inside the desktop bundle. */
  command?: string;
  /** Session folder for both routes; relative paths resolve from process cwd. Default: project root. */
  projectRoot?: string;
  /** Source `@` refs in this prompt only. Default `'relative'` (to `projectRoot`). */
  pathStyle?: PathStyle;
  /** Screenshot / still paths in this prompt only. Default `'absolute'`. */
  artifactPathStyle?: PathStyle;
  /** App route: encoded deeplink longer than this switches to a file pointer. Default `8000`. */
  promptUrlLimit?: number;
  /** Terminal route: longer prompts switch to a file pointer. Default `12000`. */
  promptArgLimit?: number;
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
  /** Claude Code CLI handoff (`claude-cli`). On by default; `false` removes it. */
  claudeCli?: AgentEntry<ClaudeCliAgentOptions>;
  /** OpenCode handoff (`opencode`). On by default; `false` removes it. */
  opencode?: AgentEntry<OpenCodeAgentOptions>;
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
