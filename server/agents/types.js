/** Build a successful base result skeleton. */
export function baseResult(name, requestId, events) {
    return { ok: true, agent: name, requestId, events };
}
