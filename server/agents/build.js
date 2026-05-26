import { coerceAgentConfig } from '../config.js';
import { AgentRegistry } from './registry.js';
import { clipboardAdapter } from './clipboard.js';
import { fileAdapter } from './file.js';
import { createClaudeCliAdapter } from './claude-cli.js';
import { createCodexSdkAdapter } from './codex-sdk.js';
import { createClaudeAgentSdkAdapter } from './claude-agent-sdk.js';
import { createCodexAppServerAdapter } from './codex-app-server.js';
import { createCodexAppAdapter } from './codex-app.js';
import { createClaudeAppAdapter } from './claude-app.js';
/**
 * Construct the agent registry from the (already-resolved) agent config map.
 * clipboard and file are enabled unless explicitly disabled; the rest require
 * opt-in via a truthy config entry.
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
    const claudeCli = coerceAgentConfig(agents.claudeCli);
    if (claudeCli)
        registry.register(createClaudeCliAdapter(claudeCli));
    const claudeAgentSdk = coerceAgentConfig(agents.claudeAgentSdk);
    if (claudeAgentSdk)
        registry.register(createClaudeAgentSdkAdapter(claudeAgentSdk));
    return registry;
}
