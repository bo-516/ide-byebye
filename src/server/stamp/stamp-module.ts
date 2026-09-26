/**
 * Choose a stamper from a module id.
 *
 * Purpose: one function for every bundler. `family: 'rollup'` skips `*.vue?vue` subrequests (those
 * are already-stamped JS). `family: 'webpack'` stamps them because vue-loader hands the raw SFC to
 * the subrequest. Queries `raw`, `url`, `worker`, `sharedworker`, `inline`, and `type=style` are
 * never stamped. `/node_modules/` is skipped unless `include` matches; `exclude` always wins.
 *
 * Boundary: returns null when the source must not change, including parse failures and thrown
 * bugs (one warning per process, with the file path). Does not read the disk. `id` may be a
 * Windows path; the attribute value normalizes slashes inside the language stampers.
 */

import path from 'node:path';
import { applyInsertions, isStampIgnored } from './stamp-edits.js';
import { stampJsx, type StampJsxInput } from './stamp-jsx.js';
import { stampSvelte } from './stamp-svelte.js';
import { stampVue } from './stamp-vue.js';
import type { ResolvedStampOptions } from './stamp-options.js';

export type StampFamily = 'rollup' | 'webpack';

const QUERY_SKIP = new Set(['raw', 'url', 'worker', 'sharedworker', 'inline']);
let internalWarned = false;
const warnedKeys = new Set<string>();

export interface StampModuleInput {
    code: string;
    id: string;
    family: StampFamily;
    options: ResolvedStampOptions;
    warnOnce?: (key: string, message: string) => void;
    /** Passed through to the JSX parser. Omit to follow raw-transfer support. */
    raw?: boolean;
}

/**
 * Stamped source, or null when this module is left unchanged.
 *
 * @param {StampModuleInput} input `options.enabled === false` returns null without warning.
 * @returns {string | null}
 */
export function stampModule(input: StampModuleInput): string | null {
    if (!input.options?.enabled)
        return null;
    try {
        const insertions = insertionsFor(input);
        if (!insertions?.length)
            return null;
        return applyInsertions(input.code, insertions);
    }
    catch (err) {
        if (!internalWarned) {
            internalWarned = true;
            const message = err instanceof Error ? err.message : String(err);
            const warn = input.warnOnce ?? ((key, text) => console.warn(text));
            warn('stamp-internal', `[code-intent-inspector] stamp failed for ${input.id}: ${message}; leaving source unchanged`);
        }
        return null;
    }
}

/**
 * Reset the once-per-process internal-error warning. Tests only.
 *
 * @returns {void}
 */
export function resetStampModuleWarnings(): void {
    internalWarned = false;
    warnedKeys.clear();
}

function insertionsFor(input: StampModuleInput) {
    const split = splitId(input.id);
    if (!split || skipId(split, input))
        return null;
    const { filePath, query, ext } = split;
    const kind = ext === '.vue' || ext === '.svelte' || ext === '.html' ? 'html' : 'js';
    if (isStampIgnored(input.code, kind))
        return null;
    const escapeTags = input.options.escapeTags ?? [];
    const warnOnce = (key: string, message: string) => {
        if (warnedKeys.has(key))
            return;
        warnedKeys.add(key);
        (input.warnOnce ?? ((_ignored, text) => console.warn(text)))(key, message);
    };
    if (ext === '.vue' || (ext === '.html' && isHtmlTemplate(query)))
        return stampVue({ code: input.code, file: filePath, escapeTags, warnOnce });
    if (ext === '.svelte')
        return stampSvelte({ code: input.code, file: filePath, escapeTags, warnOnce });
    const lang = langFor(ext);
    if (!lang || !needsParse(ext, input.code))
        return null;
    return stampJsx({ code: input.code, file: filePath, lang, escapeTags, raw: input.raw });
}

function skipId(split: { filePath: string, query: string, ext: string, id: string }, input: StampModuleInput): boolean {
    const { filePath, query, ext, id } = split;
    if (id.startsWith('\0') || id.startsWith('virtual:') || filePath.startsWith('\0'))
        return true;
    if (querySkips(query))
        return true;
    if (ext === '.cjs' || ext === '.cts')
        return true;
    if (input.family === 'rollup' && ext === '.vue' && query.includes('vue'))
        return true;
    const posix = filePath.replace(/\\/g, '/');
    if (matches(input.options.exclude, posix) || matches(input.options.exclude, id))
        return true;
    if (isUnincludedNodeModule(posix, id, input.options.include))
        return true;
    return false;
}

/**
 * Whether a `node_modules` file is outside `include`.
 *
 * Bundlers that can bail out before reading a file (esbuild `onLoad`) call this so an
 * `include` hit is still stamped. Paths outside `node_modules` return false. A pattern that
 * is neither a string nor a RegExp throws, and the dispatcher fails open.
 *
 * @param {string} filePath Absolute path with the query already removed. Backslashes are normalized.
 * @param {string} id Full module id, compared as given (a query can be what `include` names).
 * @param {Array<string | RegExp> | undefined} include Resolved include patterns. None means every `node_modules` file is skipped.
 * @returns {boolean} True when the file is under `node_modules` and neither `filePath` nor `id` matches.
 */
export function isUnincludedNodeModule(filePath: string, id: string, include: Array<string | RegExp> | undefined): boolean {
    const posix = filePath.replace(/\\/g, '/');
    if (!posix.includes('/node_modules/'))
        return false;
    return !matches(include, posix) && !matches(include, id);
}

function splitId(id: string) {
    if (!id)
        return null;
    const queryAt = id.indexOf('?');
    const filePath = queryAt === -1 ? id : id.slice(0, queryAt);
    const query = queryAt === -1 ? '' : id.slice(queryAt + 1);
    const ext = path.posix.extname(filePath.replace(/\\/g, '/')).toLowerCase();
    return { filePath, query, ext, id };
}

function langFor(ext: string): StampJsxInput['lang'] | null {
    if (ext === '.tsx')
        return 'tsx';
    if (ext === '.jsx' || ext === '.js' || ext === '.mjs')
        return 'jsx';
    if (ext === '.ts' || ext === '.mts')
        return 'ts';
    return null;
}

function needsParse(ext: string, code: string): boolean {
    if (ext === '.ts' || ext === '.mts')
        return code.includes('createElement');
    if (ext === '.js' || ext === '.jsx' || ext === '.mjs')
        return code.includes('<') || code.includes('createElement');
    return true;
}

function isHtmlTemplate(query: string): boolean {
    return query.includes('vue') && /(^|&)type=template(&|$)/.test(query);
}

function querySkips(query: string): boolean {
    if (!query)
        return false;
    const params = new URLSearchParams(query);
    if (params.get('type') === 'style')
        return true;
    for (const key of QUERY_SKIP) {
        if (params.has(key))
            return true;
    }
    return false;
}

function matches(patterns, value: string): boolean {
    for (const pattern of patterns ?? []) {
        if (typeof pattern === 'string') {
            if (value.includes(pattern))
                return true;
        }
        else if (pattern instanceof RegExp) {
            pattern.lastIndex = 0;
            if (pattern.test(value))
                return true;
        }
        else
            throw new TypeError('stamp include/exclude patterns must be strings or regular expressions');
    }
    return false;
}
