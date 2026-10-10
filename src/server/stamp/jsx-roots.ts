/**
 * Which nodes are the root elements of a returned expression.
 *
 * Purpose: a component propagates the callsite path only when a return (or an arrow body) has at
 * most one root. Ternaries and `&&` / `||` use the larger branch; arrays and fragments add children.
 * An identifier follows its variable initializer, not a parameter, import, or function.
 *
 * Boundary: oxc ESTree. Parentheses, `as`, `<T>`, and `!` are peeled first. `createPortal(x)` is not a
 * root target: `x` renders under another DOM container (a dialog, a popover), so it keeps its own static
 * path instead of the callsite — the browser recovers the mount point from the component tree. It still
 * counts toward {@link estimateRootCount}, so `<><A/>{createPortal(…)}</>` stays "more than one root" and
 * `<A/>` keeps its own path, as before. This is the one documented difference from code-inspector 1.6.2,
 * which propagates the portal content. Anything else (calls, member access) is not a root. Cycles in
 * bindings are cut with `start:name`.
 */

import type { Scope } from './jsx-bind.js';
import { lookupBinding, singleAssignRight } from './jsx-bindings.js';
import type { StampNode } from './stamp-edits.js';

/**
 * One root of a returned expression: a JSX element, or a `createElement(...)` call.
 * `node` is the parser node itself; callers read `openingElement.start` (JSX) or `start` (call) from it.
 */
export type RootTarget = { type: 'jsx', node: StampNode } | { type: 'createElement', node: StampNode };

/**
 * Root elements of `node`, using `scope` for identifier lookup (the return's scope, or the
 * binding's scope when following an initializer — not the identifier's home scope).
 *
 * Boundary: a `createPortal(x, container)` call yields no targets, so `x` is stamped with its own
 * path and a component that only returns a portal gets no injected callsite parameter.
 *
 * @param {StampNode | null | undefined} node Expression. Null returns an empty list.
 * @param {Scope | null} scope Scope from {@link import('./jsx-bindings.js').buildScopes}.
 * @param {Set<string>} [visited] Bindings already entered. Omit at the top call.
 * @returns {RootTarget[]} JSX elements and `createElement` calls, in source order.
 */
export function collectRootTargets(node: StampNode | null | undefined, scope: Scope | null, visited = new Set<string>()): RootTarget[] {
    const current = unwrap(node);
    if (!current)
        return [];
    if (current !== node)
        return collectRootTargets(current, scope, visited);
    if (current.type === 'JSXElement')
        return [{ type: 'jsx', node: current }];
    if (current.type === 'CallExpression') {
        if (callName(current.callee as StampNode | null | undefined) === 'createPortal')
            return [];
        if (callName(current.callee as StampNode | null | undefined) === 'createElement')
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
        return (current.elements ?? []).flatMap((element: StampNode | null | undefined) => collectRootTargets(element?.type === 'SpreadElement' ? element.argument : element, scope, visited));
    if (current.type === 'JSXFragment')
        return fragmentTargets(current, scope, visited);
    return [];
}

/**
 * How many roots `node` would produce. Stops at 2. Ternaries and logical expressions take the max,
 * so `cond ? <a/> : <b/>` counts as one and both branches still propagate. `createPortal(x)` counts
 * as `x` even though {@link collectRootTargets} returns nothing for it, so a portal beside another
 * root still keeps that root from propagating (same counts as code-inspector).
 *
 * @param {StampNode | null | undefined} node Expression.
 * @param {Scope | null} scope Lookup scope. See {@link collectRootTargets}.
 * @param {Set<string>} [visited] Bindings already entered.
 * @returns {number} 0, 1, or 2 (2 means "more than one").
 */
export function estimateRootCount(node: StampNode | null | undefined, scope: Scope | null, visited = new Set<string>()): number {
    const current = unwrap(node);
    if (!current)
        return 0;
    if (current !== node)
        return estimateRootCount(current, scope, visited);
    if (current.type === 'JSXElement')
        return 1;
    if (current.type === 'CallExpression') {
        if (callName(current.callee as StampNode | null | undefined) === 'createPortal')
            return estimateRootCount(current.arguments?.[0], scope, visited);
        return callName(current.callee as StampNode | null | undefined) === 'createElement' ? 1 : 0;
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
        return sumCount(current.elements ?? [], scope, visited, (element: StampNode | null | undefined) => element?.type === 'SpreadElement' ? element.argument : element);
    if (current.type === 'JSXFragment')
        return sumCount(current.children ?? [], scope, visited, fragmentChild);
    return 0;
}

/**
 * @param {StampNode | null | undefined} node Expression that might be wrapped.
 * @returns {StampNode | null | undefined} Inner expression, or `node` when it is already bare.
 */
function unwrap(node: StampNode | null | undefined): StampNode | null | undefined {
    if (!node)
        return node;
    if (node.type === 'ParenthesizedExpression' || node.type === 'TSAsExpression'
        || node.type === 'TSTypeAssertion' || node.type === 'TSNonNullExpression'
        || node.type === 'TypeCastExpression')
        return node.expression;
    return node;
}

function follow(node: StampNode, scope: Scope | null, visited: Set<string>, mode: 'collect' | 'count') {
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

function fragmentTargets(node: StampNode, scope: Scope | null, visited: Set<string>): RootTarget[] {
    return (node.children ?? []).flatMap((child: StampNode) => {
        if (child.type === 'JSXElement')
            return [{ type: 'jsx', node: child }];
        if (child.type === 'JSXFragment')
            return collectRootTargets(child, scope, visited);
        if (child.type === 'JSXExpressionContainer')
            return collectRootTargets(child.expression, scope, visited);
        return [];
    });
}

function fragmentChild(child: StampNode | null | undefined): StampNode | null | undefined {
    if (child?.type === 'JSXElement' || child?.type === 'JSXFragment')
        return child;
    if (child?.type === 'JSXExpressionContainer')
        return child.expression;
    return null;
}

function sumCount(items: ReadonlyArray<StampNode | null | undefined>, scope: Scope | null, visited: Set<string>, pick: (item: StampNode | null | undefined) => StampNode | null | undefined): number {
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

function callName(callee: StampNode | null | undefined): string {
    if (!callee)
        return '';
    if (callee.type === 'Identifier')
        return callee.name ?? '';
    if (callee.type === 'MemberExpression' && !callee.computed && callee.property?.type === 'Identifier')
        return callee.property.name ?? '';
    return '';
}
