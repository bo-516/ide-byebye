/**
 * Dependency types for the inspector routes.
 *
 * Boundary: shapes stay `unknown`-flavored because `resolveOptions` produces option fields with `??` and page payloads
 * are attacker-controlled JSON; each route narrows at its edge.
 */

/**
 * Options the router reads. Several fields stay `unknown` because `resolveOptions` produces them with `??`.
 * `pathStyle` / `artifactPathStyle` are the resolved prompt unions.
 */
export type InspectorRouteOptions = {
    defaultAgent?: unknown;
    applyMode?: unknown;
    maxSourceContextLines?: unknown;
    pathStyle?: 'relative' | 'absolute';
    artifactPathStyle?: 'relative' | 'absolute';
};

/** One row shape `listSessions` must return so the session routes can map it. */
export type SessionListShape = {
    sessions?: readonly (Parameters<typeof import('./sessions/types.js').toPublicSession>[0])[] | null;
    delivery?: unknown;
    notice?: unknown;
} | null | undefined;

/**
 * Adapter methods the agents and send routes call.
 * Boundary: `listSessions` is optional because test doubles and non-session agents omit it.
 */
export type InspectorRouteAdapter = {
    isAvailable(): Promise<{ available?: boolean; reason?: string }>;
    send(request: unknown, context: unknown): Promise<{
        events?: unknown[];
        agent?: unknown;
        ok?: boolean;
        error?: unknown;
    }>;
    listSessions?(query: { projectRoot: string; fresh?: boolean }): Promise<SessionListShape>;
};

/**
 * Registry methods the router calls.
 * Boundary: names are `unknown` because `options.defaultAgent` and the page payload are not narrowed to `string`.
 * `sessionCapable` is optional so a route double that only lists agents still assigns; the session routes assert it.
 */
export type InspectorRouteRegistry = {
    has(name: unknown): boolean;
    names(): string[];
    listAvailable(): Promise<unknown[]>;
    get(name: unknown): InspectorRouteAdapter;
    sessionCapable?(name: unknown): boolean;
};

/**
 * Logger calls on the send path.
 * Boundary: `info` and `warn` are not called here. They are part of the type so the shared logger object assigns.
 */
export type InspectorRouteLogger = {
    info?(...args: unknown[]): void;
    warn?(...args: unknown[]): void;
    error(...args: unknown[]): void;
    audit(...args: unknown[]): void;
};

/**
 * Dependencies for every inspector route.
 * Boundary: `session` exists only for the Angular bootstrap handoff. `sessionStore` is forwarded, not read here.
 */
export type InspectorRouteDeps = {
    options: InspectorRouteOptions;
    token: string;
    registry: InspectorRouteRegistry;
    sessionStore: unknown;
    logger: InspectorRouteLogger;
    clientCode: string;
    projectRoot: string;
    outputDirAbs: string;
    session?: () => Record<string, unknown>;
};
