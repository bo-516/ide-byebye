/**
 * One progress event an adapter pushes through `context.emit`.
 *
 * Boundary: callers only read `type` and `text`. A missing `text` stays omitted.
 */
export interface AgentEmitEvent {
    type: string;
    text?: string;
}

/**
 * Build a successful base result skeleton.
 *
 * Boundary: `events` is stored as given. An empty list is a successful send that emitted nothing.
 *
 * @param name Adapter id copied onto `agent`.
 * @param requestId Request id copied through. An empty string is preserved.
 * @param events Events already emitted for this send.
 * @returns Result object with `ok: true`.
 */
export function baseResult(name: string, requestId: string, events: AgentEmitEvent[]) {
    return { ok: true, agent: name, requestId, events };
}
