/**
 * Import-block extraction for `<script>` blocks embedded in template files (Vue SFC, Svelte).
 *
 * Purpose: template locators report the same `importsCode` / `importsRange` fields as the JSX path, so an agent sees
 * which components a template uses. The script body is parsed with oxc using the block's own `lang`, never as TSX by
 * default, because `<T>` casts in `lang="ts"` and plain JS both parse differently under TSX.
 *
 * Boundary: pure string/AST math (no fs). Offsets in the result are absolute file offsets, derived from the block's
 * content offset supplied by the caller. A block that fails to parse, or has no top-level `import`, yields `null`.
 */

import { parseSync } from 'oxc-parser';

/** oxc language tokens accepted for embedded scripts. */
type ScriptLang = 'js' | 'jsx' | 'ts' | 'tsx';

/**
 * Map a `<script lang="…">` value to an oxc language.
 *
 * Boundary: missing / unknown values fall back to `'js'`; `'typescript'` is accepted as an alias some tooling emits.
 *
 * @param {string | null | undefined} lang Raw `lang` attribute value.
 * @returns {ScriptLang} oxc `lang` option for {@link extractScriptImports}.
 */
export function scriptLangFromAttr(lang: string | null | undefined): ScriptLang {
    const value = String(lang ?? '').trim().toLowerCase();
    if (value === 'ts' || value === 'typescript')
        return 'ts';
    if (value === 'tsx' || value === 'jsx')
        return value;
    return 'js';
}

/**
 * Find the contiguous top-level import block of one embedded script.
 *
 * Purpose: return the span from the first to the last top-level `import` declaration, so the excerpt stays valid
 * source even when non-import statements sit between imports.
 *
 * @param {string} content Script block content (text between `<script …>` and `</script>`).
 * @param {number} contentOffset Absolute file offset where `content` starts; added to the returned offsets.
 * @param {ScriptLang} lang oxc language for the block (see {@link scriptLangFromAttr}). A wrong value can turn valid
 *   code into a parse error, which yields `null` rather than a partial block.
 * @returns {{ code: string, start: number, end: number } | null} Import block text with absolute `[start, end)`
 *   offsets, or `null` when the block has no import or does not parse.
 */
export function extractScriptImports(content: string, contentOffset: number, lang: ScriptLang) {
    if (!content || !/\bimport\b/.test(content))
        return null;
    let program;
    try {
        const result = parseSync(`embedded.${lang}`, content, { sourceType: 'module', lang });
        if (Array.isArray(result.errors) && result.errors.length > 0)
            return null;
        program = result.program;
    }
    catch {
        return null;
    }
    const imports = (program?.body ?? []).filter((stmt) => stmt?.type === 'ImportDeclaration');
    if (imports.length === 0)
        return null;
    const first = imports[0];
    const last = imports[imports.length - 1];
    return {
        code: content.slice(first.start, last.end),
        start: contentOffset + first.start,
        end: contentOffset + last.end,
    };
}
