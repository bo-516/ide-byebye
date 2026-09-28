export class AgentRegistry {
    adapters = new Map();
    register(adapter) {
        this.adapters.set(adapter.name, adapter);
    }
    has(name) {
        return this.adapters.has(name);
    }
    get(name) {
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
     * @param {string} name Registered agent name.
     * @returns {boolean} True when the dialog's session list (`›`) and `targetSessionId` are allowed.
     */
    sessionCapable(name) {
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
