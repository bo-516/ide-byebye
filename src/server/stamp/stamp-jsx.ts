/**
 * Stamp JSX elements and `createElement` calls with `data-insp-path`.
 *
 * Purpose: oxc parses the file, component roots get the callsite expression from `jsx-components`,
 * and every other element gets a static path. `.ts` is parsed as TypeScript (not TSX) so `<T>x`
 * stays a type assertion and `createElement` in that file still stamps.
 *
 * Boundary: returns `null` when oxc reports a syntax error — the caller keeps the original source.
 * `offsetBase` / `fileLineStarts` shift a Vue `<script>` block onto file-level positions; omit both
 * for a standalone module. `experimentalRawTransfer` is used only when this Node supports it, and a
 * throw falls back to a normal `parseSync` so the edits stay the same.
 */

import { parseSync, rawTransferSupported } from 'oxc-parser';
import { walkAst } from '../ast/jsx-locator.js';
import { buildLineStartOffsets, lineColumnFromOffset } from '../ast/line-offsets.js';
import { buildScopes } from './jsx-bindings.js';
import { componentPropagations } from './jsx-components.js';
import { PATH_ATTR, formatInspValue, isEscapedTag, type Insertion } from './stamp-edits.js';

export interface StampJsxInput {
    code: string;
    file: string;
    lang: 'tsx' | 'jsx' | 'ts';
    escapeTags?: Array<string | RegExp>;
    /** Added to every node offset. Use the `<script>` inner start when `code` is not the whole file. */
    offsetBase?: number;
    /** Line starts of the file `offsetBase` is relative to. Defaults to line starts of `code`. */
    fileLineStarts?: number[];
    /** Force raw transfer. Omit to follow {@link rawTransferSupported}. */
    raw?: boolean;
}

/**
 * Whether this process can parse with oxc raw transfer (Node ≥ 22, 64-bit little-endian).
 *
 * @returns {boolean}
 */
export function rawTransferEnabled(): boolean {
    return rawTransferSupported();
}

/**
 * Insertions for one JS/TS module, or `null` when the file does not parse.
 *
 * @param {StampJsxInput} input Source, absolute path, and language. `escapeTags` defaults to none.
 * @returns {Insertion[] | null} Edits into the original file (`offsetBase` already applied), or null on a parse error.
 */
export function stampJsx(input: StampJsxInput): Insertion[] | null {
    const parsed = parseModule(input.file, input.code, input.lang, input.raw ?? rawTransferSupported());
    if (!parsed || parsed.errors?.length)
        return null;
    const base = input.offsetBase ?? 0;
    const starts = input.fileLineStarts ?? buildLineStartOffsets(input.code);
    const escapeTags = input.escapeTags ?? [];
    const scopes = buildScopes(parsed.program);
    const dynamic = new Map<number, string>();
    const plans = componentPropagations({ scopes, code: input.code }, dynamic);
    const insertions: Insertion[] = [];
    const used = new Set<number>();

    walkAst(parsed.program, (node) => {
        if (node.type === 'JSXElement')
            stampElement(node, input, base, starts, escapeTags, dynamic, insertions, used);
        else if (node.type === 'CallExpression' && callName(node.callee) === 'createElement')
            stampCall(node, input, base, starts, escapeTags, dynamic, insertions, used);
    });

    // Parameter edits are offsets into `input.code`; element edits already include `base`.
    for (const plan of plans) {
        if (!plan.starts.some((start) => used.has(start)))
            continue;
        const local: Insertion[] = [];
        plan.insert(local);
        for (const edit of local)
            insertions.push({ at: edit.at + base, text: edit.text });
    }
    return insertions;
}

