/**
 * Adapter handle stored by name. `send` stays on the concrete object; this shape is only what the registry reads.
 *
 * Boundary: a missing `sessionsEnabled` means the session menu is off. `isAvailable` rejects are caught by `listAvailable`.
 */
interface RegisteredAdapter {
    name: string;
    sessionsEnabled?: boolean;
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
     * bit, set from config at registration — Codex and Grok default on, Antigravity only when
     * `experimentalSessions` is true. Callers still re-check the id at send time.
     *
     * @param {unknown} name Registered agent name. A non-string is not capable.
     * @returns {boolean} True when the dialog's session list (`›`) and `targetSessionId` are allowed.
     */
    sessionCapable(name: unknown) {
        const adapter = this.adapters.get(name);
        return adapter?.sessionsEnabled === true;
    }
    async listAvailable() {
        const entries = [...this.adapters.values()];
        const results = await Promise.all(entries.map(async (adapter) => {
            try {
                const availability = await adapter.isAvailable();
                return { name: adapter.name, ...availability, sessions: adapter.sessionsEnabled === true };
            }
            catch (err) {
                return {
                    name: adapter.name,
                    available: false,
                    reason: err instanceof Error ? err.message : String(err),
                    sessions: adapter.sessionsEnabled === true,
                };
            }
        }));
        return results;
    }
}
