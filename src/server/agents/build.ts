import { coerceAgentConfig } from '../config.js';
import { AgentRegistry } from './registry.js';
import { clipboardAdapter } from './clipboard.js';
import { fileAdapter } from './file.js';
import { createCodexAppAdapter } from './codex-app.js';
import { createClaudeAppAdapter } from './claude-app.js';
import { createCursorAppAdapter } from './cursor-app.js';
import { createGrokBuildAdapter } from './grok-build.js';
import { createClaudeCliAdapter } from './claude-cli.js';
import { createOpenCodeAdapter } from './opencode.js';
import { createAntigravityIdeAdapter } from './antigravity-ide.js';
import { createAntigravityAdapter } from './antigravity.js';
import { createDevinCliAdapter } from './devin-cli.js';
import { createDevinIdeAdapter } from './devin-ide.js';
import { createWindsurfIdeAdapter } from './windsurf-ide.js';
import { createCustomAgentAdapters } from './custom-client.js';

/**
 * Construct the agent registry from the (already-resolved) agent config map.
 *
 * Boundary: clipboard, file, Codex, Claude, Cursor, Grok Build, Claude Code CLI (`claudeCli`), OpenCode
 * (`opencode`), and Devin CLI (`devinCli`) are enabled by default; pass `agents.<name>: false` (or
 * `{ enabled: false }`) to opt out. A missing CLI or app only greys the row out (`isAvailable`).
 * Antigravity IDE (`antigravityIde`), Antigravity CLI (`antigravity`), Devin Desktop (`devinIde`), and
 * Windsurf (`windsurfIde`) stay
 * unregistered until the host sets `true` or an options object — omitting them leaves the footer unchanged. App agents
 * also accept an object config (e.g. `cursorApp.workspace` / `grokBuild.command`). `agents.custom` adds config-defined
 * clients that receive the prompt in their own input box; it is empty unless the host project declares it. Custom
 * clients are registered last and cannot shadow a built-in name. Unknown agent keys are ignored so stale config does
 * not register accidental adapters.
 *
 * @param {Record<string, unknown>} agents Resolved `agents` option map from plugin config.
 * @returns {AgentRegistry} Registry containing every enabled adapter.
 */
export function buildRegistry(agents: Record<string, unknown>) {
    const registry = new AgentRegistry();
    if (agents.clipboard !== false)
        registry.register(clipboardAdapter);
    if (agents.file !== false)
        registry.register(fileAdapter);
    const codexApp = coerceAgentConfig(agents.codexApp ?? true);
    if (codexApp)
        registry.register(createCodexAppAdapter(codexApp));
    const claudeApp = coerceAgentConfig(agents.claudeApp ?? true);
    if (claudeApp)
        registry.register(createClaudeAppAdapter(claudeApp));
    const cursorApp = coerceAgentConfig(agents.cursorApp ?? true);
    if (cursorApp)
        registry.register(createCursorAppAdapter(cursorApp));
    const grokBuild = coerceAgentConfig(agents.grokBuild ?? true);
    if (grokBuild)
        registry.register(createGrokBuildAdapter(grokBuild));
    const claudeCli = coerceAgentConfig(agents.claudeCli ?? true);
    if (claudeCli)
        registry.register(createClaudeCliAdapter(claudeCli));
    const opencode = coerceAgentConfig(agents.opencode ?? true);
    if (opencode)
        registry.register(createOpenCodeAdapter(opencode));
    const devinCli = coerceAgentConfig(agents.devinCli ?? true);
    if (devinCli)
        registry.register(createDevinCliAdapter(devinCli));
    // Opt-in: no `?? true`, so a project that never mentions these keys does not grow the footer.
    const antigravityIde = coerceAgentConfig(agents.antigravityIde);
    if (antigravityIde)
        registry.register(createAntigravityIdeAdapter(antigravityIde));
    const antigravity = coerceAgentConfig(agents.antigravity);
    if (antigravity)
        registry.register(createAntigravityAdapter(antigravity));
    const devinIde = coerceAgentConfig(agents.devinIde);
    if (devinIde)
        registry.register(createDevinIdeAdapter(devinIde));
    const windsurfIde = coerceAgentConfig(agents.windsurfIde);
    if (windsurfIde)
        registry.register(createWindsurfIdeAdapter(windsurfIde));
    for (const adapter of createCustomAgentAdapters(agents.custom))
        registry.register(adapter);
    return registry;
}
