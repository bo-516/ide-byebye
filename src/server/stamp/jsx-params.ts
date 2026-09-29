/**
 * Callsite expression for a component function's first parameter.
 *
 * Purpose: identifier params read `p && p["data-insp-path"]`, object patterns reuse an existing
 * `"data-insp-path"` binding or inject `__ideByebyePath`, and a function with no params injects
 * `__ideByebyeProps` just before the `)`. Array patterns do not propagate.
 *
 * Boundary: offsets are into the parsed source string. The caller inserts only after a root was
 * actually stamped. A missing `)` before the body returns null and that function is left static.
 */

import { PATH_ATTR, PATH_BINDING, PROPS_BINDING } from './stamp-edits.js';
import type { StampNode } from './stamp-edits.js';

/** Parameter edit: text inserted at `at` inside the original source. */
interface ParamEdit {
    at: number;
    text: string;
}

/** How a component reads the callsite path, plus the edit that injects a binding when needed. */
interface ParamPlanResult {
    expr: string;
    insert: (insertions: ParamEdit[]) => void;
}

/**
 * @param {StampNode} fn Function node with `params` and `body`.
 * @param {string} code Source `fn` was parsed from, used to find the empty parameter list.
 * @returns {ParamPlanResult | null}
 *   Null when the parameter shape cannot carry a path (array pattern, or no `)` to edit).
 */
export function paramPlan(fn: StampNode, code: string): ParamPlanResult | null {
    const first = fn.params?.[0];
    if (!first) {
        const at = emptyParamsAt(fn, code);
        if (at == null)
            return null;
        const expr = `${PROPS_BINDING} && ${PROPS_BINDING}[${JSON.stringify(PATH_ATTR)}]`;
        return { expr, insert: (insertions: ParamEdit[]) => insertions.push({ at, text: PROPS_BINDING }) };
    }
    return paramExpr(first);
}

/**
 * Property or method name for an identifier or string key. Computed keys return `''`.
 *
 * @param {StampNode | null | undefined} node Key node.
 * @returns {string}
 */
export function propertyName(node: StampNode | null | undefined): string {
    if (node?.type === 'Identifier')
        return node.name ?? '';
    if ((node?.type === 'Literal' || node?.type === 'StringLiteral') && typeof node.value === 'string')
        return node.value;
    return '';
}

function paramExpr(param: StampNode): ParamPlanResult | null {
    if (param.type === 'Identifier') {
        const expr = `${param.name} && ${param.name}[${JSON.stringify(PATH_ATTR)}]`;
        return { expr, insert() {} };
    }
    if (param.type === 'AssignmentPattern')
        return paramExpr(param.left as StampNode);
    if (param.type === 'ObjectPattern') {
        const existing = objectPathBinding(param);
        if (existing)
            return { expr: existing, insert() {} };
        const comma = param.properties?.length ? ', ' : '';
        const text = `${JSON.stringify(PATH_ATTR)}: ${PATH_BINDING}${comma}`;
        return { expr: PATH_BINDING, insert: (insertions: ParamEdit[]) => insertions.push({ at: param.start + 1, text }) };
    }
    return null;
}

function objectPathBinding(param: StampNode): string {
    for (const property of param.properties ?? []) {
        if (property?.type !== 'Property' || property.computed || propertyName(property.key) !== PATH_ATTR)
            continue;
        const value = property.value as StampNode | null | undefined;
        if (value?.type === 'Identifier')
            return value.name as string;
        if (value?.type === 'AssignmentPattern' && value.left?.type === 'Identifier')
            return value.left.name as string;
    }
    return '';
}

function emptyParamsAt(fn: StampNode, code: string): number | null {
    const bodyStart = fn.body?.start;
    if (typeof fn.start !== 'number' || typeof bodyStart !== 'number')
        return null;
    const close = code.slice(fn.start, bodyStart).lastIndexOf(')');
    return close === -1 ? null : fn.start + close;
}
