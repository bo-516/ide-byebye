/**
 * Binding records for the JSX scope walk.
 *
 * Purpose: keep pattern binding and assignment search out of the walk so each file stays small.
 * `var` is attached to the nearest function scope; other declarators stay on the scope the walk
 * passes in. The first binding of a name wins, matching a single Babel binding.
 *
 * Boundary: mutates the scope objects created by `buildScopes`. Not used on its own.
 */

import type { StampNode } from './stamp-edits.js';

/**
 * One name bound in a scope.
 *
 * Boundary: `kind` is a string because parameter binding passes the caller's `kind` through.
 * `id` is the identifier node (`start` / `name`). `declarator` is set only for lexical bindings.
 */
export interface Binding {
    kind: string;
    id: StampNode;
    declarator?: StampNode;
    scope: Scope;
}

/**
 * Scope chain node. `assigns` records `x = …` writes seen in this scope.
 *
 * Boundary: `bindings` keys are identifier names. A missing name is looked up as `undefined`
 * and matches nothing that was stored under a string.
 */
export interface Scope {
    parent: Scope | null;
    kind: 'program' | 'function' | 'block';
    bindings: Map<string | undefined, Binding>;
    assigns: Array<{ name: string | undefined, right: StampNode | null | undefined }>;
    children: Scope[];
}

/**
 * @param {Scope | null} parent Parent scope, or null for the program.
 * @param {'program' | 'function' | 'block'} kind Which declarations this scope owns.
 * @returns {Scope} Empty scope linked onto `parent.children`.
 */
export function makeScope(parent: Scope | null, kind: 'program' | 'function' | 'block'): Scope {
    const scope = { parent, kind, bindings: new Map(), assigns: [], children: [] };
    parent?.children.push(scope);
    return scope;
}

/**
 * Bind a function, class, or import name on the scope that contains the statement.
 *
 * @param {Scope} scope Scope the statement lives in.
 * @param {StampNode} node Declaration node.
 */
export function bindName(scope: Scope, node: StampNode) {
    if (node.type === 'FunctionDeclaration' && node.id?.type === 'Identifier')
        define(scope, node.id, { kind: 'function', id: node.id, scope });
    else if (node.type === 'ClassDeclaration' && node.id?.type === 'Identifier')
        define(scope, node.id, { kind: 'class', id: node.id, scope });
    else if (node.type === 'ImportDeclaration') {
        for (const spec of node.specifiers ?? []) {
            if (spec.local?.type === 'Identifier')
                define(scope, spec.local, { kind: 'import', id: spec.local, scope });
        }
    }
}

/**
 * @param {Scope} scope Function scope that owns the parameters.
 * @param {Array<StampNode | null | undefined> | null | undefined} params Parameter patterns. Missing list is ignored.
 */
export function bindParams(scope: Scope, params: Array<StampNode | null | undefined> | null | undefined) {
    for (const param of params ?? [])
        bindPattern(scope, param, 'param');
}

/**
 * Record every identifier in a pattern. Object and array patterns keep the same declarator
 * so `const { a } = obj` can follow `obj` the way Babel does.
 *
 * @param {Scope} scope Scope that owns the names.
 * @param {StampNode | null | undefined} pattern Binding pattern. Null is ignored.
 * @param {string} kind `lexical` for variables, `param` for parameters.
 * @param {StampNode} [declarator] VariableDeclarator when `kind` is `lexical`.
 */
export function bindPattern(scope: Scope, pattern: StampNode | null | undefined, kind: string, declarator?: StampNode) {
    if (!pattern)
        return;
    if (pattern.type === 'Identifier') {
        define(scope, pattern, { kind, id: pattern, declarator, scope });
        return;
    }
    if (pattern.type === 'AssignmentPattern' || pattern.type === 'RestElement') {
        bindPattern(scope, pattern.left ?? pattern.argument, kind, declarator);
        return;
    }
    if (pattern.type === 'ObjectPattern') {
        for (const prop of pattern.properties ?? [])
            bindPattern(scope, prop.type === 'RestElement' ? prop.argument : prop.value as StampNode | null, kind, declarator);
        return;
    }
    if (pattern.type === 'ArrayPattern') {
        for (const element of pattern.elements ?? [])
            bindPattern(scope, element, kind, declarator);
    }
}

/**
 * Assignments to `name` inside `scope`, skipping nested scopes that declare their own `name`.
 *
 * @param {Scope} scope Binding's scope.
 * @param {string | undefined} name Identifier. `undefined` matches no stored assignment name.
 * @param {number | undefined} start Binding identifier start, so the binding's own scope is not treated as a shadow.
 * @param {Array<StampNode | null | undefined>} found Right-hand sides appended here.
 */
export function collectAssigns(scope: Scope, name: string | undefined, start: number | undefined, found: Array<StampNode | null | undefined>) {
    for (const assignment of scope.assigns) {
        if (assignment.name === name)
            found.push(assignment.right);
    }
    for (const child of scope.children) {
        const shadow = child.bindings.get(name);
        if (shadow && shadow.id.start !== start)
            continue;
        collectAssigns(child, name, start, found);
    }
}

/**
 * Function or program scope that owns `var` declarations made in `scope`.
 *
 * @param {Scope} scope Scope where the `var` statement was seen.
 * @returns {Scope} Nearest function or program scope.
 */
export function nearestFunction(scope: Scope): Scope {
    let current: Scope | null = scope;
    while (current && current.kind !== 'function' && current.kind !== 'program')
        current = current.parent;
    return current ?? scope;
}

/**
 * @param {StampNode} node AST node.
 * @returns {boolean} True for blocks, for/switch, catch, and static blocks — the scopes `let` binds in.
 */
export function isBlockScope(node: StampNode): boolean {
    return node.type === 'BlockStatement' || node.type === 'StaticBlock' || node.type === 'CatchClause'
        || node.type === 'SwitchStatement' || node.type === 'ForStatement'
        || node.type === 'ForInStatement' || node.type === 'ForOfStatement';
}

function define(scope: Scope, id: StampNode | null | undefined, binding: Binding) {
    if (id?.name && !scope.bindings.has(id.name))
        scope.bindings.set(id.name, binding);
}
