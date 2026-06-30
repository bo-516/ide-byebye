import { coerceAgentConfig } from '../config.js';
import { AgentRegistry } from './registry.js';
import { clipboardAdapter } from './clipboard.js';
import { fileAdapter } from './file.js';
import { createCodexAppAdapter } from './codex-app.js';
import { createClaudeAppAdapter } from './claude-app.js';
import { createCursorAppAdapter } from './cursor-app.js';

/**
 * Construct the agent registry from the (already-resolved) agent config map.
 *
 * Boundary: every agent is enabled by default; pass `agents.<name>: false` (or `{ enabled: false }` for the app
 * agents) to opt out. App agents also accept an object config (e.g. `cursorApp.workspace`). Unknown agent keys are
 * ignored so stale config does not register accidental adapters.
 *
 * @param {Record<string, unknown>} agents Resolved `agents` option map from plugin config.
 * @returns {AgentRegistry} Registry containing every enabled adapter.
 */
export function buildRegistry(agents) {
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
    return registry;
}
