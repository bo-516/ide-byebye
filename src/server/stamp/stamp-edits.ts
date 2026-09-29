/**
 * Shared stamp text: path values, escape tags, ignore comments, and insertion application.
 *
 * Purpose: every language stamper emits `{ at, text }` edits; this module turns them into source
 * without shifting later offsets. Attribute values stay `<absolute POSIX path>:<line>:<column>:<tag>`.
 *
 * Boundary: pure string work. No parser, no filesystem. `column` is already 1-based. A bad `at`
 * (past the end, or overlapping an earlier replacement) splices at the clamped index and can
 * corrupt the file — callers must pass offsets from the same source string.
 */

import { INSP_PATH_ATTR } from '../../shared/constants.js';

/** Attribute name written onto elements and `createElement` props. */
export const PATH_ATTR = INSP_PATH_ATTR;

/** Injected binding when a component destructures props and has no path key yet. */
export const PATH_BINDING = '__ideByebyePath';

/** Injected props parameter when a component function has no parameters. */
export const PROPS_BINDING = '__ideByebyeProps';

/**
 * Tags code-inspector 1.6.2 never stamps. Comparison is case-insensitive; `A.B` also checks `B`.
 * User `escapeTags` are appended by {@link isEscapedTag}.
 */
export const BUILTIN_ESCAPE_TAGS = [
    'style', 'script', 'template', 'transition', 'keepalive', 'keep-alive', 'component', 'slot',
    'teleport', 'transition-group', 'transitiongroup', 'suspense', 'fragment',
];

/** One edit. `end` greater than `at` replaces that range; otherwise `text` is inserted at `at`. */
export interface Insertion {
    at: number;
    text: string;
    end?: number;
}

/**
 * Fields the JSX / Svelte stampers read off a parser node.
 *
 * Boundary: not an oxc or compiler-dom union. Optional fields cover every node kind the walk
 * sees; a missing field is `undefined` and the caller already skips that kind. `callee` stays
 * `unknown` so a walk callback typed with an unknown callee still assigns. Dynamic child keys
 * are not on this type — the walk asserts a string index at the loop, because an index signature
 * would reject the oxc `Program` passed in at the boundary.
 */
export interface StampNode {
    type?: string;
    /** Identifier or tag text. A JSX namespaced name's child identifier is asserted at the read. */
    name?: string;
    /** Literal text, or a child node on patterns and methods. */
    value?: string | StampNode | null;
    start: number;
    end: number;
    line?: number;
    column?: number;
    kind?: string;
    computed?: boolean;
    method?: boolean;
    selfClosing?: boolean;
    tag?: string;
    id?: StampNode | null;
    local?: StampNode | null;
    key?: StampNode | null;
    object?: StampNode | null;
    property?: StampNode | null;
    namespace?: StampNode | null;
    left?: StampNode | null;
    right?: StampNode | null;
    argument?: StampNode | null;
    expression?: StampNode | null;
    consequent?: StampNode | null;
    alternate?: StampNode | null;
    callee?: unknown;
    init?: StampNode | null;
    /** Function / class body node. A class body's statement list is read with a separate assertion. */
    body?: StampNode | null;
    block?: StampNode | null;
    openingElement?: StampNode | null;
    param?: StampNode | null;
    superClass?: StampNode | null;
    params?: StampNode[];
    specifiers?: StampNode[];
    properties?: StampNode[];
    elements?: StampNode[];
    declarations?: StampNode[];
    arguments?: StampNode[];
    children?: StampNode[];
    expressions?: StampNode[];
    attributes?: StampNode[];
    attrs?: StampNode[];
    nodes?: StampNode[];
    props?: StampNode[];
}

const IGNORE_DIRECTIVES = ['code-inspector-disable', 'code-inspector-ignore', 'ide-byebye-ignore'];

/**
 * Whether `tag` is an escape tag (built-in list plus `extra`).
 *
 * `A.B` matches when either the full name or its last segment matches. String tags are
 * case-insensitive. RegExp tags are tested against the original and the lowercased name;
 * `lastIndex` is reset so a `/g` pattern stays stateless.
 *
 * @param {string} tag Element or `createElement` type name. Empty string is not escaped.
 * @param {Array<string | RegExp>} [extra] User escape tags. Omit to use only the built-in 13.
 * @returns {boolean} `true` when the tag must not receive `data-insp-path`.
 */
