import type { ImageDelivery } from '../../shared/constants.js';

/**
 * Adapter handle stored by name. `send` stays on the concrete object; this shape is only what the registry reads.
 *
 * Boundary: a missing `sessionsEnabled` means the session menu is off. A missing `imageInput` means `path` (images
 * reach the agent as prompt paths). `isAvailable` rejects are caught by `listAvailable`.
 */
interface RegisteredAdapter {
    name: string;
    sessionsEnabled?: boolean;
    imageInput?: ImageDelivery;
    isAvailable: () => Promise<{ available: boolean, reason?: string }>;
}

export class AgentRegistry {
    adapters = new Map();
    /**
     * @param adapter Adapter to store under `adapter.name`. A second register with the same name replaces the first.
     */
    register(adapter: RegisteredAdapter) {
        this.adapters.set(adapter.name, adapter);
    }
    /**
     * @param name Adapter id. Non-strings are looked up as-is and are false unless a key was stored under that value.
     *        `resolved.defaultAgent` is `unknown` until a host narrows it.
     */
    has(name: unknown) {
        return this.adapters.has(name);
    }
    /**
     * @param name Adapter id from the page or config. A name that was not registered throws. Non-strings throw the same way.
     */
    get(name: unknown) {
        const adapter = this.adapters.get(name);
        if (!adapter) {
            throw new Error(`Agent "${name}" is not enabled in the plugin configuration`);
        }
        return adapter;
    }
    names() {
        return [...this.adapters.keys()];
    }
    /**
     * Whether this agent may list and receive an existing session.
     *
     * Boundary: unknown names are false (they are not an error here). The flag is the adapter's `sessionsEnabled`
     * bit, set from config at registration — Codex, Grok, Devin CLI, and OpenCode default on, Antigravity IDE only when
     * `experimentalSessions` is true. Callers still re-check the id at send time.
     *
     * @param {unknown} name Registered agent name. A non-string is not capable.
     * @returns {boolean} True when the dialog's session list (`›`) and `targetSessionId` are allowed.
     */
    sessionCapable(name: unknown) {
        const adapter = this.adapters.get(name);
        return adapter?.sessionsEnabled === true;
    }
    /**
     * One `GET /agents` row per adapter: availability, session support, and how images reach it.
     *
     * Boundary: an `isAvailable` that throws becomes `available: false` with the error as `reason`; the other fields
     * are still reported. `images` falls back to `path` for adapters that do not declare `imageInput`.
     *
     * @returns {Promise<Array<{ name: string, available: boolean, reason?: string, sessions: boolean, images: ImageDelivery }>>}
     */
    async listAvailable() {
        const entries = [...this.adapters.values()];
        const results = await Promise.all(entries.map(async (adapter) => {
            const capabilities = {
                sessions: adapter.sessionsEnabled === true,
                images: adapter.imageInput ?? 'path',
            };
            try {
                const availability = await adapter.isAvailable();
                return { name: adapter.name, ...availability, ...capabilities };
            }
            catch (err) {
                return {
                    name: adapter.name,
                    available: false,
                    reason: err instanceof Error ? err.message : String(err),
                    ...capabilities,
                };
            }
        }));
        return results;
    }
}
