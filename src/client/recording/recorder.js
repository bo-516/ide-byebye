import { PLUGIN_NODE_ATTR } from '../../shared/constants.js';
import { loadRrwebRecord } from '../lib/vendor-loader.js';

/** Default rolling-buffer length when the plugin config does not override it. */
export const DEFAULT_MAX_DURATION_MS = 30000;
/** How often rrweb is asked to emit a fresh full snapshot, so any clip range has a nearby base snapshot. */
const CHECKOUT_EVERY_MS = 10000;
/** rrweb `EventType.Meta` numeric tag. */
const RRWEB_META = 4;
/** rrweb `EventType.FullSnapshot` numeric tag. */
const RRWEB_FULL_SNAPSHOT = 2;

/**
 * Resolve the checkpoint index for a full snapshot: the Meta event right before it, or the snapshot itself.
 * Boundary: replay needs a Meta+FullSnapshot pair to start, so a clip/trim must begin at the Meta when one precedes the
 * snapshot. `fullIdx` must point at a FullSnapshot event in `events`.
 * @param {Array<Record<string, unknown>>} events rrweb event stream.
 * @param {number} fullIdx Index of a FullSnapshot event.
 * @returns {number} Index where a replayable segment can begin.
 */
function checkpointIndex(events, fullIdx) {
    return fullIdx > 0 && events[fullIdx - 1] && events[fullIdx - 1].type === RRWEB_META ? fullIdx - 1 : fullIdx;
}

/**
 * Total wall-clock duration of an event stream in milliseconds.
 * Boundary: an empty or single-event stream has zero duration. Timestamps are rrweb absolute epoch millis.
 * @param {Array<Record<string, unknown>>} events rrweb event stream.
 * @returns {number} Duration from first to last event, in ms.
 */
export function recordingDurationMs(events) {
    if (!Array.isArray(events) || events.length === 0)
        return 0;
    return Math.max(0, Number(events[events.length - 1].timestamp) - Number(events[0].timestamp));
}

/**
 * Clip an event stream to the `[t0Ms, t1Ms]` window (offsets from the first event) into a self-contained replayable slice.
 *
 * Boundary: the result always begins at the latest Meta+FullSnapshot checkpoint at or before `t0Ms` (or the first
 * checkpoint when none precede it) so replay has a valid base, then keeps every event up to `t1Ms`. Incremental events
 * between the base snapshot and `t0Ms` are retained because they are needed to reach the `t0` DOM state. Offsets outside
 * the recording are clamped. Returns a new array; the input is not mutated.
 *
 * @param {Array<Record<string, unknown>>} events rrweb event stream (rolling buffer).
 * @param {number} t0Ms Clip start offset in ms from the first event.
 * @param {number} t1Ms Clip end offset in ms from the first event.
 * @returns {Array<Record<string, unknown>>} Clipped, replayable event slice.
 */
export function clipEvents(events, t0Ms, t1Ms) {
    if (!Array.isArray(events) || events.length === 0)
        return [];
    const startTs = Number(events[0].timestamp);
    const total = recordingDurationMs(events);
    const t0 = Math.max(0, Math.min(Number(t0Ms) || 0, total));
    const t1 = Math.max(t0, Math.min(Number(t1Ms) || total, total));
    const t0Abs = startTs + t0;
    const t1Abs = startTs + t1;
    let baseIdx = -1;
    for (let i = 0; i < events.length; i += 1) {
        if (events[i].type === RRWEB_FULL_SNAPSHOT && Number(events[i].timestamp) <= t0Abs) {
            baseIdx = checkpointIndex(events, i);
        }
    }
    if (baseIdx === -1) {
        for (let i = 0; i < events.length; i += 1) {
            if (events[i].type === RRWEB_FULL_SNAPSHOT) {
                baseIdx = checkpointIndex(events, i);
                break;
            }
        }
    }
    if (baseIdx === -1)
        baseIdx = 0;
    const out = [];
    for (let i = baseIdx; i < events.length; i += 1) {
        if (Number(events[i].timestamp) <= t1Abs)
            out.push(events[i]);
    }
    return out;
}

/**
 * Normalize a list of keep-segments: clamp to `[0, duration]`, drop sub-1ms slivers, sort, and merge overlapping or
 * touching ranges into a clean ascending list.
 * Boundary: an empty/invalid input collapses to a single full-duration segment so a recording is never left with zero
 * playable content. Returns a new array; inputs are not mutated.
 * @param {Array<{t0:number,t1:number}>} segments Raw keep-segments (offsets in ms).
 * @param {number} duration Total recording duration in ms.
 * @returns {Array<{t0:number,t1:number}>} Cleaned, merged, ascending segments.
 */
