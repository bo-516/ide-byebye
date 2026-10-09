/**
 * Browser-side `data-insp-path` parsing for labels and de-duplication.
 *
 * Purpose: overlay tags, chip fallbacks, and the component-tree walkers only need the file and line of a path, so
 * they share this best-effort parser instead of the strict server one (`src/server/insp-path.ts`).
 * Boundary: pure string work with no DOM access, so the inspect and dialog modules can import it without importing
 * each other. It never validates a path; the server re-parses and checks every value it reads.
 */

/**
 * Coerce an optional query value to a finite number.
 *
 * @param {unknown} v Raw value. Nullish yields `undefined`.
 * @returns {number | undefined} The number, or `undefined` when it is not finite.
 */
function toNum(v: unknown): number | undefined {
    if (v == null)
        return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

/**
 * Best-effort browser-side parse of a data-insp-path for label display.
 *
 * @param {unknown} raw Attribute or selection path. Nullish yields `{ file: '' }`. A non-string still hits `trim`.
 * @returns {{ file: string, line?: number, column?: number }} Parsed location. Never null.
 */
export function parseInspPathLite(raw: unknown): { file: string; line?: number; column?: number } {
    if (!raw)
        return { file: '' };
    // `sourceReferenceLabel` passes `unknown`. The assertion erases, so a truthy non-string still throws on `trim`.
    const value = (raw as string).trim().replace(/^file:\/\//, '');
    const q = value.indexOf('?');
    if (q !== -1) {
        const file = decodeURIComponent(value.slice(0, q));
        const params = new URLSearchParams(value.slice(q + 1));
        return { file, line: toNum(params.get('line')), column: toNum(params.get('column')) };
    }
    const m = value.match(/^(.*?):(\d+):(\d+)(?::.*)?$/);
    if (m)
        return { file: m[1], line: Number(m[2]), column: Number(m[3]) };
    const m2 = value.match(/^(.*?):(\d+)$/);
    if (m2)
        return { file: m2[1], line: Number(m2[2]) };
    return { file: value };
}

/**
 * Last path segment, for overlay labels.
 *
 * @param {string} file Path from {@link parseInspPathLite}. An empty string returns `''`.
 * @returns {string} Segment after the last slash or backslash.
 */
export function basename(file: string): string {
    const parts = file.split(/[\\/]/);
    return parts[parts.length - 1] || file;
}