export function isEscapedTag(tag: string, extra: Array<string | RegExp> = []): boolean {
    if (!tag)
        return false;
    const names = [tag, tag.split('.').pop() || tag];
    const list = BUILTIN_ESCAPE_TAGS.concat(extra as string[]);
    return names.some((name) => list.some((entry) => tagMatches(entry, name)));
}

/**
 * Whether one escape entry matches a single name segment.
 *
 * @param {string | RegExp} entry Configured tag or pattern.
 * @param {string} name Tag text to test.
 * @returns {boolean}
 */
function tagMatches(entry: string | RegExp, name: string): boolean {
    if (typeof entry === 'string')
        return entry.toLowerCase() === name.toLowerCase();
    if (entry instanceof RegExp) {
        entry.lastIndex = 0;
        if (entry.test(name))
            return true;
        entry.lastIndex = 0;
        return entry.test(name.toLowerCase());
    }
    return false;
}

/**
 * Whether the file starts with an ignore directive and must not be stamped.
 *
 * HTML-like files (`vue`, `svelte`) look at a leading `<!-- ... -->`. Scripts look at a leading
 * `//` line or `/* ... *\/` block. Whitespace before the comment is ignored. A directive anywhere
 * else does not count — same rule as code-inspector, plus `ide-byebye-ignore`.
 *
 * @param {string} code Full source.
 * @param {'html' | 'js'} kind `html` for Vue/Svelte, `js` for JSX/TS.
 * @returns {boolean} `true` when the whole file should be left unchanged.
 */
export function isStampIgnored(code: string, kind: 'html' | 'js'): boolean {
    if (!code)
        return false;
    const trimmed = code.trimStart();
    if (kind === 'html') {
        if (!trimmed.startsWith('<!--'))
            return false;
        const end = trimmed.indexOf('-->');
        if (end === -1)
            return false;
        const body = trimmed.slice(0, end + 3).toLowerCase();
        return IGNORE_DIRECTIVES.some((directive) => body.includes(directive));
    }
    const line = trimmed.match(/^\/\/\s*([^\n]+)/);
    if (line)
        return IGNORE_DIRECTIVES.some((directive) => line[1].toLowerCase().includes(directive));
    if (trimmed.startsWith('/*')) {
        const end = trimmed.indexOf('*/');
        if (end === -1)
            return false;
        const body = trimmed.slice(0, end + 2).toLowerCase();
        return IGNORE_DIRECTIVES.some((directive) => body.includes(directive));
    }
    return false;
}

/**
 * Build the attribute value. Backslashes become `/` so Windows paths stay POSIX.
 *
 * @param {string} file Absolute path as the bundler reported it. May contain `\`.
 * @param {number} line 1-based line of the element's `<` (or the call, for `createElement`).
 * @param {number} column 1-based column of that same character.
 * @param {string} tag Tag or component name, kept as written (`A.B`, `a:b`, `div`).
 * @returns {string} `path:line:column:tag`.
 */
export function formatInspValue(file: string, line: number, column: number, tag: string): string {
    return `${String(file).replace(/\\/g, '/')}:${line}:${column}:${tag}`;
}

/**
 * Apply insertions to `code`. Same-offset inserts keep the order they were pushed
 * (the earlier one ends up to the left). Ranges are replaced, not nested.
 *
 * @param {string} code Original source.
 * @param {Insertion[]} insertions Edits from one stamp pass. Empty returns `code` unchanged.
 * @returns {string} Stamped source.
 */
export function applyInsertions(code: string, insertions: Insertion[]): string {
    if (!insertions.length)
        return code;
    const ordered = insertions.map((edit, index) => ({
        at: edit.at,
        end: edit.end != null && edit.end > edit.at ? edit.end : edit.at,
        text: edit.text,
        index,
    })).sort((a, b) => a.at - b.at || a.end - b.end || a.index - b.index);
    let out = '';
    let cursor = 0;
    for (const edit of ordered) {
        if (edit.at < cursor)
            continue;
        out += code.slice(cursor, edit.at) + edit.text;
        cursor = edit.end;
    }
    return out + code.slice(cursor);
}
