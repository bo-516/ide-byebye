import { truncateSnippet, collapseWhitespace } from '../../shared/util.js';
import { buildPrompt } from '../prompt.js';
import { collectClaudeAppFiles } from './claude-app.js';
import {
    DEFAULT_DELIVERY_MESSAGE_TYPE,
    DELIVERY_PAYLOAD_VERSION,
    DELIVERY_SOURCE,
    normalizeCustomAgents,
} from './custom-client-config.js';

export {
    DEFAULT_DELIVERY_MESSAGE_TYPE,
    DEFAULT_DELIVERY_TIMEOUT_MS,
    DELIVERY_PAYLOAD_VERSION,
    DELIVERY_SOURCE,
    normalizeCustomAgent,
    normalizeCustomAgents,
} from './custom-client-config.js';

/** Max characters of a failing HTTP response echoed back into the dialog error. */
const ERROR_DETAIL_LIMIT = 200;

/**
 * Resolve the prompt text delivered to a custom client.
 *
 * Boundary: targets that set no path-style override reuse `context.prompt` — the exact text every other agent gets —
 * so a custom client never diverges from the plugin-level `pathStyle` / `artifactPathStyle`. Only an explicit override
 * rebuilds it.
 *
 * @param {Record<string, unknown>} request Normalized intent request.
 * @param {{ prompt: string }} context Agent context carrying the already-assembled prompt.
 * @param {Record<string, unknown>} target Normalized custom-client descriptor.
 * @returns {string} Prompt text to hand to the client.
 */
export function resolveDeliveryPrompt(request, context: any, target: any) {
    return target.pathStyles ? buildPrompt(request, target.pathStyles) : context.prompt;
}

/**
 * Build the JSON payload delivered to a custom client.
 *
 * Purpose: this is the wire contract a client implements to receive prompts — `prompt` is the ready-to-insert text for
 * its input box, and the remaining fields let a richer client attach files or route the request itself.
 *
 * Boundary: `files` are absolute source paths (primary selection first, then `@code` chips); `screenshots` and
 * `recordings` are absolute artifact paths already written under `outputDir`, so a client renders them by reading
 * disk, not by decoding data URLs. `type` / `source` / `version` identify the message to a `postMessage` listener that
 * also receives unrelated traffic.
 *
 * @param {Record<string, unknown>} request Normalized intent request with persisted artifacts.
 * @param {string} prompt Prompt text resolved for this target.
 * @param {Record<string, unknown>} target Normalized custom-client descriptor.
 * @returns {Record<string, unknown>} Delivery payload sent over HTTP or `postMessage`.
 */
export function buildDeliveryPayload(request: any, prompt, target: any) {
    const screenshots = (request.screenshots ?? []).map((shot) => shot?.filePath).filter(Boolean);
    const recordings = (request.recordings ?? []).map((clip) => clip?.stillFramePath).filter(Boolean);
    return {
        type: target.messageType ?? DEFAULT_DELIVERY_MESSAGE_TYPE,
        source: DELIVERY_SOURCE,
        version: DELIVERY_PAYLOAD_VERSION,
        agent: target.name,
        requestId: request.id,
        createdAt: request.createdAt,
        prompt,
        intent: request.intent ?? '',
        applyMode: request.applyMode,
        projectRoot: request.projectRoot,
        pageUrl: request.pageUrl,
        selection: request.selection,
        files: collectClaudeAppFiles(request, { includeScreenshots: false }),
        screenshots,
        recordings,
    };
}

/**
 * Summarize a failing delivery response for the dialog error.
 *
 * Boundary: body reads are best effort — a client that answers with a non-2xx status and no readable body still yields
 * a useful status-only message instead of throwing a second error inside the failure path.
 *
 * @param {Record<string, unknown>} res Fetch response for a failed delivery.
 * @returns {Promise<string>} Collapsed, truncated body text, or an empty string.
 */
async function readErrorDetail(res: any) {
    try {
        const text = await res.text();
        return truncateSnippet(collapseWhitespace(String(text ?? '')), ERROR_DETAIL_LIMIT) ?? '';
    }
    catch {
        return '';
    }
}

