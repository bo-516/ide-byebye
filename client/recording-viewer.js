import { el } from './dialog-utils.js';
import { loadRrwebReplay } from './vendor-loader.js';
import { captureRecordingStill } from './recording-still.js';
import { recordingDurationMs, normalizeSegments, segmentsDuration, cutSegments } from './recorder.js';

/** Largest on-screen size for the embedded player; the recorded scope is scaled to fit inside this box. */
const VIEWER_MAX_W = 760;
const VIEWER_MAX_H = 430;
/** rrweb `EventType.Meta` numeric tag; carries the recorded viewport size. */
const RRWEB_META_EVENT = 4;
/** Pointer travel (px) above which a track press is a range-drag rather than a seek click. */
const DRAG_THRESHOLD_PX = 4;

/**
 * Read the recorded viewport size from an rrweb event stream.
 * @param {Array<Record<string, unknown>>} events rrweb event stream.
 * @returns {{ width: number, height: number } | null} Recorded viewport size, or null.
 */
function recordedViewport(events) {
    for (const event of events) {
        const data = event && typeof event === 'object' ? event.data : null;
        if (event?.type === RRWEB_META_EVENT && data && Number(data.width) > 0) {
            return { width: Math.ceil(Number(data.width)), height: Math.ceil(Number(data.height)) };
        }
    }
    return null;
}

/**
 * Format a millisecond offset as `m:ss.t` for compact timeline labels.
 * @param {number} ms Offset in milliseconds.
 * @returns {string} Human-readable timecode.
 */
