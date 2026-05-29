import { ENDPOINTS, TOKEN_HEADER } from '../shared/constants.js';

/**
 * Builds an absolute inspector endpoint URL from the injected browser config.
 *
 * Boundary: `config.apiOrigin` is expected to be the local Vite inspector origin; if it is missing, relative endpoints
 * are used as a compatibility fallback and will follow the current page domain. Passing an endpoint without a leading
 * slash can create an invalid URL and route requests away from the inspector server.
 *
 * @param {Record<string, unknown>} config Browser config injected by the Vite plugin.
 * @param {string} endpoint Inspector endpoint path.
 * @returns {string} Absolute or fallback relative URL for the inspector endpoint.
 */
function resolveEndpointUrl(config, endpoint) {
    if (typeof config.apiOrigin === 'string' && config.apiOrigin) {
        return `${config.apiOrigin}${endpoint}`;
    }

    return endpoint;
}

/**
 * Creates the browser API client for inspector routes.
 *
 * Boundary: every request carries the per-process token in both query string and header so same-origin and configured
 * cross-origin calls can pass the server guard. A wrong `apiOrigin` sends route resolution, agent discovery, and agent
 * send requests to the wrong host.
 *
 * @param {Record<string, unknown>} config Browser config injected by the Vite plugin.
 * @returns {{ resolve: Function, send: Function, agents: Function, codexSessions: Function, codexSession: Function, codexTurn: Function, codexTurnStream: Function }} Inspector API methods used by the picker dialog.
 */
export function createApi(config) {
    const headers = {
        'Content-Type': 'application/json',
        [TOKEN_HEADER]: config.token,
    };

    /**
     * Sends a JSON POST to a token-authenticated inspector endpoint.
     *
     * Boundary: `url` must be one of the known inspector route paths and `body` must be JSON-serializable. Missing or
     * wrong tokens fail server-side; wrong endpoint paths make the request bypass the inspector router.
     *
     * @param {string} url Inspector endpoint path.
     * @param {Record<string, unknown>} body JSON payload sent to the inspector server.
     * @returns {Promise<Record<string, unknown>>} Parsed JSON response from the inspector server.
     */
    async function postJson(url, body) {
        const res = await fetch(`${resolveEndpointUrl(config, url)}?token=${encodeURIComponent(config.token)}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            credentials: 'same-origin',
        });
        return (await res.json());
    }

    /**
     * Sends a JSON POST and consumes a server-sent event response.
     *
     * Boundary: this is used instead of EventSource because Codex turns need a POST body. Non-SSE responses fall back
     * to JSON so disabled/older routes still surface their final error payload.
     *
     * @param {string} url Inspector endpoint path.
     * @param {Record<string, unknown>} body JSON payload sent to the inspector server.
     * @param {{ onEvent?: Function }} handlers Optional progress-event callbacks.
     * @returns {Promise<Record<string, unknown>>} Final `result` event payload, or a JSON fallback response.
     */
    async function postEventStream(url, body, handlers = {}) {
        const params = new URLSearchParams({ token: config.token, stream: '1' });
        const res = await fetch(`${resolveEndpointUrl(config, url)}?${params.toString()}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            credentials: 'same-origin',
        });
        const contentType = res.headers.get('content-type') || '';
        if (!res.body || !contentType.includes('text/event-stream')) {
            return (await res.json());
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let result = null;

        const handleFrame = (frame) => {
            let event = 'message';
            const data = [];
            for (const rawLine of frame.split(/\r?\n/)) {
                const line = rawLine.trimEnd();
                if (!line || line.startsWith(':'))
                    continue;
                if (line.startsWith('event:')) {
                    event = line.slice(6).trim();
                    continue;
                }
                if (line.startsWith('data:')) {
                    data.push(line.slice(5).trimStart());
                }
            }
            if (!data.length)
                return;
            let payload;
            try {
                payload = JSON.parse(data.join('\n'));
            }
            catch {
                payload = { type: event, text: data.join('\n') };
            }
            if (event === 'progress') {
                handlers.onEvent?.(payload);
            }
            else if (event === 'result') {
                result = payload;
            }
        };

        for (;;) {
            const { value, done } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            let index = buffer.indexOf('\n\n');
            while (index >= 0) {
                handleFrame(buffer.slice(0, index));
                buffer = buffer.slice(index + 2);
                index = buffer.indexOf('\n\n');
            }
        }
        buffer += decoder.decode();
        if (buffer.trim())
            handleFrame(buffer);
        return result ?? { ok: false, agent: 'codex-sdk', requestId: '', error: 'Codex stream ended without a result' };
    }

    return {
        resolve: (payload) => postJson(ENDPOINTS.resolve, payload),
        send: (payload) => postJson(ENDPOINTS.send, payload),
        codexTurn: (payload) => postJson(ENDPOINTS.codexTurn, payload),
        codexTurnStream: (payload, handlers) => postEventStream(ENDPOINTS.codexTurn, payload, handlers),
        async agents() {
            const res = await fetch(`${resolveEndpointUrl(config, ENDPOINTS.agents)}?token=${encodeURIComponent(config.token)}`, {
                headers,
                credentials: 'same-origin',
            });
            return (await res.json());
        },
        async codexSessions(days) {
            const params = new URLSearchParams({ token: config.token });
            if (days != null)
                params.set('days', String(days));
            const res = await fetch(`${resolveEndpointUrl(config, ENDPOINTS.codexSessions)}?${params.toString()}`, {
                headers,
                credentials: 'same-origin',
            });
            return (await res.json());
        },
        async codexSession(id, days) {
            const params = new URLSearchParams({ token: config.token, id });
            if (days != null)
                params.set('days', String(days));
            const res = await fetch(`${resolveEndpointUrl(config, ENDPOINTS.codexSession)}?${params.toString()}`, {
                headers,
                credentials: 'same-origin',
            });
            return (await res.json());
        },
    };
}
