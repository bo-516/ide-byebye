import { fileURLToPath } from 'node:url';
import path from 'node:path';
/**
 * Parse the value of a `data-insp-path` attribute produced by
 * `code-inspector-plugin`. The exact format varies between versions, so we
 * accept several shapes:
 *
 *   /absolute/path/to/src/App.tsx:12:8
 *   /absolute/path/to/src/App.tsx:12:8:button        (trailing tag name)
 *   /absolute/path/to/src/App.tsx?line=12&column=8
 *   file:///absolute/path/to/src/App.tsx:12:8
 *   C:\\path\\to\\App.tsx:12:8                         (Windows)
 *
 * Throws when a line/column pair cannot be recovered.
 */
export function parseInspPath(raw) {
    if (!raw || typeof raw !== 'string') {
        throw new Error('Empty data-insp-path attribute');
    }
    let value = raw.trim();
    // Normalize a file:// URL. Keep any trailing :line:column or ?query that the
    // injector appended after the URL.
    if (value.startsWith('file://')) {
        const suffixMatch = value.match(/(:\d+:\d+(?::[^:?]*)?|\?[^#]*)$/);
        const suffix = suffixMatch ? suffixMatch[0] : '';
        const urlPart = suffix ? value.slice(0, value.length - suffix.length) : value;
        try {
            value = fileURLToPath(urlPart) + suffix;
        }
        catch {
            value = urlPart.replace(/^file:\/\//, '') + suffix;
        }
    }
    // Query-string form: <file>?line=12&column=8
    const queryIndex = value.indexOf('?');
    if (queryIndex !== -1) {
        const filePart = decodeURIComponent(value.slice(0, queryIndex));
        const params = new URLSearchParams(value.slice(queryIndex + 1));
        const line = Number(params.get('line') ?? params.get('l'));
        const columnRaw = params.get('column') ?? params.get('col') ?? params.get('c');
        const column = columnRaw == null ? 1 : Number(columnRaw);
        if (!filePart || !Number.isFinite(line)) {
            throw new Error(`data-insp-path is missing a valid line number: ${raw}`);
        }
        return finalize(filePart, line, column);
    }
    // Colon form with optional trailing segment(s): <file>:line:column[:name]
    const colon = value.match(/^(.*?):(\d+):(\d+)(?::.*)?$/);
    if (colon) {
        return finalize(decodeURIComponent(colon[1]), Number(colon[2]), Number(colon[3]));
    }
    // Line-only form: <file>:line
    const lineOnly = value.match(/^(.*?):(\d+)$/);
    if (lineOnly) {
        return finalize(decodeURIComponent(lineOnly[1]), Number(lineOnly[2]), 1);
    }
    throw new Error(`Cannot parse line/column from data-insp-path: ${raw}`);
}
function finalize(file, line, column) {
    if (!file) {
        throw new Error('data-insp-path resolved to an empty file path');
    }
    if (!Number.isFinite(line) || line < 1) {
        throw new Error(`data-insp-path has an invalid line: ${line}`);
    }
    const normalizedColumn = Number.isFinite(column) && column >= 1 ? column : 1;
    return {
        file: path.normalize(file),
        line,
        column: normalizedColumn,
    };
}
