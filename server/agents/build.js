import { coerceAgentConfig } from '../config.js';
import { AgentRegistry } from './registry.js';
import { clipboardAdapter } from './clipboard.js';
import { fileAdapter } from './file.js';
import { createCodexSdkAdapter } from './codex-sdk.js';
import { createCodexAppServerAdapter } from './codex-app-server.js';
import { createCodexAppAdapter } from './codex-app.js';
import { createClaudeAppAdapter } from './claude-app.js';
import { createCursorAppAdapter } from './cursor-app.js';

/**
 * Construct the agent registry from the (already-resolved) agent config map.
 *
 * Boundary: `clipboard` and `file` are enabled unless explicitly disabled; app/SDK adapters require truthy config
 * entries. Unknown agent keys are ignored so stale config does not register accidental adapters.
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
    const codexApp = coerceAgentConfig(agents.codexApp);
    if (codexApp)
        registry.register(createCodexAppAdapter(codexApp));
    const codexSdk = coerceAgentConfig(agents.codexSdk);
    if (codexSdk)
        registry.register(createCodexSdkAdapter(codexSdk));
    const codexAppServer = coerceAgentConfig(agents.codexAppServer);
    if (codexAppServer)
        registry.register(createCodexAppServerAdapter(codexAppServer));
    const claudeApp = coerceAgentConfig(agents.claudeApp);
    if (claudeApp)
        registry.register(createClaudeAppAdapter(claudeApp));
    const cursorApp = coerceAgentConfig(agents.cursorApp);
    if (cursorApp)
        registry.register(createCursorAppAdapter(cursorApp));
    return registry;
}
