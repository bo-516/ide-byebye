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
    async listAvailable() {
        const entries = [...this.adapters.values()];
        const results = await Promise.all(entries.map(async (adapter) => {
            try {
                const availability = await adapter.isAvailable();
                return { name: adapter.name, ...availability };
            }
            catch (err) {
                return {
                    name: adapter.name,
                    available: false,
                    reason: err instanceof Error ? err.message : String(err),
                };
            }
        }));
        return results;
    }
}
