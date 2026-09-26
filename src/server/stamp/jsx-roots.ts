/**
 * Which nodes are the root elements of a returned expression.
 *
 * Purpose: a component propagates the callsite path only when a return (or an arrow body) has at
 * most one root. Ternaries and `&&` / `||` use the larger branch; arrays and fragments add children.
 * An identifier follows its variable initializer, not a parameter, import, or function.
 *
 * Boundary: oxc ESTree. Parentheses, `as`, `<T>`, and `!` are peeled first. `createPortal(x)` looks
 * at `x`. Anything else (calls, member access) is not a root. Cycles in bindings are cut with `start:name`.
 */

import { lookupBinding, singleAssignRight } from './jsx-bindings.js';

export type RootTarget = { type: 'jsx', node: any } | { type: 'createElement', node: any };

/**
 * Root elements of `node`, using `scope` for identifier lookup (the return's scope, or the
 * binding's scope when following an initializer — not the identifier's home scope).
 *
 * @param {object | null} node Expression. Null returns an empty list.
 * @param {object | null} scope Scope from {@link import('./jsx-bindings.js').buildScopes}.
 * @param {Set<string>} [visited] Bindings already entered. Omit at the top call.
 * @returns {RootTarget[]} JSX elements and `createElement` calls, in source order.
 */
export function collectRootTargets(node, scope, visited = new Set<string>()): RootTarget[] {
    const current = unwrap(node);
    if (!current)
        return [];
    if (current !== node)
        return collectRootTargets(current, scope, visited);
    if (current.type === 'JSXElement')
        return [{ type: 'jsx', node: current }];
    if (current.type === 'CallExpression') {
        if (callName(current.callee) === 'createPortal')
            return collectRootTargets(current.arguments?.[0], scope, visited);
        if (callName(current.callee) === 'createElement')
            return [{ type: 'createElement', node: current }];
        return [];
    }
    if (current.type === 'Identifier')
        return follow(current, scope, visited, 'collect') as RootTarget[];
    if (current.type === 'ConditionalExpression' || current.type === 'LogicalExpression') {
        return [
            ...collectRootTargets(current.consequent ?? current.left, scope, visited),
            ...collectRootTargets(current.alternate ?? current.right, scope, visited),
        ];
    }
    if (current.type === 'SequenceExpression') {
        const parts = current.expressions ?? [];
        return collectRootTargets(parts[parts.length - 1], scope, visited);
    }
    if (current.type === 'ArrayExpression')
        return (current.elements ?? []).flatMap((element) => collectRootTargets(element?.type === 'SpreadElement' ? element.argument : element, scope, visited));
    if (current.type === 'JSXFragment')
        return fragmentTargets(current, scope, visited);
    return [];
}

/**
 * How many roots `node` would produce. Stops at 2. Ternaries and logical expressions take the max,
 * so `cond ? <a/> : <b/>` counts as one and both branches still propagate.
 *
 * @param {object | null} node Expression.
 * @param {object | null} scope Lookup scope. See {@link collectRootTargets}.
 * @param {Set<string>} [visited] Bindings already entered.
 * @returns {number} 0, 1, or 2 (2 means "more than one").
 */
export function estimateRootCount(node, scope, visited = new Set<string>()): number {
    const current = unwrap(node);
    if (!current)
        return 0;
    if (current !== node)
        return estimateRootCount(current, scope, visited);
    if (current.type === 'JSXElement')
        return 1;
    if (current.type === 'CallExpression') {
        if (callName(current.callee) === 'createPortal')
            return estimateRootCount(current.arguments?.[0], scope, visited);
        return callName(current.callee) === 'createElement' ? 1 : 0;
    }
    if (current.type === 'Identifier')
        return follow(current, scope, visited, 'count') as number;
    if (current.type === 'ConditionalExpression' || current.type === 'LogicalExpression') {
        return Math.max(
            estimateRootCount(current.consequent ?? current.left, scope, visited),
            estimateRootCount(current.alternate ?? current.right, scope, visited),
        );
    }
    if (current.type === 'SequenceExpression') {
        const parts = current.expressions ?? [];
        return estimateRootCount(parts[parts.length - 1], scope, visited);
    }
    if (current.type === 'ArrayExpression')
        return sumCount(current.elements ?? [], scope, visited, (element) => element?.type === 'SpreadElement' ? element.argument : element);
    if (current.type === 'JSXFragment')
        return sumCount(current.children ?? [], scope, visited, fragmentChild);
    return 0;
}

/**
 * @param {object} node Expression that might be wrapped.
 * @returns {object} Inner expression, or `node` when it is already bare.
 */
function unwrap(node) {
    if (!node)
        return node;
    if (node.type === 'ParenthesizedExpression' || node.type === 'TSAsExpression'
        || node.type === 'TSTypeAssertion' || node.type === 'TSNonNullExpression'
        || node.type === 'TypeCastExpression')
        return node.expression;
    return node;
}

function follow(node, scope, visited: Set<string>, mode: 'collect' | 'count') {
    const empty = mode === 'collect' ? [] : 0;
    if (!scope || node.name === 'undefined')
        return empty;
    const binding = lookupBinding(scope, node.name);
    if (!binding?.declarator)
        return empty;
    const key = `${binding.id.start ?? ''}:${binding.id.name ?? ''}`;
    if (visited.has(key))
        return empty;
    visited.add(key);
    const next = binding.declarator.init ?? singleAssignRight(binding);
    if (!next)
        return empty;
    return mode === 'collect'
        ? collectRootTargets(next, binding.scope, visited)
        : estimateRootCount(next, binding.scope, visited);
}

function fragmentTargets(node, scope, visited): RootTarget[] {
    return (node.children ?? []).flatMap((child) => {
        if (child.type === 'JSXElement')
            return [{ type: 'jsx', node: child }];
        if (child.type === 'JSXFragment')
            return collectRootTargets(child, scope, visited);
        if (child.type === 'JSXExpressionContainer')
            return collectRootTargets(child.expression, scope, visited);
        return [];
    });
}

function fragmentChild(child) {
    if (child?.type === 'JSXElement' || child?.type === 'JSXFragment')
        return child;
    if (child?.type === 'JSXExpressionContainer')
        return child.expression;
    return null;
}

function sumCount(items, scope, visited, pick): number {
    let total = 0;
    for (const item of items) {
        const child = pick(item);
        if (!child)
            continue;
        total += estimateRootCount(child, scope, visited);
        if (total > 1)
            return 2;
    }
    return total;
}

function callName(callee): string {
    if (!callee)
        return '';
    if (callee.type === 'Identifier')
        return callee.name ?? '';
    if (callee.type === 'MemberExpression' && !callee.computed && callee.property?.type === 'Identifier')
        return callee.property.name ?? '';
    return '';
}
