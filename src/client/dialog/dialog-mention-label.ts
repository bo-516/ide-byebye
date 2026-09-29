/**
 * splitMentionLabel(label): split a prompt-facing reference label into the parts a mention chip renders separately.
 *
 * Purpose: the chip dims the directory, emphasizes the file name, and shows the line range as a compact `L99–104` tag,
 * while the prompt keeps the raw `@path #range` label untouched (serialization reads the chip's `data-label`, never
 * this output).
 * Boundary: pure string work, safe for any input. A leading `@` is dropped. Only a trailing ` #<n>` or ` #<n>-<m>`
 * counts as a range, so a `#` inside the path stays part of the path. Labels without a usable separator (the `Code 1`
 * fallback, a bare `App.jsx`, a path ending in a separator) come back whole as `file`; an empty or missing label yields
 * all-empty parts, which renders an empty chip rather than throwing.
 *
 * @param {unknown} label Reference label resolved by the server, e.g. `@react/src/App.jsx #99-104`.
 * @returns {{ dir: string, file: string, lines: string }} `dir` keeps its trailing separator; `lines` is '' without a
 * range and collapses an equal start/end (`#7-7`) to a single line.
 */
export function splitMentionLabel(label: unknown): { dir: string; file: string; lines: string } {
    const text = String(label ?? '').trim().replace(/^@/, '');
    const match = /^(.*\S)\s+#(\d+)(?:-(\d+))?$/.exec(text);
    const path = match ? match[1] : text;
    let lines = '';
    if (match)
        lines = match[3] && match[3] !== match[2] ? `L${match[2]}–${match[3]}` : `L${match[2]}`;
    const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    if (cut <= 0 || cut === path.length - 1)
        return { dir: '', file: path, lines };
    return { dir: path.slice(0, cut + 1), file: path.slice(cut + 1), lines };
}
