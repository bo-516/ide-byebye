import { ALL_AGENT_NAMES } from '../../shared/constants.js';
import { resolvePromptPathStyleOptions } from '../config.js';

/** `type` stamped on a delivered payload when a custom client configures none. */
export const DEFAULT_DELIVERY_MESSAGE_TYPE = 'ide-byebye:prompt';

/** `source` stamped on every delivered payload so a listener can ignore foreign messages. */
export const DELIVERY_SOURCE = 'ide-byebye';

/** Delivery payload contract version; bumped only when a field changes meaning. */
export const DELIVERY_PAYLOAD_VERSION = 1;

/** Request timeout for HTTP delivery when the target does not set one. */
export const DEFAULT_DELIVERY_TIMEOUT_MS = 8000;

/** Methods accepted for HTTP delivery; anything else falls back to `POST`. */
const HTTP_METHODS = ['POST', 'PUT', 'PATCH'];

/** Windows a `postMessage` delivery may address from inside the previewed page. */
const WINDOW_TARGETS = ['parent', 'top', 'opener'];

/** Agent ids must stay registry- and DOM-attribute-safe (no spaces, no slashes). */
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Read the per-target prompt path styles, or `undefined` when the target inherits the plugin-level ones.
 *
 * Boundary: only an explicit `pathStyle` / `artifactPathStyle` on the target opts into a rebuilt prompt. Returning
 * `undefined` for a target that sets neither is what keeps a custom client on the exact prompt every other agent gets,
 * including a plugin-level `pathStyle: 'absolute'` that a blanket re-resolve would silently downgrade to relative.
 * Setting only one key resolves the other to its documented default (source relative, artifacts absolute).
 *
 * @param {Record<string, unknown>} entry Raw custom-client entry from plugin config.
 * @returns {{ pathStyle: 'relative' | 'absolute', artifactPathStyle: 'relative' | 'absolute' } | undefined} Prompt path styles, or undefined to inherit.
 */
function readPathStyles(entry) {
    if (entry.pathStyle === undefined && entry.artifactPathStyle === undefined)
        return undefined;
    return resolvePromptPathStyleOptions(entry);
}

/**
 * Normalize the `http` transport fields of a custom client.
 *
 * Boundary: `url` must be an absolute `http(s)` URL — the dev server POSTs to it directly, so a relative path or a
 * custom scheme has no meaning here. A missing or unusable URL is *not* dropped: it is reported through `configError`
 * so the footer button greys out with the reason instead of silently disappearing. Non-string header entries are
 * skipped, and a non-positive / non-numeric timeout falls back to {@link DEFAULT_DELIVERY_TIMEOUT_MS}.
 *
 * @param {Record<string, unknown>} entry Raw custom-client entry from plugin config.
 * @param {string} label Human label used in the config-error text.
 * @returns {{ url: string | null, method: string, headers: Record<string, string>, timeoutMs: number, configError?: string }} HTTP transport fields.
 */
function normalizeHttpTransport(entry, label) {
    const raw = typeof entry.url === 'string' ? entry.url.trim() : '';
    let url = null;
    try {
        const parsed = new URL(raw);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:')
            url = parsed.toString();
    }
    catch {
        url = null;
    }
    const method = typeof entry.method === 'string' && HTTP_METHODS.includes(entry.method.trim().toUpperCase())
        ? entry.method.trim().toUpperCase()
        : 'POST';
    const headers = {};
    if (entry.headers && typeof entry.headers === 'object') {
        for (const [key, value] of Object.entries(entry.headers)) {
            if (typeof key === 'string' && key.trim() && typeof value === 'string')
                headers[key] = value;
        }
    }
    const rawTimeout = Number(entry.timeoutMs);
    const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0
        ? Math.floor(rawTimeout)
        : DEFAULT_DELIVERY_TIMEOUT_MS;
    return {
        url,
        method,
        headers,
        timeoutMs,
        configError: url
            ? undefined
            : `${label} has no valid "url"; HTTP delivery needs an absolute http(s) endpoint.`,
    };
}

