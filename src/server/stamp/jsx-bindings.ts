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

const SKIP_KEYS = new Set([
    'typeAnnotation', 'returnType', 'typeParameters', 'typeArguments', 'decorators',
    'loc', 'range', 'start', 'end',
]);

interface Binding {
    kind: 'lexical' | 'param' | 'import' | 'function' | 'class';
    id: { start?: number, name?: string };
    declarator?: { init?: unknown };
    scope: Scope;
}

interface Scope {
    parent: Scope | null;
    kind: 'program' | 'function' | 'block';
    bindings: Map<string, Binding>;
    assigns: Array<{ name: string, right: unknown }>;
    children: Scope[];
}

export interface ScopedNode {
    node: { type: string, id?: { type?: string, name?: string }, params?: unknown[], body?: unknown, superClass?: unknown };
    ancestors: object[];
}

/**
 * Build scopes and collect every function and class with the ancestors above it (not including itself).
 *
 * @param {object} program oxc `Program`. A node without `type` stops that branch.
 * @returns {{ scopeOf: (node: object) => Scope | null, functions: ScopedNode[], classes: ScopedNode[] }}
 */
export function buildScopes(program) {
    const scopeOf = new Map<object, Scope>();
    const functions: ScopedNode[] = [];
    const classes: ScopedNode[] = [];
    const ancestors: object[] = [];
    const root = makeScope(null, 'program');

    function visit(node, scope: Scope) {
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
            const child = node[key];
            if (Array.isArray(child)) {
                for (const item of child)
                    visit(item, next);
            }
            else
                visit(child, next);
        }
        ancestors.pop();
    }

    visit(program, root);
    return {
        scopeOf(node) {
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
 * @param {string} name Identifier name. `undefined` is never a root.
 * @returns {Binding | null}
 */
export function lookupBinding(scope: Scope | null, name: string): Binding | null {
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
 * @returns {unknown} The assignment's `right` node, or null.
 */
export function singleAssignRight(binding: Binding) {
    const found = [];
    collectAssigns(binding.scope, binding.id.name, binding.id.start, found);
    return found.length === 1 ? found[0] : null;
}

/**
 * @param {object} node AST node.
 * @returns {boolean} Function declaration, expression, or arrow.
 */
export function isFunction(node): boolean {
    return node?.type === 'FunctionDeclaration'
        || node?.type === 'FunctionExpression'
        || node?.type === 'ArrowFunctionExpression';
}

/**
 * @param {object} node AST node.
 * @returns {boolean} Class declaration or expression.
 */
export function isClass(node): boolean {
    return node?.type === 'ClassDeclaration' || node?.type === 'ClassExpression';
}

/**
 * @param {object} node AST node.
 * @returns {boolean} Object method (`{ Foo() {} }`), the boundary owner-name walks stop at.
 */
export function isObjectMethod(node): boolean {
    return node?.type === 'Property' && node.method === true;
}


