/**
 * Primitive option types shared by {@link module:./agents} and {@link module:./options}.
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
  | 'claude-cli'
  | 'opencode'
  | 'devin-cli'
  | 'antigravity-ide'
  | 'antigravity'
  | 'devin-ide'
  | 'windsurf-ide'
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
