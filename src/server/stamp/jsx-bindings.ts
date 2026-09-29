/**
 * Lightweight scope tree for component-root callsite propagation.
 *
 * Purpose: code-inspector asks Babel which binding an identifier refers to, then follows a
 * `const`/`let`/`var` initializer or the single `x = …` assignment. This walk records the same
 * facts without Babel's scope analysis: params, imports, and function names are visible so they
 * shadow outer variables, but they are not followed (they are not variable declarators).
 *
 * Boundary: one pass over an oxc ESTree program. Type-only fields are not walked. `var` binds on
 * the enclosing function (or program); `let`/`const` bind on the current block, `for`, `switch`,
 * or `catch`. A second assignment to the same binding makes {@link singleAssignRight} return null.
 */

import { bindName, bindParams, bindPattern, collectAssigns, isBlockScope, makeScope, nearestFunction } from './jsx-bind.js';
import type { Binding, Scope } from './jsx-bind.js';
import type { StampNode } from './stamp-edits.js';

const SKIP_KEYS = new Set([
    'typeAnnotation', 'returnType', 'typeParameters', 'typeArguments', 'decorators',
    'loc', 'range', 'start', 'end',
]);

/** A function or class plus the ancestors above it (not including itself). */
export interface ScopedNode {
    node: StampNode;
    ancestors: StampNode[];
}

/** Scope index returned by {@link buildScopes}. `scopeOf` misses nodes the walk never entered. */
export interface ScopeIndex {
    scopeOf: (node: StampNode) => Scope | null;
    functions: ScopedNode[];
    classes: ScopedNode[];
}

/**
 * Build scopes and collect every function and class with the ancestors above it (not including itself).
 *
 * @param {StampNode} program oxc `Program`. A node without `type` stops that branch.
 * @returns {ScopeIndex} Scope lookup plus the functions and classes that were entered.
 */
export function buildScopes(program: StampNode): ScopeIndex {
    const scopeOf = new Map<StampNode, Scope>();
    const functions: ScopedNode[] = [];
    const classes: ScopedNode[] = [];
    const ancestors: StampNode[] = [];
    const root = makeScope(null, 'program');

    function visit(node: StampNode | null | undefined, scope: Scope) {
        if (!node || typeof node !== 'object' || typeof node.type !== 'string')
            return;
        scopeOf.set(node, scope);
        if (isFunction(node))
            functions.push({ node, ancestors: ancestors.slice() });
        if (isClass(node))
            classes.push({ node, ancestors: ancestors.slice() });
        bindName(scope, node);

        let next = scope;
        if (isFunction(node)) {
            next = makeScope(scope, 'function');
            bindParams(next, node.params);
            if (node.id?.type === 'Identifier' && node.type !== 'FunctionDeclaration' && !next.bindings.has(node.id.name))
                next.bindings.set(node.id.name, { kind: 'function', id: node.id, scope: next });
        }
        else if (isBlockScope(node)) {
            next = makeScope(scope, 'block');
            if (node.type === 'CatchClause' && node.param)
                bindPattern(next, node.param, 'param');
        }
        if (node.type === 'VariableDeclaration') {
            const target = node.kind === 'var' ? nearestFunction(next) : next;
            for (const declarator of node.declarations ?? [])
                bindPattern(target, declarator.id, 'lexical', declarator);
        }
        if (node.type === 'AssignmentExpression' && node.left?.type === 'Identifier')
            next.assigns.push({ name: node.left.name, right: node.right });

        ancestors.push(node);
        for (const key of Object.keys(node)) {
            if (SKIP_KEYS.has(key))
                continue;
            // StampNode has no string index; the key is a child slot or a scalar the next visit ignores.
            const child = node[key as keyof typeof node];
            if (Array.isArray(child)) {
                for (const item of child)
                    visit(item, next);
            }
            else
                visit(child as StampNode, next);
        }
        ancestors.pop();
    }

    visit(program, root);
    return {
        scopeOf(node: StampNode) {
            return scopeOf.get(node) ?? null;
        },
        functions,
        classes,
    };
}

/**
 * Follow `name` from `scope` outward.
 *
 * @param {Scope | null} scope Scope of the expression being resolved.
 * @param {string | undefined} name Identifier name. `undefined` is never a root.
 * @returns {Binding | null}
 */
export function lookupBinding(scope: Scope | null, name: string | undefined): Binding | null {
    let current = scope;
    while (current) {
        const found = current.bindings.get(name);
        if (found)
            return found;
        current = current.parent;
    }
    return null;
}

/**
 * Right-hand side of the only `name = …` assignment inside the binding's scope.
 * Nested scopes that rebind `name` are not searched. Zero or many assignments return null.
 *
 * @param {Binding} binding A `let`/`var` with no initializer.
 * @returns {StampNode | null | undefined} The assignment's `right` node, or null.
 */
export function singleAssignRight(binding: Binding): StampNode | null | undefined {
    const found: Array<StampNode | null | undefined> = [];
    collectAssigns(binding.scope, binding.id.name, binding.id.start, found);
    return found.length === 1 ? found[0] : null;
}

/**
 * @param {StampNode | null | undefined} node AST node.
 * @returns {boolean} Function declaration, expression, or arrow.
 */
export function isFunction(node: StampNode | null | undefined): boolean {
    return node?.type === 'FunctionDeclaration'
        || node?.type === 'FunctionExpression'
        || node?.type === 'ArrowFunctionExpression';
}

/**
 * @param {StampNode | null | undefined} node AST node.
 * @returns {boolean} Class declaration or expression.
 */
export function isClass(node: StampNode | null | undefined): boolean {
    return node?.type === 'ClassDeclaration' || node?.type === 'ClassExpression';
}

/**
 * @param {StampNode | null | undefined} node AST node.
 * @returns {boolean} Object method (`{ Foo() {} }`), the boundary owner-name walks stop at.
 */
export function isObjectMethod(node: StampNode | null | undefined): boolean {
    return node?.type === 'Property' && node.method === true;
}


