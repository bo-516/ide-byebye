import type { AgentOpenOptions } from './agents.js';
import type { PathStyle } from './primitives.js';

/**
 * Option types for Tencent WorkBuddy, ByteDance TRAE, and Alibaba Qoder (desktop / IDE client and
 * Terminal CLI variants). Kept in a companion module so `agents.ts` stays under the 400-line cap;
 * `agents.ts` re-exports every interface from here.
 */

/**
 * WorkBuddy desktop app (`workbuddy-app`). On by default.
 * Opens a `workbuddy-ai://task?action=start` (or `workbuddy://`) link that switches to `projectRoot`
 * and prefills the composer without submitting.
 */
export interface WorkBuddyAppAgentOptions extends AgentOpenOptions {
  /** Desktop bundle path override (macOS `.app` or Windows `.exe`). */
  appPath?: string;
  /** Deeplink scheme override. Default: read from the app bundle, else `'workbuddy-ai'`. */
  scheme?: string;
  /** Task workspace folder passed as `cwd`. Default: bundler project root. */
  projectRoot?: string;
  /** Source `@` refs in this prompt only. Default `'relative'`. */
  pathStyle?: PathStyle;
  /** Screenshot / still paths in this prompt only. Default `'absolute'`. */
  artifactPathStyle?: PathStyle;
  /** WorkBuddy welcome tab (`'code'`, `'work'`, `'design'`). Default `'code'`. */
  welcomeMode?: 'code' | 'work' | 'design';
  /** Optional WorkBuddy chat mode id passed as `mode`. */
  mode?: string;
  /** Optional WorkBuddy model id passed as `model`. */
  model?: string;
  /** Optional task permission mode (`'default'` | `'fullAccess'`). */
  permissionMode?: 'default' | 'fullAccess';
  /** Encoded deeplinks longer than this switch to a file pointer. Default `8000`. */
  promptUrlLimit?: number;
}

/**
 * WorkBuddy / CodeBuddy CLI (`workbuddy-cli`). On by default.
 * Opens a Terminal launcher running `codebuddy` (from PATH, `~/.local/bin`, or bundled inside WorkBuddy).
 */
export interface WorkBuddyCliAgentOptions extends AgentOpenOptions {
  /** CLI binary override. Default: `codebuddy`, user install paths, then WorkBuddy's bundled CLI. */
  command?: string;
  /** WorkBuddy desktop bundle path used to locate the bundled `codebuddy` CLI fallback. */
  appPath?: string;
  /** Session folder and launcher `cd`; relative `@` refs strip against this root. */
  projectRoot?: string;
  /** Source `@` refs in this prompt only. Default `'relative'`. */
  pathStyle?: PathStyle;
  /** Screenshot / still paths in this prompt only. Default `'absolute'`. */
  artifactPathStyle?: PathStyle;
  /** Passed as `--permission-mode` (`default`, `acceptEdits`, `auto`, `dontAsk`, `plan`, `bypassPermissions`). */
  permissionMode?: string;
  /** Passed as `--model`. Omitted → CLI default model. */
  model?: string;
  /** Longer prompts switch to a file pointer in `auto` mode. Default `12000`. */
  promptArgLimit?: number;
}

/**
 * TRAE IDE client (`trae-app`). On by default.
 * Opens `<scheme>://trae.ai-ide/side-chat?query=…` (`trae-cn` for Trae CN, `trae` for global builds)
 * to prefill the Side AI Chat composer.
 */
export interface TraeAppAgentOptions extends AgentOpenOptions {
  /** Desktop bundle path override (macOS `.app` or Windows `.exe`). */
  appPath?: string;
  /** Which TRAE install to prefer when both are present. Default `'auto'`. */
  edition?: 'auto' | 'cn' | 'intl';
  /** Deeplink scheme override (`'trae-cn'` or `'trae'`). */
  scheme?: string;
  /** Deeplink authority. Default `'trae.ai-ide'`. */
  authority?: string;
  /** Deeplink route segment. Default `'side-chat'`. */
  route?: string;
  /** Project root used for relative `@` refs when overflowing to a file pointer. */
  projectRoot?: string;
  /** Source `@` refs in this prompt only. Default `'relative'`. */
  pathStyle?: PathStyle;
  /** Screenshot / still paths in this prompt only. Default `'absolute'`. */
  artifactPathStyle?: PathStyle;
  /** Encoded deeplinks longer than this switch to a file pointer. Default `8000` (query text also caps at 2000). */
  promptUrlLimit?: number;
}

