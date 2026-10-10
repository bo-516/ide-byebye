import type { RecordingStillImage } from './recording-still.js';
import type { RecordingScope } from './recording-scope.js';

/**
 * Shared types and small helpers for the dialog recording controller layers.
 */

/**
 * Format a millisecond duration as a compact `12.3s` badge label.
 * @param {number} ms Duration in milliseconds.
 * @returns {string} Short label.
 */
export function durationLabel(ms: number): string {
    return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

/** One captured clip kept for the current dialog open. `still` stays null until rasterization finishes. */
export interface DialogRecording {
    id: string;
    events: Array<Record<string, unknown>>;
    durationMs: number;
    segments: Array<{ t0: number; t1: number }>;
    stillAt: number;
    still: RecordingStillImage | null;
    capturing: boolean;
    scope: RecordingScope;
    scopeSelector: string | undefined;
}

/**
 * Dialog callbacks this controller uses.
 *
 * Boundary: `config()` is the injected page config. It is `object` because the dialog types only `enabledAgents` and
 * that interface has no string index signature; `recording` is read with a cast. `parent()` is a `ParentNode` (the
 * shadow root) because the floating control is mounted with `append`, which `Node` does not have.
 */
export interface DialogRecordingHost {
    config: () => object;
    backdrop: () => Element | null;
    parent: () => ParentNode;
    selectedElement: () => Element | null;
    setDialogHidden: (hidden: boolean) => void;
    reposition: () => void;
    showError: (text: string) => void;
    onChange?: () => void;
}
