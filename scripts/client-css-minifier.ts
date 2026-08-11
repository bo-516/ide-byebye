/**
 * Matches exported CSS template literals that are safe to minify during the browser-client build.
 *
 * Boundary: this intentionally targets simple `export const NAME = \`...\`;` declarations. Passing arbitrary JavaScript
 * with nested template literals can skip minification or produce invalid code, so callers must restrict it to known CSS
 * style modules.
 *
 * @type {RegExp} Global matcher returning the export name and raw template body.
 */
const CSS_TEMPLATE_EXPORT_RE = /export\s+const\s+([A-Z0-9_]+)\s*=\s*`([\s\S]*?)`;/g;

/**
 * Remove CSS block comments while preserving quoted strings.
 *
 * Boundary: this is a small CSS-string helper for generated client assets, not a full CSS parser. Unterminated comments
 * are dropped to the end of the string; passing non-CSS text can remove `/* ... *\/` sequences that were meaningful.
 *
 * @param {string} css Raw CSS text from a source template literal.
 * @returns {string} CSS text without block comments.
 */
function stripCssComments(css) {
    let output = '';
    let quote = '';

    for (let index = 0; index < css.length; index += 1) {
        const char = css[index];
        const next = css[index + 1];

        if (quote) {
            output += char;
            if (char === '\\') {
                output += next ?? '';
                index += 1;
            }
            else if (char === quote) {
                quote = '';
            }
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            output += char;
            continue;
        }

        if (char === '/' && next === '*') {
            index = css.indexOf('*/', index + 2);
            if (index === -1)
                break;
            index += 1;
            continue;
        }

        output += char;
    }

    return output;
}

/**
 * Replace quoted CSS strings with placeholders so whitespace compaction cannot alter their contents.
 *
 * Boundary: placeholders are only valid for the returned text from this call. Passing CSS that already contains the
 * placeholder prefix can restore the wrong content, but generated style modules do not contain those control tokens.
 *
 * @param {string} css CSS text without comments.
 * @returns {{ text: string, strings: string[] }} Placeholder text and the strings to restore in order.
 */
function protectCssStrings(css) {
    const strings = [];
    let output = '';

    for (let index = 0; index < css.length; index += 1) {
        const char = css[index];
        if (char !== '"' && char !== "'") {
            output += char;
            continue;
        }

        const start = index;
        const quote = char;
        index += 1;
        for (; index < css.length; index += 1) {
            if (css[index] === '\\') {
                index += 1;
                continue;
            }
            if (css[index] === quote)
                break;
        }

        strings.push(css.slice(start, index + 1));
        output += `\u0000CSS_STRING_${strings.length - 1}\u0000`;
    }

    return { text: output, strings };
}

/**
 * Restore quoted CSS strings after whitespace compaction.
 *
 * Boundary: `text` must come from `protectCssStrings`; otherwise placeholder-looking content may be replaced
 * unexpectedly. Missing string indexes restore to an empty string, which would indicate a caller bug.
 *
 * @param {string} text Placeholder text to restore.
 * @param {string[]} strings Original quoted CSS strings.
 * @returns {string} CSS text with quoted strings restored.
 */
function restoreCssStrings(text, strings) {
    return text.replace(/\u0000CSS_STRING_(\d+)\u0000/g, (_, index) => strings[Number(index)] ?? '');
}

/**
 * Minify CSS text embedded in browser-client template literals.
 *
 * Boundary: preserves quoted strings and `calc()` operator spacing, but does not perform semantic CSS rewrites such as
 * color shortening or selector merging. Passing malformed CSS still returns best-effort compact text.
 *
 * @param {string} css Raw CSS template body.
 * @returns {string} Compact CSS suitable for embedding back into a JavaScript template literal.
 */
function minifyCssText(css) {
    const { text, strings } = protectCssStrings(stripCssComments(css));
    const compact = text
        .replace(/\s+/g, ' ')
        .replace(/\s*([{}:;,])\s*/g, '$1')
        .replace(/;}/g, '}')
        .trim();
    return restoreCssStrings(compact, strings);
}

/**
 * Minify exported CSS template literals in one source module.
 *
 * Boundary: only direct exported constants matched by `CSS_TEMPLATE_EXPORT_RE` are changed. Passing modules with other
 * template exports leaves them untouched, and passing CSS that includes backticks can produce invalid JavaScript.
 *
 * @param {string} code JavaScript module source.
 * @returns {string} JavaScript source with matched CSS template bodies minified.
 */
function minifyCssTemplateExports(code) {
    return code.replace(CSS_TEMPLATE_EXPORT_RE, (_, name, css) => {
        const minified = minifyCssText(css).replace(/`/g, '\\`');
        return `export const ${name} = \`${minified}\`;`;
    });
}

/**
 * Build a Rolldown plugin that minifies CSS template exports in known client style modules.
 *
 * Boundary: `moduleFiles` must contain absolute file paths. Passing relative paths will usually miss Rolldown's
 * absolute module ids, leaving CSS unminified without failing the build.
 *
 * @param {string[]} moduleFiles Absolute source files whose CSS template exports should be minified.
 * @returns {{ name: string, transform(code: string, id: string): { code: string, map: null } | null }} Rolldown plugin.
 */
export function createCssTemplateMinifyPlugin(moduleFiles) {
    const targets = new Set(moduleFiles);
    return {
        name: 'client-css-template-minify',
        transform(code, id) {
            const file = id.split('?')[0];
            if (!targets.has(file))
                return null;
            const transformed = minifyCssTemplateExports(code);
            return transformed === code ? null : { code: transformed, map: null };
        },
    };
}
