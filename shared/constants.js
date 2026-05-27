/**
 * Constants shared between the browser client and the Node server. Must remain
 * free of Node-only APIs.
 */
export const ROUTE_PREFIX = '/__intent-inspector';
export const ENDPOINTS = {
    client: `${ROUTE_PREFIX}/client.js`,
    agents: `${ROUTE_PREFIX}/agents`,
    resolve: `${ROUTE_PREFIX}/resolve`,
    send: `${ROUTE_PREFIX}/send`,
    codexSessions: `${ROUTE_PREFIX}/codex/sessions`,
    codexSession: `${ROUTE_PREFIX}/codex/session`,
    codexTurn: `${ROUTE_PREFIX}/codex/turn`,
};
/** Header carrying the per-session dev token. */
export const TOKEN_HEADER = 'x-intent-inspector-token';
/** Global variable name holding the injected `ClientConfig`. */
export const CLIENT_CONFIG_GLOBAL = '__CODE_INTENT_INSPECTOR__';
/** Marker attribute set on every node owned by the plugin's own UI. */
export const PLUGIN_NODE_ATTR = 'data-intent-inspector-ui';
/** The attribute injected by code-inspector-plugin we read back. */
export const INSP_PATH_ATTR = 'data-insp-path';
export const DEFAULT_HOTKEY = 'Alt+Shift+I';
export const DEFAULT_OUTPUT_DIR = '.intent-inspector';
export const DEFAULT_MAX_SOURCE_CONTEXT_LINES = 60;
export const DEFAULT_MAX_COMPONENT_LINES = 300;
export const DEFAULT_MAX_TEXT_SNIPPET = 300;
export const DEFAULT_MAX_HTML_SNIPPET = 1000;
export const OVERLAY_Z_INDEX = 2147483646;
export const DIALOG_Z_INDEX = 2147483647;
export const ALL_AGENT_NAMES = [
    'clipboard',
    'file',
    'codex-app',
    'codex-sdk',
    'codex-app-server',
    'claude-app',
    'claude-cli',
    'claude-agent-sdk',
];
