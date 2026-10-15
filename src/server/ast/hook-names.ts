/**
 * Find a React component's definition around a source line and name its state hook slots.
 *
 * Purpose: React keeps no names for hook state; the browser sends slots as `#<slot>`. The component's own source says
 * which variables they are (`const [left, setLeft] = useState(…)`), so the prompt can show `left: 1499`.
 * Boundary: pure string/AST work (no fs). Only top-level hook calls of the component body are read. Names are given only
 * when the mapping is certain: every top-level hook is a built-in whose slot behaviour is known and the number of state
 * calls equals the number of state slots the browser saw. Custom hooks (which add their own slots) or the other
 * dispatch-carrying built-ins make it ambiguous, and then nothing is named.
 */

import { parseSync } from 'oxc-parser';
import { walkAst } from './jsx-locator.js';
import { buildLineStartOffsets, lineColumnFromOffset } from './line-offsets.js';

/** Built-ins whose state slot the browser reports (a queue with `dispatch`), in call order. */
const STATE_HOOKS = new Set(['useState', 'useReducer']);
/** Built-ins that also carry a dispatch queue, so a slot count could not tell them from `useState`. */
const AMBIGUOUS_HOOKS = new Set(['useTransition', 'useOptimistic', 'useActionState', 'useFormState']);
/** Built-ins that add no state slot. */
const STATELESS_HOOKS = new Set([
    'useEffect', 'useLayoutEffect', 'useInsertionEffect', 'useMemo', 'useCallback', 'useRef', 'useContext', 'use',
    'useId', 'useDeferredValue', 'useSyncExternalStore', 'useImperativeHandle', 'useDebugValue', 'useEffectEvent',
]);
/** Hook naming convention: `use` followed by an upper-case letter (or `use` itself). */
const HOOK_NAME = /^use(?:[A-Z0-9]|$)/;
/** Function node types that can be components. */
const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

/** One top-level hook call in a component body. `binding` is the declared name (state variable for `useState`). */
export interface HookCall {
    hook: string;
    binding: string | null;
    line: number;
}

/** A component found around a line: its name, 1-based line range, and top-level hook calls in order. */
export interface ComponentHooks {
    name: string;
    startLine: number;
    endLine: number;
    hooks: HookCall[];
}

/** AST fields read here. Structural so oxc's node union need not be imported. */
interface Node {
    type: string;
    start: number;
    end: number;
    [key: string]: unknown;
}

/**
 * Name a function node gets from where it is written: its own id, the variable it is assigned to, or the variable
 * holding a `memo(…)` / `forwardRef(…)` call that wraps it.
 *
 * @param {Node} fn Function node.
 * @param {readonly Node[]} ancestors Parent chain from the program down to `fn`'s parent.
 * @returns {string} Name, or `''` for anonymous functions.
 */
function functionName(fn: Node, ancestors: readonly Node[]): string {
    const id = fn.id as { name?: unknown } | null | undefined;
    if (id && typeof id.name === 'string')
        return id.name;
    for (let i = ancestors.length - 1; i >= 0; i -= 1) {
        const node = ancestors[i];
        if (node.type === 'CallExpression')
            continue;
        if (node.type === 'VariableDeclarator') {
            const target = node.id as { type?: string; name?: unknown } | null;
            return target?.type === 'Identifier' && typeof target.name === 'string' ? target.name : '';
        }
        return '';
    }
    return '';
}

/**
 * Hook name of a call expression: `useX(…)` or `React.useX(…)`.
 *
 * @param {unknown} expr Expression node.
 * @returns {string | null} Hook name, or `null` when the expression is not a hook call.
 */
function hookNameOf(expr: unknown): string | null {
    const call = expr as { type?: string; callee?: { type?: string; name?: unknown; property?: { name?: unknown } } } | null;
    if (call?.type !== 'CallExpression' || !call.callee)
        return null;
    const name = call.callee.type === 'Identifier' ? call.callee.name : call.callee.type === 'MemberExpression' ? call.callee.property?.name : null;
    return typeof name === 'string' && HOOK_NAME.test(name) ? name : null;
}

/**
 * Declared name of a hook result: `x` for `const x = …`, the first element for `const [x, setX] = …`, `{…}` for an
 * object pattern.
 *
 * @param {unknown} id Declarator `id` node.
 * @returns {string | null} Binding text, or `null` when there is none.
 */
function bindingOf(id: unknown): string | null {
    const pattern = id as { type?: string; name?: unknown; elements?: Array<{ type?: string; name?: unknown } | null> } | null;
    if (pattern?.type === 'Identifier' && typeof pattern.name === 'string')
        return pattern.name;
    if (pattern?.type === 'ArrayPattern') {
        const first = pattern.elements?.[0];
        return first?.type === 'Identifier' && typeof first.name === 'string' ? first.name : null;
    }
    return pattern?.type === 'ObjectPattern' ? '{…}' : null;
}