function stampElement(node, input, base, starts, escapeTags, dynamic, insertions, used) {
    const opening = node.openingElement;
    const tag = jsxName(opening?.name);
    if (!opening || !tag || isEscapedTag(tag, escapeTags) || hasJsxPath(opening.attributes))
        return;
    const expr = dynamic.get(opening.start);
    const fallback = pathAt(input.file, starts, base + node.start, tag);
    const rendered = expr ? `{${expr} || ${JSON.stringify(fallback)}}` : JSON.stringify(fallback);
    const gap = opening.attributes?.length ? ' ' : '';
    insertions.push({
        at: base + opening.end - (opening.selfClosing ? 2 : 1),
        text: ` ${PATH_ATTR}=${rendered}${gap}`,
    });
    if (expr)
        used.add(opening.start);
}

function stampCall(node, input, base, starts, escapeTags, dynamic, insertions, used) {
    const tag = exprName(node.arguments?.[0]);
    if (!tag || isEscapedTag(tag, escapeTags))
        return;
    const props = node.arguments?.[1];
    if (hasCallPath(props))
        return;
    const expr = dynamic.get(node.start);
    const fallback = pathAt(input.file, starts, base + node.start, tag);
    const value = expr ? `${expr} || ${JSON.stringify(fallback)}` : JSON.stringify(fallback);
    const key = JSON.stringify(PATH_ATTR);
    if (!props) {
        const typeArg = node.arguments?.[0];
        if (typeArg?.end == null)
            return;
        insertions.push({ at: base + typeArg.end, text: `, { ${key}: ${value} }` });
    }
    else if (props.type === 'ObjectExpression') {
        const comma = props.properties?.length ? ', ' : '';
        insertions.push({ at: base + props.start + 1, text: `${key}: ${value}${comma}` });
    }
    else {
        insertions.push({ at: base + props.start, text: 'Object.assign({}, ' });
        insertions.push({ at: base + props.end, text: `, { ${key}: ${value} })` });
    }
    if (expr)
        used.add(node.start);
}

function pathAt(file, starts, offset, tag) {
    const { line, column } = lineColumnFromOffset(starts, offset);
    return formatInspValue(file, line, column + 1, tag);
}

function parseModule(file: string, code: string, lang: StampJsxInput['lang'], raw: boolean) {
    const options: Record<string, unknown> = { lang, sourceType: 'module' };
    if (raw) {
        try {
            options.experimentalRawTransfer = true;
            return parseSync(file, code, options);
        }
        catch {
            delete options.experimentalRawTransfer;
        }
    }
    return parseSync(file, code, options);
}

function hasJsxPath(attributes): boolean {
    return (attributes ?? []).some((attr) => attr.type !== 'JSXSpreadAttribute' && attr.name?.name === PATH_ATTR);
}

function hasCallPath(props): boolean {
    if (props?.type !== 'ObjectExpression')
        return false;
    return (props.properties ?? []).some((prop) => prop?.type === 'Property' && !prop.computed && propertyName(prop.key) === PATH_ATTR);
}

function jsxName(node): string {
    if (!node)
        return '';
    if (node.type === 'JSXIdentifier')
        return node.name ?? '';
    if (node.type === 'JSXMemberExpression')
        return `${jsxName(node.object)}.${jsxName(node.property)}`;
    if (node.type === 'JSXNamespacedName')
        return `${jsxName(node.namespace)}:${jsxName(node.name)}`;
    return '';
}

function exprName(node): string {
    if (!node)
        return '';
    if ((node.type === 'Literal' || node.type === 'StringLiteral') && typeof node.value === 'string')
        return node.value;
    if (node.type === 'Identifier')
        return node.name ?? '';
    if (node.type === 'MemberExpression' && !node.computed && node.property?.type === 'Identifier')
        return `${exprName(node.object)}.${node.property.name}`;
    return '';
}

function propertyName(node): string {
    if (node?.type === 'Identifier')
        return node.name ?? '';
    if ((node?.type === 'Literal' || node?.type === 'StringLiteral') && typeof node.value === 'string')
        return node.value;
    return '';
}

function callName(callee): string {
    if (callee?.type === 'Identifier')
        return callee.name ?? '';
    if (callee?.type === 'MemberExpression' && !callee.computed && callee.property?.type === 'Identifier')
        return callee.property.name ?? '';
    return '';
}
