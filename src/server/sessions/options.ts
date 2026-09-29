import {
    SESSION_LIMIT_DEFAULT,
    SESSION_LIMIT_MAX,
    SESSION_LIMIT_MIN,
    SESSION_LOOKBACK_DAYS_DEFAULT,
} from '../../shared/constants.js';

/**
 * Clamp a menu length into the allowed 1–50 window.
 *
 * Boundary: non-finite values (including a missing option) become the default 20. Fractional numbers are truncated
 * toward zero before clamping, so `20.9` is 20.
 *
 * @param {unknown} value Configured `sessions.limit`. Non-numbers become the default.
 * @returns {number} Integer from 1 to 50.
 */
function clampLimit(value: unknown) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return SESSION_LIMIT_DEFAULT;
    return Math.min(SESSION_LIMIT_MAX, Math.max(SESSION_LIMIT_MIN, Math.floor(parsed)));
}

/**
 * Clamp the Codex mtime lookback.
 *
 * Boundary: omitted or non-finite values use 30 days. Zero and negative values also fall back to 30 so a typo cannot
 * hide every rollout. The number is a day count, not a directory-name date.
 *
 * @param {unknown} value Configured `sessions.lookbackDays`. Non-positive values become the default.
 * @returns {number} Positive day count.
 */
function clampLookback(value: unknown) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return SESSION_LOOKBACK_DAYS_DEFAULT;
    return Math.floor(parsed);
}

/**
 * Read the session-menu options from a Codex or Grok adapter config.
 *
 * Boundary: `sessions: false` disables the menu. `true`, a missing field, or an object all enable it — the object
 * only overrides limit, lookback, and home. `home` is trimmed; a blank string means "use the agent default".
 * This does not look at the page payload.
 *
 * @param {Record<string, unknown>} [config] Adapter config (`sessions` may be boolean or {@link SessionPickerOptions}).
 * @returns {{ enabled: boolean, limit: number, lookbackDays: number, home: string | undefined }} Normalized picker options.
 */
export function readSessionPicker(config: any = {}) {
    if (config?.sessions === false) {
        return {
            enabled: false,
            limit: SESSION_LIMIT_DEFAULT,
            lookbackDays: SESSION_LOOKBACK_DAYS_DEFAULT,
            home: undefined,
        };
    }
    const opts = config?.sessions && typeof config.sessions === 'object' ? config.sessions : {};
    const home = typeof opts.home === 'string' && opts.home.trim() ? opts.home.trim() : undefined;
    return {
        enabled: true,
        limit: clampLimit(opts.limit),
        lookbackDays: clampLookback(opts.lookbackDays),
        home,
    };
}