/**
 * TRAE CLI (`trae-cli`). On by default.
 * Opens a Terminal launcher running interactive `traecli --cd <dir> -- "<prompt>"`.
 */
export interface TraeCliAgentOptions extends AgentOpenOptions {
  /** CLI binary override. Default: `traecli`, `~/.local/bin/traecli`, then `~/.local/share/traecli/current/traex`. */
  command?: string;
  /** Passed as `traecli --cd` and launcher `cd`; relative `@` refs strip against this root. */
  projectRoot?: string;
  /** Source `@` refs in this prompt only. Default `'relative'`. */
  pathStyle?: PathStyle;
  /** Screenshot / still paths in this prompt only. Default `'absolute'`. */
  artifactPathStyle?: PathStyle;
  /** Passed as `--permission-mode` (`default`, `auto`, `bypass_permissions`). */
  permissionMode?: string;
  /** Longer prompts switch to a file pointer in `auto` mode. Default `12000`. */
  promptArgLimit?: number;
}

/**
 * Qoder IDE / Desktop (`qoder-app`). On by default.
 * Opens `qoder://aicoding.aicoding-deeplink/chat?text=…` to prefill a chat session without auto-sending.
 */
export interface QoderAppAgentOptions extends AgentOpenOptions {
  /** Desktop bundle path override (macOS `.app` or Windows `.exe`). */
  appPath?: string;
  /** Deeplink scheme. Default `'qoder'`. */
  scheme?: string;
  /** Deeplink authority. Default `'aicoding.aicoding-deeplink'`. */
  authority?: string;
  /** Deeplink route segment. Default `'chat'`. */
  route?: string;
  /** Chat mode (`'agent'`, `'ask'`, `'chat'`, `'experts'`). */
  mode?: string;
  /** Whether to create a new chat (`true`) or prefill the active chat (`false`). */
  isNewChat?: boolean;
  /** Project root used for relative `@` refs when overflowing to a file pointer. */
  projectRoot?: string;
  /** Source `@` refs in this prompt only. Default `'relative'`. */
  pathStyle?: PathStyle;
  /** Screenshot / still paths in this prompt only. Default `'absolute'`. */
  artifactPathStyle?: PathStyle;
  /** Encoded deeplinks longer than this switch to a file pointer. Default `8000`. */
  promptUrlLimit?: number;
}

/**
 * Qoder CLI (`qoder-cli`). On by default.
 * Opens a Terminal launcher running `qodercli --prompt-interactive=<prompt>`, attaching images via `--attachment`.
 */
export interface QoderCliAgentOptions extends AgentOpenOptions {
  /** CLI binary override. Default: `qodercli`, `~/.local/bin/qodercli`, `~/.qoder/bin/qodercli`. */
  command?: string;
  /** Session folder and launcher `cd`; relative `@` refs strip against this root. */
  projectRoot?: string;
  /** Source `@` refs in this prompt only. Default `'relative'`. */
  pathStyle?: PathStyle;
  /** Screenshot / still paths in this prompt only. Default `'absolute'`. */
  artifactPathStyle?: PathStyle;
  /** Passed as `--permission-mode` (`default`, `plan`, `auto`, `bypass_permissions`, `accept_edits`, `dont_ask`). */
  permissionMode?: string;
  /** Passed as `--model`. Omitted → CLI default model. */
  model?: string;
  /** Attach captured screenshots and pasted images with `--attachment`. Default `true`. */
  attachImages?: boolean;
  /** Longer prompts switch to a file pointer in `auto` mode. Default `12000`. */
  promptArgLimit?: number;
}
