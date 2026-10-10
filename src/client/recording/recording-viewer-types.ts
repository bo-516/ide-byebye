import type { RecordingStillImage } from './recording-still.js';

/**
 * Types and pure helpers for the recording viewer/editor.
 *
 * Boundary: viewport probing and stage sizing are pure DOM math; the viewer's replayer lifecycle and controls stay in
 * `recording-viewer.ts`.
 */

/** Largest on-screen size for the embedded player; the recorded scope is scaled to fit inside this box. */
export const VIEWER_MAX_W = 760;
export const VIEWER_MAX_H = 430;
/** rrweb `EventType.Meta` numeric tag; carries the recorded viewport size. */
export const RRWEB_META_EVENT = 4;
/** Pointer travel (px) above which a track press is a range-drag rather than a seek click. */
export const DRAG_THRESHOLD_PX = 4;

/** One kept interval, milliseconds from the start of the recording. */
export interface TimeSegment {
    t0: number;
    t1: number;
}

/** Recording fields the editor mutates in place. Extra dialog fields (id, scope, …) are left untouched. */
export interface ViewerRecording {
    events: Array<Record<string, unknown>>;
    durationMs: number;
    segments: TimeSegment[];
    stillAt?: number;
    still: RecordingStillImage | null;
}

/**
 * Viewer mount options.
 * `config` is `object` so the dialog's index-signature-free page config stays assignable. `parent` is a `ParentNode`
 * because `Node` has no `append` and the shell is mounted with `parent.append`.
 */
export interface ViewerOptions {
    parent: ParentNode;
    config: object;
    recording: ViewerRecording;
    blockClass?: string;
    scopeSelector?: string;
    onUpdate: (recording: ViewerRecording) => void;
    showError: (text: string) => void;
}

/** Subset of `@rrweb/replay`'s Replayer this viewer calls; the loader's wider instance type is narrowed to it. */
export interface ReplayHandle {
    iframe?: HTMLIFrameElement | null;
    pause: (timeOffset?: number) => void;
    play: (timeOffset?: number) => void;
    getCurrentTime?: () => number;
}

/** Width and height carried on an rrweb Meta event. */
interface MetaViewportData {
    width?: unknown;
    height?: unknown;
}

/**
 * Read the recorded viewport size from an rrweb event stream.
 * @param {Array<Record<string, unknown>>} events rrweb event stream.
 * @returns {{ width: number, height: number } | null} Recorded viewport size, or null.
 */
export function recordedViewport(events: Array<Record<string, unknown>>): { width: number; height: number } | null {
    for (const event of events) {
        const raw = event && typeof event === 'object' ? event.data : null;
        // Meta `data` is an untyped rrweb payload; only width/height are read.
        const data = raw && typeof raw === 'object' ? raw as MetaViewportData : null;
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
export function formatMs(ms: number): string {
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
 * @param {ReplayHandle} replayer The rrweb Replayer. `iframe` may be missing until the engine builds it.
 * @param {{ width: number, height: number }} viewport Recorded viewport size.
 * @param {string | undefined} scopeSelector Selector locating the scope node in the replay document. Omitted shows the whole viewport.
 * @returns {void}
 */
export function focusStage(stage: HTMLElement, replayer: ReplayHandle, viewport: { width: number; height: number }, scopeSelector: string | undefined): void {
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
