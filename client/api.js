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
 * @returns {{ resolve: Function, send: Function, agents: Function }} Inspector API methods used by the picker dialog.
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
    return {
        resolve: (payload) => postJson(ENDPOINTS.resolve, payload),
        send: (payload) => postJson(ENDPOINTS.send, payload),
        async agents() {
            const res = await fetch(`${resolveEndpointUrl(config, ENDPOINTS.agents)}?token=${encodeURIComponent(config.token)}`, {
                headers,
                credentials: 'same-origin',
            });
            return (await res.json());
        },
    };
}
