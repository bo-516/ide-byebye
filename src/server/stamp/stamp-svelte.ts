/**
 * Stamp Svelte 3, 4, and 5 markup.
 *
 * Purpose: the project's `svelte/compiler` `parse` (legacy AST, including Svelte 5 snippets) gives
 * each HTML element a `start` at `<`. Components (`InlineComponent`) are not stamped. `<script>` and
 * `<style>` are blanked to spaces before parse so TypeScript and preprocessors do not fail the file.
 *
 * Boundary: a missing compiler warns once and returns null. A parse error returns null and the file
 * stays unchanged — that is how Svelte 5 files used to be dropped entirely by code-inspector's
 * bundled Svelte 4 parser. Column matches `start - lastIndexOf('\\n')`, which is 1-based.
 */

import { requireFromProject } from '../ast/project-module.js';
import { PATH_ATTR, formatInspValue, isEscapedTag, type Insertion } from './stamp-edits.js';
import { buildLineStartOffsets, lineColumnFromOffset } from '../ast/line-offsets.js';

const SVELTE_WARN = '[code-intent-inspector] Svelte stamping needs the project\'s svelte package (svelte/compiler).';

const SCRIPT_RE = /<script(?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^>\s]*))?)?>[\s\S]*?<\/script>/gi;
const STYLE_RE = /<style(?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^>\s]*))?)?>[\s\S]*?<\/style>/gi;

export interface StampSvelteInput {
    code: string;
    file: string;
    escapeTags?: Array<string | RegExp>;
    warnOnce?: (key: string, message: string) => void;
}

/**
 * Insertions for one `.svelte` file, or null when Svelte cannot parse it.
 *
 * @param {StampSvelteInput} input Component source and absolute path.
 * @returns {Insertion[] | null}
 */
export function stampSvelte(input: StampSvelteInput): Insertion[] | null {
    const parse = loadSvelteParse(input.file);
    if (!parse) {
        input.warnOnce?.('svelte-compiler', SVELTE_WARN);
        return null;
    }
    const masked = input.code.replace(SCRIPT_RE, (match) => ' '.repeat(match.length)).replace(STYLE_RE, (match) => ' '.repeat(match.length));
    let ast;
    try {
        ast = parse(masked);
    }
    catch {
        return null;
    }
    if (!ast?.html)
        return [];
    const escapeTags = input.escapeTags ?? [];
    const starts = buildLineStartOffsets(input.code);
    const insertions: Insertion[] = [];
    walk(ast.html, (node) => {
        if (node.type !== 'Element' || !node.name || isEscapedTag(node.name, escapeTags))
            return;
        if ((node.attributes ?? []).some((attr) => attr?.name === PATH_ATTR))
            return;
        const { line, column } = lineColumnFromOffset(starts, node.start);
        const value = formatInspValue(input.file, line, column + 1, node.name);
        const gap = node.attributes?.length ? ' ' : '';
        insertions.push({
            at: node.start + node.name.length + 1,
            text: ` ${PATH_ATTR}="${value}"${gap}`,
        });
    });
    return insertions;
}

/**
 * @param {string} file Component path. Resolution does not hop through another package.
 * @returns {Function | null} `svelte/compiler` parse, or null.
 */
function loadSvelteParse(file: string) {
    const mod = requireFromProject<any>(file, 'svelte/compiler');
    const parse = mod?.parse ?? mod?.default?.parse;
    return typeof parse === 'function' ? parse : null;
}

function walk(node, visit: (node) => void) {
    const seen = new Set<object>();
    const stack = [node];
    while (stack.length) {
        const current = stack.pop();
        if (!current || typeof current !== 'object' || seen.has(current))
            continue;
        seen.add(current);
        if (typeof current.type === 'string')
            visit(current);
        for (const key of Object.keys(current)) {
            if (key === 'parent')
                continue;
            const child = current[key];
            if (Array.isArray(child)) {
                for (let i = child.length - 1; i >= 0; i--)
                    stack.push(child[i]);
            }
            else if (child && typeof child === 'object')
                stack.push(child);
        }
    }
}