export function normalizeSegments(segments, duration) {
    const cleaned = (Array.isArray(segments) ? segments : [])
        .map((s) => ({ t0: Math.max(0, Math.min(Number(s.t0), Number(s.t1))), t1: Math.min(duration, Math.max(Number(s.t0), Number(s.t1))) }))
        .filter((s) => Number.isFinite(s.t0) && Number.isFinite(s.t1) && s.t1 - s.t0 >= 1)
        .sort((a, b) => a.t0 - b.t0);
    const merged = [];
    for (const seg of cleaned) {
        const last = merged[merged.length - 1];
        if (last && seg.t0 <= last.t1 + 1)
            last.t1 = Math.max(last.t1, seg.t1);
        else
            merged.push({ ...seg });
    }
    return merged.length ? merged : [{ t0: 0, t1: Math.max(1, duration) }];
}

/**
 * Remove a time range from the kept segments (a "cut"), splitting/trimming any overlapping segment.
 * Boundary: the cut range is intersected against each segment; non-overlapping segments pass through, overlapping ones
 * keep only their left and/or right remainder. The result is re-normalized (and never empty — collapses to full when a
 * cut would remove everything). Returns a new array; inputs are not mutated.
 * @param {Array<{t0:number,t1:number}>} segments Current keep-segments.
 * @param {{t0:number,t1:number}} cut Range to remove (offsets in ms).
 * @param {number} duration Total recording duration in ms.
 * @returns {Array<{t0:number,t1:number}>} Segments with the cut range removed.
 */
export function cutSegments(segments, cut, duration) {
    const lo = Math.min(Number(cut.t0), Number(cut.t1));
    const hi = Math.max(Number(cut.t0), Number(cut.t1));
    const out = [];
    for (const seg of Array.isArray(segments) ? segments : []) {
        const c0 = Math.max(seg.t0, lo);
        const c1 = Math.min(seg.t1, hi);
        if (c1 <= c0) {
            out.push(seg);
            continue;
        }
        if (c0 > seg.t0)
            out.push({ t0: seg.t0, t1: c0 });
        if (c1 < seg.t1)
            out.push({ t0: c1, t1: seg.t1 });
    }
    return normalizeSegments(out, duration);
}

/**
 * Sum the kept duration across segments.
 * @param {Array<{t0:number,t1:number}>} segments Keep-segments.
 * @returns {number} Total kept duration in ms.
 */
export function segmentsDuration(segments) {
    return (Array.isArray(segments) ? segments : []).reduce((sum, s) => sum + Math.max(0, s.t1 - s.t0), 0);
}

/**
 * Build a combined event stream from multiple keep-segments, re-timestamped so the kept ranges play back-to-back and
 * each cut gap is compressed to a single held frame.
 *
 * Boundary: each output segment starts from the latest full-snapshot checkpoint at or before its `t0` (so replay has a
 * valid base) and includes its incremental events; segments are concatenated and re-timestamped onto a continuous
 * timeline, inserting a short `GAP_FREEZE_MS` hold between them to represent the removed time as one frame. Because a
 * later segment's base snapshot fully re-establishes the DOM, dropping the in-between events does not desync replay.
 * Returns a new array; the input is not mutated.
 *
 * @param {Array<Record<string, unknown>>} events Source rrweb event stream.
 * @param {Array<{t0:number,t1:number}>} segments Normalized keep-segments (offsets in ms from the first event).
 * @returns {Array<Record<string, unknown>>} Combined, re-timestamped event stream.
 */
export function combineSegments(events, segments) {
    if (!Array.isArray(events) || events.length === 0)
        return [];
    const list = Array.isArray(segments) && segments.length ? segments : [{ t0: 0, t1: recordingDurationMs(events) }];
    const GAP_FREEZE_MS = 200;
    const out = [];
    let cursor = 0; // next output timestamp baseline (relative)
    for (const seg of list) {
        const slice = clipEvents(events, seg.t0, seg.t1);
        if (!slice.length)
            continue;
        const sliceStart = Number(slice[0].timestamp);
        const offset = cursor - sliceStart;
        for (const event of slice)
            out.push({ ...event, timestamp: Number(event.timestamp) + offset });
        cursor = Number(out[out.length - 1].timestamp) + GAP_FREEZE_MS;
    }
    return out;
}

