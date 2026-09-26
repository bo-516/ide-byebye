/**
 * Component detection and callsite-path propagation for JSX.
 *
 * Purpose: a function whose name starts with an uppercase letter (or an anonymous `export default`
 * that returns markup) and a class with a superclass and `render()` get their root element stamped
 * as `expr || "own path"`. The expr reads the path the parent passed in. Parameter text is inserted
 * only when a root is actually stamped.
 *
 * Boundary: uses the scope tree from `jsx-bindings` and the root rules from `jsx-roots`. Does not
 * parse. Array-destructured props do not propagate. Nested functions and classes are not walked
 * when collecting a component's returns — they are components of their own, or plain functions.
 */

import { PATH_ATTR } from './stamp-edits.js';
import { isClass, isFunction, isObjectMethod } from './jsx-bindings.js';
import { paramPlan, propertyName } from './jsx-params.js';
import { collectRootTargets, estimateRootCount, type RootTarget } from './jsx-roots.js';

export interface PropPlan {
    /** Local starts of roots that use `expr`. The parameter is injected only if one of them is stamped. */
    starts: number[];
    insert: (insertions: Array<{ at: number, text: string }>) => void;
}

/**
 * Map each component root to the callsite expression, and return parameter injections.
 *
 * The map includes escaped roots and roots that already have the attribute. The stamper decides
 * whether a value is actually written; it must call `plan.insert` only for plans whose `starts`
 * were written. Class components have no parameter plan.
 *
 * @param {object} input `scopes` from `buildScopes`, plus the parsed `code`.
 * @param {Map<number, string>} dynamic Local opening-element or call `start` → callsite expression.
 * @returns {PropPlan[]} One plan per function component that has a usable first parameter.
 */
export function componentPropagations(input, dynamic: Map<number, string>): PropPlan[] {
    const { scopes, code } = input;
    const plans: PropPlan[] = [];
    for (const item of scopes.functions) {
        if (!isComponentFunction(item, scopes))
            continue;
        const plan = paramPlan(item.node, code);
        if (!plan)
            continue;
        const targets = [];
        eachRoot(item.node, scopes, (expression, scope) => {
            if (estimateRootCount(expression, scope) > 1)
                return;
            targets.push(...collectRootTargets(expression, scope));
        });
        const starts = rememberTargets(targets, plan.expr, dynamic);
        if (starts.length)
            plans.push({ starts, insert: plan.insert });
    }
    for (const item of scopes.classes) {
        if (!isComponentClass(item, scopes))
            continue;
        const expr = `this.props && this.props[${JSON.stringify(PATH_ATTR)}]`;
        for (const method of renderMethods(item.node)) {
            eachRoot(method.value, scopes, (expression, scope) => {
                if (estimateRootCount(expression, scope) > 1)
                    return;
                rememberTargets(collectRootTargets(expression, scope), expr, dynamic);
            });
        }
    }
    return plans;
}

function rememberTargets(targets: RootTarget[], expr: string, dynamic: Map<number, string>): number[] {
    const starts = [];
    for (const target of targets) {
        const start = target.type === 'jsx' ? target.node.openingElement?.start : target.node.start;
        if (typeof start !== 'number' || dynamic.has(start))
            continue;
        dynamic.set(start, expr);
        starts.push(start);
    }
    return starts;
}

function isComponentFunction(item, scopes): boolean {
    const name = ownerName(item.node, item.ancestors);
    if (name)
        return /^[A-Z]/.test(name);
    return hasExportDefault(item.ancestors) && hasRenderable(item.node, scopes);
}

function isComponentClass(item, scopes): boolean {
    const renders = renderMethods(item.node);
    if (!item.node.superClass || renders.length === 0)
        return false;
    const name = ownerName(item.node, item.ancestors);
    if (name)
        return /^[A-Z]/.test(name);
    return hasExportDefault(item.ancestors) && renders.some((method) => hasRenderable(method.value, scopes));
}

function ownerName(node, ancestors): string {
    if (node.id?.type === 'Identifier' && node.id.name)
        return node.id.name;
    for (let i = ancestors.length - 1; i >= 0; i--) {
        const current = ancestors[i];
        if (current.type === 'VariableDeclarator' && current.id?.type === 'Identifier')
            return current.id.name;
        if (current.type === 'AssignmentExpression' && current.left?.type === 'Identifier')
            return current.left.name;
        if (isFunction(current) || isClass(current) || isObjectMethod(current) || current.type === 'MethodDefinition')
            break;
    }
    return '';
}

function hasExportDefault(ancestors): boolean {
    for (let i = ancestors.length - 1; i >= 0; i--) {
        const current = ancestors[i];
        if (current.type === 'ExportDefaultDeclaration')
            return true;
        if (isFunction(current) || isClass(current) || isObjectMethod(current) || current.type === 'MethodDefinition')
            return false;
    }
    return false;
}

function hasRenderable(fn, scopes): boolean {
    let found = false;
    eachRoot(fn, scopes, (expression, scope) => {
        if (collectRootTargets(expression, scope).length > 0)
            found = true;
    });
    return found;
}

/**
 * Visit each return argument, or the arrow expression body, without entering nested functions or classes.
 *
 * @param {object} fn Function node.
 * @param {object} scopes Scope index.
 * @param {(expression: object, scope: object) => void} visit
 */
function eachRoot(fn, scopes, visit) {
    if (!fn?.body)
        return;
    if (fn.body.type !== 'BlockStatement') {
        visit(fn.body, scopes.scopeOf(fn.body));
        return;
    }
    const stack = [{ node: fn.body, blocked: false }];
    while (stack.length) {
        const { node, blocked } = stack.pop();
        if (!node || typeof node !== 'object' || blocked)
            continue;
        if (node.type === 'ReturnStatement')
            visit(node.argument, scopes.scopeOf(node));
        for (const key of Object.keys(node)) {
            const child = node[key];
            const children = Array.isArray(child) ? child : [child];
            for (const item of children) {
                if (!item || typeof item.type !== 'string')
                    continue;
                const nested = item !== fn && (isFunction(item) || isClass(item));
                stack.push({ node: item, blocked: nested });
            }
        }
    }
}

function renderMethods(classNode) {
    return (classNode.body?.body ?? []).filter((member) => member?.type === 'MethodDefinition'
        && !member.computed
        && propertyName(member.key) === 'render'
        && member.value);
}