/**
 * Normalize the `postMessage` transport fields of a custom client.
 *
 * Boundary: `windowTarget` names the window the previewed page posts to — `parent` (embedded in a client webview /
 * iframe), `top`, or `opener` (opened from the client). An unknown token falls back to `parent`. `targetOrigin`
 * defaults to `'*'` because a dev preview's host origin is rarely known at config time; set it to the client origin
 * when the prompt may contain content you do not want another embedder to read.
 *
 * @param {Record<string, unknown>} entry Raw custom-client entry from plugin config.
 * @returns {{ messageType: string, windowTarget: string, targetOrigin: string }} postMessage transport fields.
 */
function normalizePostMessageTransport(entry) {
    const messageType = typeof entry.messageType === 'string' && entry.messageType.trim()
        ? entry.messageType.trim()
        : DEFAULT_DELIVERY_MESSAGE_TYPE;
    const windowTarget = typeof entry.windowTarget === 'string' && WINDOW_TARGETS.includes(entry.windowTarget.trim())
        ? entry.windowTarget.trim()
        : 'parent';
    const targetOrigin = typeof entry.targetOrigin === 'string' && entry.targetOrigin.trim()
        ? entry.targetOrigin.trim()
        : '*';
    return { messageType, windowTarget, targetOrigin };
}

/**
 * Normalize one custom prompt-delivery client into a target descriptor.
 *
 * Purpose: a custom client is an agent that hands the assembled prompt to an already-running app (its chat input box)
 * instead of opening one. Everything about it comes from config, so any client can support the handoff without a
 * built-in adapter.
 *
 * Boundary: `name` is the registry id and must be a non-blank `[a-z0-9._-]` token that does not shadow a built-in
 * agent — entries failing that are dropped entirely because there is nothing to key a button or a registry slot on.
 * Transport defaults to `http` when a `url` is present and `postMessage` otherwise. Config problems that still leave a
 * usable id (e.g. a malformed URL) survive as `configError` so the UI can explain them.
 *
 * @param {unknown} entry Raw entry from `agents.custom`.
 * @returns {Record<string, unknown> | null} Normalized target descriptor, or null when the entry is unusable.
 */
export function normalizeCustomAgent(entry: any) {
    if (!entry || typeof entry !== 'object')
        return null;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!NAME_PATTERN.test(name) || ALL_AGENT_NAMES.includes(name))
        return null;
    if (entry.enabled === false)
        return null;
    const label = typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : name;
    const title = typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : undefined;
    const transport = entry.transport === 'http' || entry.transport === 'postMessage'
        ? entry.transport
        : (typeof entry.url === 'string' && entry.url.trim() ? 'http' : 'postMessage');
    const base = { name, label, title, transport, pathStyles: readPathStyles(entry) };
    return transport === 'http'
        ? { ...base, ...normalizeHttpTransport(entry, label) }
        : { ...base, ...normalizePostMessageTransport(entry) };
}

/**
 * Normalize the whole `agents.custom` option into ordered target descriptors.
 *
 * Boundary: accepts an array or a single object for config ergonomics; anything else yields an empty list, which is
 * what keeps a plugin with no `agents.custom` byte-for-byte identical to before this option existed. Unusable entries
 * and duplicate names are dropped (first one wins) so a stale config cannot overwrite a registered adapter.
 *
 * @param {unknown} value Raw `agents.custom` value from plugin config.
 * @returns {Array<Record<string, unknown>>} Normalized custom prompt-delivery targets.
 */
export function normalizeCustomAgents(value) {
    const entries = Array.isArray(value)
        ? value
        : (value && typeof value === 'object' ? [value] : []);
    const seen = new Set();
    const targets = [];
    for (const entry of entries) {
        const target: any = normalizeCustomAgent(entry);
        if (!target || seen.has(target.name))
            continue;
        seen.add(target.name);
        targets.push(target);
    }
    return targets;
}