/**
 * Active rrweb recording with a time-bounded rolling buffer.
 *
 * Boundary: one session records the whole page (rrweb captures from `document`), not a single element. Events are kept
 * to roughly the last `maxDurationMs` by trimming to the newest checkpoint that still covers the window, so memory and
 * payload size stay bounded even for a long-forgotten recording. `start()` lazy-loads `@rrweb/record`; if rrweb is not
 * installed it rejects. `stop()` returns a snapshot copy of the buffered events.
 */
export class RecordingSession {
    events = [];
    stopFn = null;
    startedAt = 0;
    maxDurationMs = DEFAULT_MAX_DURATION_MS;

    /**
     * @param {Record<string, unknown>} config Browser config injected by the plugin (carries token/apiOrigin + recording options).
     */
    constructor(config) {
        this.config = config;
        const recording = config?.recording ?? {};
        const max = Number(recording.maxDurationMs);
        this.maxDurationMs = Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX_DURATION_MS;
        this.mask = recording.mask ?? {};
    }

    /**
     * Begin recording the page.
     * Boundary: rejects when `@rrweb/record` is not installed in the host project. Calling `start()` twice without `stop()`
     * is a no-op after the first. Canvas/WebGL capture is intentionally off in v1 to keep the replay iframe sandboxed.
     * @returns {Promise<void>} Resolves once recording has begun.
     */
    async start() {
        if (this.stopFn)
            return;
        const mod = await loadRrwebRecord(this.config);
        this.events = [];
        this.startedAt = Date.now();
        this.stopFn = mod.record({
            emit: (event) => this.push(event),
            inlineImages: true,
            inlineStylesheet: true,
            collectFonts: true,
            recordCanvas: false,
            checkoutEveryNms: Math.min(CHECKOUT_EVERY_MS, this.maxDurationMs),
            maskAllInputs: this.mask?.allInputs === true,
            blockClass: typeof this.mask?.blockClass === 'string' && this.mask.blockClass ? this.mask.blockClass : 'rr-block',
            // Always exclude the inspector's own shadow-host UI (dialog/backdrop/orb) from the recording, plus any
            // host-configured private selector. Blocked nodes are captured as empty placeholders, never their content.
            blockSelector: `[${PLUGIN_NODE_ATTR}]${typeof this.mask?.blockSelector === 'string' && this.mask.blockSelector ? `,${this.mask.blockSelector}` : ''}`,
        }) ?? null;
    }

    /**
     * Append one rrweb event and trim the rolling buffer.
     * Boundary: trimming only drops a leading prefix bounded by a full-snapshot checkpoint, so the buffer always stays
     * replayable. Internal; called by the rrweb `emit` callback.
     * @param {Record<string, unknown>} event rrweb event.
     * @returns {void}
     */
    push(event) {
        this.events.push(event);
        this.trim();
    }

    /**
     * Drop buffer events older than the rolling window, preserving a valid base checkpoint.
     * Boundary: keeps the newest checkpoint whose timestamp is at or before the window start so the retained slice still
     * replays from a full snapshot. No-op while the buffer is shorter than `maxDurationMs`.
     * @returns {void}
     */
    trim() {
        if (this.events.length < 2)
            return;
        const lastTs = Number(this.events[this.events.length - 1].timestamp);
        const windowStart = lastTs - this.maxDurationMs;
        let base = -1;
        for (let i = 0; i < this.events.length; i += 1) {
            if (this.events[i].type === RRWEB_FULL_SNAPSHOT && Number(this.events[i].timestamp) <= windowStart) {
                base = checkpointIndex(this.events, i);
            }
        }
        if (base > 0)
            this.events = this.events.slice(base);
    }

    /** Whether a recording is currently in progress. @returns {boolean} */
    isRecording() {
        return this.stopFn != null;
    }

    /** Elapsed wall-clock time since recording started, in ms. @returns {number} */
    elapsedMs() {
        return this.startedAt ? Date.now() - this.startedAt : 0;
    }

    /**
     * Stop recording and return a copy of the buffered events.
     * Boundary: safe to call when not recording (returns the current/empty buffer). The returned array is a shallow copy
     * so later sessions cannot mutate a captured recording.
     * @returns {Array<Record<string, unknown>>} Buffered rrweb events.
     */
    stop() {
        if (this.stopFn) {
            try {
                this.stopFn();
            }
            catch {
                // rrweb stop is best-effort; a failed stop must not lose the buffered events.
            }
            this.stopFn = null;
        }
        return this.events.slice();
    }
}