/**
 * Top-level hook calls of a function body, in source order.
 *
 * @param {Node} fn Function node.
 * @param {(offset: number) => number} lineOf Offset → 1-based line.
 * @returns {HookCall[]} Hook calls (empty for expression-bodied arrows).
 */
function topLevelHooks(fn: Node, lineOf: (offset: number) => number): HookCall[] {
    const body = fn.body as { type?: string; body?: Node[] } | null;
    const calls: HookCall[] = [];
    if (body?.type !== 'BlockStatement' || !Array.isArray(body.body))
        return calls;
    for (const statement of body.body) {
        if (statement.type === 'ExpressionStatement') {
            const hook = hookNameOf(statement.expression);
            if (hook)
                calls.push({ hook, binding: null, line: lineOf(statement.start) });
            continue;
        }
        if (statement.type !== 'VariableDeclaration')
            continue;
        for (const declarator of (statement.declarations as Node[] | undefined) ?? []) {
            const hook = hookNameOf(declarator.init);
            if (hook)
                calls.push({ hook, binding: bindingOf(declarator.id), line: lineOf(declarator.start) });
        }
    }
    return calls;
}

/**
 * Find the innermost function named `componentName` whose body contains `line`, and list its top-level hooks.
 *
 * Boundary: an empty `componentName` (an anonymous component) or no matching function returns `null`: matching on
 * position alone would pick inline callbacks. `.ts` files parse as TypeScript, everything else as TSX; a parse that
 * recovers from errors still yields the functions it could read.
 *
 * @param {string} code Source text.
 * @param {string} file File name; only its extension is used.
 * @param {number} line 1-based line inside the component (a stamp written in its render).
 * @param {string} componentName Name the browser reported for the component. Empty returns `null`.
 * @returns {ComponentHooks | null} The component and its hooks, or `null`.
 */
export function findComponentHooks(code: string, file: string, line: number, componentName: string): ComponentHooks | null {
    if (!componentName)
        return null;
    const lineStarts = buildLineStartOffsets(code);
    const lineOf = (off: number) => lineColumnFromOffset(lineStarts, off).line;
    const isTs = file.endsWith('.ts');
    const parsed = parseSync(isTs ? 'source.ts' : 'source.tsx', code, { sourceType: 'module', lang: isTs ? 'ts' : 'tsx' });
    const matches: Array<{ fn: Node; name: string }> = [];
    walkAst(parsed.program, (node, ancestors) => {
        if (!FUNCTION_TYPES.has(node.type) || lineOf(node.start) > line || lineOf(node.end) < line)
            return;
        const name = functionName(node as unknown as Node, ancestors as unknown as readonly Node[]);
        if (name === componentName)
            matches.push({ fn: node as unknown as Node, name });
    });
    const found = matches.reduce<{ fn: Node; name: string } | null>((best, item) => (!best || item.fn.end - item.fn.start < best.fn.end - best.fn.start ? item : best), null);
    if (!found)
        return null;
    return { name: found.name, startLine: lineOf(found.fn.start), endLine: lineOf(found.fn.end), hooks: topLevelHooks(found.fn, lineOf) };
}

/**
 * Map `#<slot>` state keys to variable names when the mapping is certain.
 *
 * Boundary: the browser lists only dispatch-carrying slots, in slot order. They line up one-to-one with the
 * `useState`/`useReducer` calls only when no custom hook and no other dispatch-carrying built-in is called at the top
 * level; otherwise (or when counts differ, or a call has no simple binding) this returns `null` and keys stay `#n`.
 *
 * @param {HookCall[]} hooks Top-level hook calls from {@link findComponentHooks}.
 * @param {string[]} slotKeys `#<slot>` keys the browser reported.
 * @returns {Map<string, string> | null} Key → name, or `null` when ambiguous.
 */
export function nameStateSlots(hooks: HookCall[], slotKeys: string[]): Map<string, string> | null {
    const ambiguous = hooks.some((call) => AMBIGUOUS_HOOKS.has(call.hook) || (!STATE_HOOKS.has(call.hook) && !STATELESS_HOOKS.has(call.hook)));
    const stateCalls = hooks.filter((call) => STATE_HOOKS.has(call.hook));
    const ordered = [...slotKeys].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    if (ambiguous || stateCalls.length !== ordered.length || stateCalls.some((call) => !call.binding || call.binding === '{…}'))
        return null;
    return new Map(ordered.map((key, index) => [key, stateCalls[index].binding as string]));
}
