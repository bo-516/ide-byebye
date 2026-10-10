/**
 * Constants shared between the browser client and the Node server. Must remain
 * free of Node-only APIs.
 */
export const ROUTE_PREFIX = '/__intent-inspector';
/** npm package name. Bundlers print it as the plugin name; the console prefix below is built from it. */
export const PACKAGE_NAME = 'ide-byebye';
/** Prefix on every console line the plugin prints, from Node and from the page alike. */
export const LOG_PREFIX = `[${PACKAGE_NAME}]`;
export const ENDPOINTS = {
    client: `${ROUTE_PREFIX}/client.js`,
    agents: `${ROUTE_PREFIX}/agents`,
    resolve: `${ROUTE_PREFIX}/resolve`,
    send: `${ROUTE_PREFIX}/send`,
    vendor: `${ROUTE_PREFIX}/vendor`,
    /** Token-guarded liveness probe (Next.js bootstrap files check whether the server they point at is alive). */
    ping: `${ROUTE_PREFIX}/ping`,
    /** Same-origin session handoff for the Angular CLI bootstrap (only on runtimes created by `angularProxy`). */
    session: `${ROUTE_PREFIX}/session`,
    /**
     * Project-scoped session catalog. Plural on purpose: `session` is the Angular bootstrap handoff and must keep
     * returning that payload.
     */
    sessions: `${ROUTE_PREFIX}/sessions`,
};
/**
 * Session row statuses shared by the server catalog and the dialog menu.
 *
 * Boundary: these are language-neutral codes. The client maps them to copy. A status outside this list is treated as
 * `idle` by the menu.
 *
 * @type {readonly ['working', 'waiting', 'idle']}
 */
export const SESSION_STATUSES = ['working', 'waiting', 'idle'];
/**
 * Why a listed session cannot receive the next prompt.
 *
 * Boundary: only these codes are returned to the page. `open-in-terminal` and `live-unknown` stay on the row;
 * `cwd-missing` means the session directory is gone.
 *
 * @type {readonly ['open-in-terminal', 'live-unknown', 'cwd-missing']}
 */
export const SESSION_REASON_CODES = ['open-in-terminal', 'live-unknown', 'cwd-missing'];
/**
 * How a chosen session receives the prompt.
 *
 * @type {readonly ['prefill', 'resume-submit', 'submit']}
 */
export const SESSION_DELIVERIES = ['prefill', 'resume-submit', 'submit'];
/**
 * Send/list failures the page is allowed to branch on. Copy stays in the client i18n table.
 *
 * @type {readonly string[]}
 */
export const SESSION_ERROR_CODES = [
    'target-invalid',
    'target-missing',
    'target-busy',
    'sessions-unsupported',
    'ls-tls',
    'ls-requires-credentials',
    'ls-unreachable',
];
/** Catalog notices that are not per-row failures. */
export const SESSION_NOTICES = ['unsupported-format', 'ide-not-running'];
/** Default and inclusive bounds for how many sessions a menu may show. */
export const SESSION_LIMIT_DEFAULT = 20;
export const SESSION_LIMIT_MIN = 1;
export const SESSION_LIMIT_MAX = 50;
/** Codex rollout mtime window when `sessions.lookbackDays` is omitted. */
export const SESSION_LOOKBACK_DAYS_DEFAULT = 30;
/** First-line title cap, including the ellipsis when the source line is longer. */
export const SESSION_TITLE_MAX = 120;
/** Header carrying the per-session dev token. */
export const TOKEN_HEADER = 'x-intent-inspector-token';
/** Global variable name holding the injected `ClientConfig`. */
export const CLIENT_CONFIG_GLOBAL = '__CODE_INTENT_INSPECTOR__';
/** Marker attribute set on every node owned by the plugin's own UI. */
export const PLUGIN_NODE_ATTR = 'data-intent-inspector-ui';
/** The attribute the built-in stamper writes and the picker reads back. */
export const INSP_PATH_ATTR = 'data-insp-path';
/**
 * Most entries a portal selection's `renderChain` carries: the picked element's own location plus its mount points,
 * innermost first, one per file.
 *
 * Boundary: the client stops collecting at this count and the server keeps at most this many valid entries, so a
 * larger page-supplied chain is truncated, never rejected.
 *
 * @type {number}
 */
export const MAX_RENDER_CHAIN_ENTRIES = 5;
/**
 * Longest `renderChain` entry, in characters. Longer entries are dropped (client and server), not truncated, because
 * a cut `data-insp-path` would point at a different location.
 *
 * @type {number}
 */
export const MAX_RENDER_CHAIN_ENTRY_LENGTH = 1024;
export const DEFAULT_HOTKEY = 'Alt+Shift+I';
export const DEFAULT_OUTPUT_DIR = '.intent-inspector';
export const DEFAULT_MAX_SOURCE_CONTEXT_LINES = 60;
export const DEFAULT_MAX_COMPONENT_LINES = 300;
export const DEFAULT_MAX_TEXT_SNIPPET = 300;
export const DEFAULT_MAX_HTML_SNIPPET = 1000;
export const OVERLAY_Z_INDEX = 2147483646;
export const DIALOG_Z_INDEX = 2147483647;
/**
 * All recognized agent names shared by config validation, clients, and tests.
 *
 * Boundary: names in this list are identifiers only; an adapter still appears in the UI only after `buildRegistry`
 * registers it. Passing names not present here can make older clients reject or ignore that agent.
 *
 * @type {string[]} Ordered stable agent identifiers.
 */
export const ALL_AGENT_NAMES = [
    'clipboard',
    'file',
    'codex-app',
    'claude-app',
    'cursor-app',
    'grok-build',
    'claude-cli',
    'opencode',
    'devin-cli',
    'antigravity-ide',
    'antigravity',
    'devin-ide',
    'windsurf-ide',
];