/**
 * POST the delivery payload to a custom client's HTTP endpoint.
 *
 * Boundary: the dev server — not the browser — makes this request, so the client endpoint needs no CORS handling and
 * may bind loopback only. A non-2xx status throws with the client's own message; the abort signal keeps an unreachable
 * or hanging client from stalling the send route past the configured timeout.
 *
 * @param {Function} fetchImpl Fetch implementation (injected in tests).
 * @param {Record<string, unknown>} target Normalized custom-client descriptor with `url`, `method`, `headers`, `timeoutMs`.
 * @param {Record<string, unknown>} payload Delivery payload.
 * @returns {Promise<void>} Resolves when the client accepted the prompt.
 */
async function postDelivery(fetchImpl, target: any, payload) {
    const res = await fetchImpl(target.url, {
        method: target.method,
        headers: { 'Content-Type': 'application/json', ...target.headers },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(target.timeoutMs),
    });
    if (!res?.ok) {
        const detail = await readErrorDetail(res);
        throw new Error(`${target.label} responded ${res?.status ?? 'without a status'}${detail ? `: ${detail}` : ''}`);
    }
}

/**
 * Create an adapter that delivers the prompt into an already-running client instead of opening an app.
 *
 * Purpose: backs `agents.custom`, so any client (this plugin ships none by default) can receive the same handoff the
 * built-in app agents produce — the assembled prompt lands in its input box.
 *
 * Boundary: two transports, chosen per target. `http` posts server-side and reports the client's own failure. Delivery
 * over `postMessage` cannot happen on the server: the adapter returns a `deliver` instruction and the browser client
 * posts it to the embedding window, so the result is "handed over", not "confirmed received". A target carrying a
 * `configError` (e.g. an unusable `url`) reports unavailable rather than sending.
 *
 * @param {Record<string, unknown>} target Normalized custom-client descriptor from {@link normalizeCustomAgents}.
 * @param {{ fetch?: Function }} [deps] Injectable dependencies; defaults to the global `fetch`.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter registered by the agent registry.
 */
export function createCustomAgentAdapter(target: any, deps: any = {}) {
    const fetchImpl = deps.fetch ?? ((...args) => (globalThis as any).fetch(...args));
    return {
        name: target.name,
        async isAvailable() {
            return target.configError
                ? { available: false, reason: target.configError }
                : { available: true };
        },
        async send(request, context) {
            const events = [{ type: 'started', text: `Sending prompt to ${target.label}` }];
            context.emit(events[0]);
            try {
                if (target.configError)
                    throw new Error(target.configError);
                const prompt = resolveDeliveryPrompt(request, context, target);
                const payload = buildDeliveryPayload(request, prompt, target);
                if (target.transport === 'http') {
                    await postDelivery(fetchImpl, target, payload);
                    const completed = { type: 'completed', text: `${target.label} received the prompt` };
                    events.push(completed);
                    context.emit(completed);
                    return {
                        ok: true,
                        agent: target.name,
                        requestId: request.id,
                        events,
                        output: `Sent the prompt to ${target.label} (${target.url}).`,
                    };
                }
                // postMessage: the previewed page owns the window handle, so the browser client finishes the handoff.
                const handed = { type: 'completed', text: `Prompt handed to the page for ${target.label}` };
                events.push(handed);
                context.emit(handed);
                return {
                    ok: true,
                    agent: target.name,
                    requestId: request.id,
                    events,
                    output: `Prompt handed to the page for delivery to ${target.label}.`,
                    deliver: {
                        transport: 'postMessage',
                        label: target.label,
                        windowTarget: target.windowTarget,
                        targetOrigin: target.targetOrigin,
                        payload,
                    },
                };
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                const failed = { type: 'failed', text: error };
                events.push(failed);
                context.emit(failed);
                return {
                    ok: false,
                    agent: target.name,
                    requestId: request.id,
                    events,
                    error,
                };
            }
        },
    };
}

/**
 * Create every configured custom-client adapter in config order.
 *
 * @param {unknown} value Raw `agents.custom` option.
 * @param {{ fetch?: Function }} [deps] Injectable dependencies forwarded to each adapter.
 * @returns {Array<{ name: string, isAvailable: Function, send: Function }>} Adapters ready to register.
 */
export function createCustomAgentAdapters(value, deps: any = {}) {
    return normalizeCustomAgents(value).map((target) => createCustomAgentAdapter(target, deps));
}