function formatMs(ms) {
    const total = Math.max(0, Math.round(ms));
    const seconds = Math.floor(total / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.${Math.floor((total % 1000) / 100)}`;
}

/**
 * Size the replay iframe to the recorded viewport and crop/scale the stage to the recorded scope node.
 * Boundary: the bare `@rrweb/replay` engine leaves its iframe at 0×0 until playback advances, so the viewer must set the
 * dimensions explicitly. The scope node is located by selector and the wrapper is translated+scaled so only that subtree
 * fills the stage. Falls back to the whole recorded viewport when the node is not found. Idempotent.
 * @param {HTMLElement} stage Container holding the replayer wrapper.
 * @param {{ iframe: HTMLIFrameElement }} replayer The rrweb Replayer.
 * @param {{ width: number, height: number }} viewport Recorded viewport size.
 * @param {string | undefined} scopeSelector Selector locating the scope node in the replay document.
 * @returns {void}
 */
function focusStage(stage, replayer, viewport, scopeSelector) {
    if (!viewport.width || !viewport.height)
        return;
    const iframe = replayer.iframe;
    if (iframe instanceof HTMLElement) {
        iframe.setAttribute('width', String(viewport.width));
        iframe.setAttribute('height', String(viewport.height));
        iframe.style.width = `${viewport.width}px`;
        iframe.style.height = `${viewport.height}px`;
        iframe.style.border = '0';
        iframe.style.background = '#ffffff';
    }
    let box = { left: 0, top: 0, width: viewport.width, height: viewport.height };
    const doc = iframe && iframe.contentDocument;
    if (doc && scopeSelector) {
        try {
            const node = doc.querySelector(scopeSelector);
            if (node) {
                const rect = node.getBoundingClientRect();
                if (rect.width >= 1 && rect.height >= 1)
                    box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
            }
        }
        catch {
            // keep full viewport
        }
    }
    const scale = Math.min(VIEWER_MAX_W / box.width, VIEWER_MAX_H / box.height, 1);
    const wrapper = stage.querySelector('.replayer-wrapper');
    if (wrapper instanceof HTMLElement) {
        wrapper.style.width = `${viewport.width}px`;
        wrapper.style.height = `${viewport.height}px`;
        wrapper.style.transformOrigin = 'top left';
        wrapper.style.transform = `scale(${scale}) translate(${-box.left}px, ${-box.top}px)`;
    }
    stage.style.width = `${Math.round(box.width * scale)}px`;
    stage.style.height = `${Math.round(box.height * scale)}px`;
}

/**
 * Open the recording editor: a light-themed lightbox that plays one recording, lets the user keep **multiple time
 * segments** (cut gaps are compressed to a single held frame on playback) and pick **any frame as the still**.
 *
 * Boundary: requires `@rrweb/replay` (lazy-loaded). Mutates `recording.segments`, `recording.stillAt`, and
 * `recording.still` in place and calls `onUpdate(recording)` so the dialog refreshes thumbnail + payload. Tears down the
 * replayer on close. Playback honors `segments`: it plays each kept range, then jumps to the next (a jump-cut that reads
 * as the compressed frame). The still is captured at the current scrubbed frame, cropped to the recorded scope.
 *
 * @param {{
 *   parent: Node,
 *   config: Record<string, unknown>,
 *   recording: { events: Array<Record<string, unknown>>, durationMs: number, segments: Array<{t0:number,t1:number}>, stillAt?: number, still: Record<string, unknown> | null },
 *   blockClass?: string,
 *   scopeSelector?: string,
 *   onUpdate: (recording: Record<string, unknown>) => void,
 *   showError: (text: string) => void,
 * }} opts Viewer options.
 * @returns {Promise<void>} Resolves after the viewer has mounted.
 */
export async function openRecordingViewer(opts) {
    const { parent, config, recording, onUpdate, showError } = opts;
    const duration = recording.durationMs || recordingDurationMs(recording.events) || 1;
    recording.segments = normalizeSegments(recording.segments, duration);
    if (recording.stillAt == null)
        recording.stillAt = recording.segments[recording.segments.length - 1].t1;

    // --- shell (light theme) ---
    const lightbox = el('div', 'cii-recording-lightbox');
    const frame = el('div', 'cii-recording-frame');
    const header = el('div', 'cii-rv-header');
    const close = el('button', 'cii-rv-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '完成');
    header.append(el('span', 'cii-rv-title', '录制编辑'), close);
    const stage = el('div', 'cii-recording-stage');
    frame.append(header, stage);
    lightbox.append(frame);
    parent.append(lightbox);

    let replayer = null;
    let rafId = 0;
    let playing = false;
    let playhead = 0;
    let pendingSel = null;
    const teardown = () => {
        playing = false;
        if (rafId)
            window.cancelAnimationFrame(rafId);
        try {
            replayer?.pause();
        }
        catch {
            // best-effort
        }
        lightbox.remove();
    };
    close.addEventListener('click', teardown);
    lightbox.addEventListener('click', (event) => {
        if (event.target === lightbox)
            teardown();
    });

    let Replayer;
    try {
        ({ Replayer } = await loadRrwebReplay(config));
    }
    catch (err) {
        teardown();
        showError(err instanceof Error ? err.message : String(err));
        return;
    }
    replayer = new Replayer(recording.events, {
        root: stage,
        speed: 1,
        mouseTail: false,
        showWarning: false,
        showDebug: false,
        skipInactive: false,
        blockClass: opts.blockClass || 'rr-block',
    });
    replayer.pause(0);
    const viewport = recordedViewport(recording.events) || { width: 1280, height: 800 };
    focusStage(stage, replayer, viewport, opts.scopeSelector);
    window.setTimeout(() => focusStage(stage, replayer, viewport, opts.scopeSelector), 80);

    // --- transport: play/pause + scrubber + time ---
    const transport = el('div', 'cii-rv-row');
    const playBtn = el('button', 'cii-rv-btn', '▶');
    playBtn.type = 'button';
    const seek = el('input', 'cii-rv-seek');
    seek.type = 'range';
    seek.min = '0';
    seek.max = String(Math.round(duration));
    seek.value = '0';
    const timeLabel = el('span', 'cii-rv-time', `0:00.0 / ${formatMs(duration)}`);
    transport.append(playBtn, seek, timeLabel);

    // --- timeline track: segments + selection + playhead ---
    const timeline = el('div', 'cii-rv-track');
    const playheadEl = el('div', 'cii-rv-playhead');
    const selEl = el('div', 'cii-rv-sel');
    selEl.hidden = true;
    timeline.append(selEl, playheadEl);

    // --- segment controls (cut model: default keeps everything, drag a range and cut it out) ---
    const hint = el('div', 'cii-rv-hint', '默认保留全部。在下方时间轴上拖选要删掉的片段，再点「剪掉选区」——被删的时间会压成一帧跳过；也可点片段上的 × 删除整段。');
    const segBar = el('div', 'cii-rv-row cii-rv-segbar');
    const cutBtn = el('button', 'cii-rv-chip-btn', '剪掉选区');
    cutBtn.type = 'button';
    cutBtn.disabled = true;
    const resetBtn = el('button', 'cii-rv-chip-btn', '还原全部');
    resetBtn.type = 'button';
    const cutInfo = el('span', 'cii-rv-time', '');
    segBar.append(cutBtn, resetBtn, cutInfo);

    // --- actions ---
    const actions = el('div', 'cii-rv-row cii-rv-actions');
    const stillBtn = el('button', 'cii-btn cii-btn-primary', '用此刻作为静帧');
    stillBtn.type = 'button';
    const doneBtn = el('button', 'cii-btn cii-btn-secondary cii-rv-done', '完成');
    doneBtn.type = 'button';
    doneBtn.addEventListener('click', teardown);
    actions.append(stillBtn, doneBtn);

    frame.append(transport, hint, timeline, segBar, actions);

    const pct = (t) => `${Math.max(0, Math.min(100, (t / duration) * 100))}%`;
    const setPlayhead = (t) => {
        playhead = Math.max(0, Math.min(duration, t));
        seek.value = String(Math.round(playhead));
        playheadEl.style.left = pct(playhead);
        timeLabel.textContent = `${formatMs(playhead)} / ${formatMs(duration)}`;
    };
    const renderSegments = () => {
        timeline.querySelectorAll('.cii-rv-seg').forEach((node) => node.remove());
        for (const seg of recording.segments) {
            const block = el('div', 'cii-rv-seg');
            block.style.left = pct(seg.t0);
            block.style.width = pct(seg.t1 - seg.t0);
            const remove = el('button', 'cii-rv-seg-x', '×');
            remove.type = 'button';
            remove.title = '删除该片段';
            remove.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
            remove.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                recording.segments = normalizeSegments(recording.segments.filter((s) => s !== seg), duration);
                if (!recording.segments.length)
                    recording.segments = [{ t0: 0, t1: duration }];
                renderSegments();
                updateCutInfo();
                onUpdate(recording);
            });
            block.append(remove);
            timeline.append(block);
        }
    };
    const updateCutInfo = () => {
        const kept = segmentsDuration(recording.segments);
        cutInfo.textContent = `保留 ${formatMs(kept)} / 共 ${formatMs(duration)}（${recording.segments.length} 段）`;
    };

    // --- transport behaviour (honors segments: jump-cut over gaps) ---
    const segmentContaining = (t) => recording.segments.find((s) => t >= s.t0 - 1 && t < s.t1);
    const segmentAfter = (t) => recording.segments.find((s) => s.t0 > t - 1);
    const stopPlay = (atT) => {
        playing = false;
        playBtn.textContent = '▶';
        if (rafId)
            window.cancelAnimationFrame(rafId);
        const target = atT == null ? playhead : atT;
        try {
            replayer.pause(target);
        }
        catch {
            // ignore
        }
        setPlayhead(target);
    };
    const startPlay = () => {
        let seg = segmentContaining(playhead) || segmentAfter(playhead);
        if (!seg) {
            seg = recording.segments[0];
            if (!seg)
                return;
        }
        let from = playhead < seg.t0 ? seg.t0 : playhead;
        playing = true;
        playBtn.textContent = '⏸';
        replayer.play(from);
        const tick = () => {
            if (!playing)
                return;
            const cur = replayer.getCurrentTime ? replayer.getCurrentTime() : from;
            setPlayhead(cur);
            if (cur >= seg.t1 - 16) {
                const next = segmentAfter(seg.t1);
                if (next) {
                    seg = next;
                    replayer.play(seg.t0); // jump-cut = the compressed frame
                }
                else {
                    stopPlay(seg.t1);
                    return;
                }
            }
            rafId = window.requestAnimationFrame(tick);
        };
        rafId = window.requestAnimationFrame(tick);
    };
    playBtn.addEventListener('click', () => {
        if (playing)
            stopPlay();
        else
            startPlay();
    });
    seek.addEventListener('input', () => {
        stopPlay(Number(seek.value));
    });

    // --- timeline drag-to-select range, click-to-seek ---
    const timeAt = (clientX) => {
        const rect = timeline.getBoundingClientRect();
        return Math.max(0, Math.min(duration, ((clientX - rect.left) / Math.max(1, rect.width)) * duration));
    };
    const renderSelection = (a, b) => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        selEl.hidden = hi - lo < 1;
        selEl.style.left = pct(lo);
        selEl.style.width = pct(hi - lo);
    };
    timeline.addEventListener('mousedown', (event) => {
        if (event.target instanceof HTMLElement && event.target.closest('.cii-rv-seg-x'))
            return;
        event.preventDefault();
        const a = timeAt(event.clientX);
        let b = a;
        let moved = 0;
        const move = (me) => {
            moved += Math.abs(me.movementX);
            b = timeAt(me.clientX);
            renderSelection(a, b);
        };
        const up = () => {
            document.removeEventListener('mousemove', move, true);
            document.removeEventListener('mouseup', up, true);
            if (moved >= DRAG_THRESHOLD_PX) {
                pendingSel = { t0: Math.min(a, b), t1: Math.max(a, b) };
                cutBtn.disabled = false;
            }
            else {
                pendingSel = null;
                selEl.hidden = true;
                cutBtn.disabled = true;
                stopPlay(a);
            }
        };
        document.addEventListener('mousemove', move, true);
        document.addEventListener('mouseup', up, true);
    });
    cutBtn.addEventListener('click', () => {
        if (!pendingSel)
            return;
        recording.segments = cutSegments(recording.segments, pendingSel, duration);
        pendingSel = null;
        selEl.hidden = true;
        cutBtn.disabled = true;
        renderSegments();
        updateCutInfo();
        onUpdate(recording);
    });
    resetBtn.addEventListener('click', () => {
        recording.segments = [{ t0: 0, t1: duration }];
        pendingSel = null;
        selEl.hidden = true;
        cutBtn.disabled = true;
        renderSegments();
        updateCutInfo();
        onUpdate(recording);
    });

    // --- capture the current frame as the still ---
    stillBtn.addEventListener('click', async () => {
        stillBtn.disabled = true;
        const original = stillBtn.textContent;
        stillBtn.textContent = '生成中…';
        try {
            const still = await captureRecordingStill(config, recording.events, playhead, {
                blockClass: opts.blockClass,
                scopeSelector: opts.scopeSelector,
            });
            recording.still = still;
            recording.stillAt = playhead;
            onUpdate(recording);
            stillBtn.textContent = '已更新静帧 ✓';
        }
        catch (err) {
            showError(err instanceof Error ? err.message : String(err));
            stillBtn.textContent = original;
        }
        finally {
            stillBtn.disabled = false;
            window.setTimeout(() => { stillBtn.textContent = '用此刻作为静帧'; }, 1500);
        }
    });

    renderSegments();
    updateCutInfo();
    setPlayhead(0);
}
