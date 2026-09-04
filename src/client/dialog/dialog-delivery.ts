/**
 * Browser half of the custom-client prompt handoff.
 *
 * Purpose: a `postMessage` delivery target lives in the window that embeds the previewed page (a desktop client's
 * webview / iframe, or the window that opened it), which only the page can address. The server adapter therefore
 * returns a `deliver` instruction and this module performs the actual post.
 * Boundary: pure with respect to the caller's window — every function takes the window it should act on, so the logic
 * is testable without a DOM. Nothing here inspects the payload; it is built and owned by the server.
 */

/**
 * Resolve the window a `postMessage` delivery should address.
 *
 * Boundary: returns null when the requested window does not exist or is the page itself — an un-embedded preview has
 * `window.parent === window`, and posting there would silently deliver the prompt to the page that produced it. The
 * caller must surface that as a failure rather than reporting success.
 *
 * @param {string} windowTarget Requested window: `parent`, `top`, or `opener`.
 * @param {Window} win Window the previewed page runs in.
 * @returns {Window | null} Target window, or null when nothing usable is embedded around the page.
 */
export function resolveDeliveryWindow(windowTarget, win: any) {
    const target = windowTarget === 'top'
        ? win.top
        : (windowTarget === 'opener' ? win.opener : win.parent);
    if (!target || target === win)
        return null;
    return target;
}

/**
 * Post an agent's delivery payload to the embedding client window.
 *
 * Boundary: `deliver` comes from the server adapter and carries the target window, target origin, and payload. A
 * missing target window (page not embedded) and a throwing `postMessage` (cross-origin restriction, closed window)
 * both return `ok: false` with a reason code instead of throwing, so the dialog can keep the user's intent on screen.
 * A successful post only proves the message left the page — the receiving client owns the rest.
 *
 * @param {{ windowTarget?: string, targetOrigin?: string, payload: Record<string, unknown> }} deliver Delivery instruction from the send result.
 * @param {Window} [win] Window the previewed page runs in; defaults to the live one.
 * @returns {{ ok: true } | { ok: false, reason: 'no-window' | 'post-failed', error?: string }} Delivery outcome.
 */
export function deliverPromptToClient(deliver: any, win: any = window) {
    const target = resolveDeliveryWindow(deliver?.windowTarget, win);
    if (!target)
        return { ok: false, reason: 'no-window' };
    try {
        target.postMessage(deliver.payload, deliver.targetOrigin || '*');
        return { ok: true };
    }
    catch (err) {
        return { ok: false, reason: 'post-failed', error: err instanceof Error ? err.message : String(err) };
    }
}
