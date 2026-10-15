/**
 * Server side of the component-state attachment: bound the page's payload, locate the component in source, name React
 * hook slots, and render the prompt block.
 *
 * Boundary: the payload is attacker-controlled JSON. Every value is re-bounded with the shared `snapshotValue`, every
 * label is capped and collapsed to one line, and a file is read only after `assertPathInsideRoot` accepts it. Failures to
 * locate or name never fail the send; they only leave locations out or keys as `#<slot>`. The prompt text is English.
 */
import fs from 'node:fs';
import path from 'node:path';
import { snapshotValue, type StateValue } from '../shared/state-value.js';
import { findComponentHooks, nameStateSlots } from './ast/hook-names.js';
import { parseInspPath } from './insp-path.js';
import { formatRefPath } from './prompt-paths.js';
import { assertPathInsideRoot, isInsideRoot } from './security.js';

/** Most props or state entries kept per reading. */
const MAX_ENTRIES = 40;
/** Most changes kept from one watch. */
const MAX_CHANGES = 300;
/** Most stamp candidates tried when locating a React component. */
const MAX_CANDIDATES = 6;
/** Longest component name or entry key kept, in characters. */
const MAX_NAME = 80;
/** Longest change path kept, in characters. */
const MAX_PATH = 200;
/** Longest rendered value kept in the prompt, in characters. */
const MAX_VALUE_TEXT = 300;
/** Script files a React component can live in. */
const SCRIPT_FILE = /\.(?:[cm]?jsx?|tsx?)$/;
/** Control characters and Unicode line separators, collapsed so an untrusted string cannot forge prompt lines. */
// eslint-disable-next-line no-control-regex -- deliberate: sanitizes control characters out of untrusted values.
const CONTROL_CHARS = /[\u0000-\u001f\u007f\u2028\u2029]+/g;

/** One bounded reading. */
type Reading = { props: Record<string, StateValue>; state: Record<string, StateValue> };
/** One bounded change. */
type Change = { t: number; path: string; from: StateValue; to: StateValue };

/** Component state after normalization and source lookup; consumed by {@link buildComponentStateLines}. */
export type ResolvedComponentState = {
    framework: 'react' | 'vue';
    name: string;
    hookState: boolean;
    usage: { file: string; line: number } | null;
    definition: { file: string; startLine?: number; endLine?: number } | null;
    slotNames: Record<string, string> | null;
    snapshot: Reading | null;
    watch: { durationMs: number; initial: Reading; changes: Change[]; dropped: number; unmountedAt: number | null } | null;
};

/**
 * Collapse control characters and cap length.
 * @param {unknown} value Untrusted value; non-strings become `''`.
 * @param {number} max Character cap.
 * @returns {string} Single-line string.
 */
function clean(value: unknown, max: number): string {
    return typeof value === 'string' ? value.replace(CONTROL_CHARS, ' ').slice(0, max) : '';
}

/**
 * Non-negative finite number, or a fallback.
 * @param {unknown} value Untrusted value.
 * @param {number} fallback Returned for anything else.
 * @returns {number} The number, rounded.
 */
function count(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}

/**
 * Bound one `{ key: value }` map from the page.
 * @param {unknown} raw Untrusted object.
 * @returns {Record<string, StateValue>} Up to {@link MAX_ENTRIES} entries, values re-bounded.
 */
function normalizeEntries(raw: unknown): Record<string, StateValue> {
    const out: Record<string, StateValue> = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return out;
    for (const key of Object.keys(raw).slice(0, MAX_ENTRIES))
        out[clean(key, MAX_NAME)] = snapshotValue((raw as Record<string, unknown>)[key], 1);
    return out;
}

/**
 * Bound one reading.
 * @param {unknown} raw Untrusted `{ props, state }`.
 * @returns {Reading | null} Reading, or `null` when `raw` is not an object.
 */
function normalizeReading(raw: unknown): Reading | null {
    if (!raw || typeof raw !== 'object')
        return null;
    const reading = raw as { props?: unknown; state?: unknown };
    return { props: normalizeEntries(reading.props), state: normalizeEntries(reading.state) };
}

/**
 * Bound a watch result.
 * @param {unknown} raw Untrusted watch object.
 * @returns {ResolvedComponentState['watch']} Watch, or `null` without a usable initial reading.
 */
function normalizeWatch(raw: unknown): ResolvedComponentState['watch'] {
    const watch = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    const initial = normalizeReading(watch?.initial);
    if (!watch || !initial)
        return null;
    const rawChanges = Array.isArray(watch.changes) ? watch.changes : [];
    const changes = rawChanges.slice(0, MAX_CHANGES).flatMap((item: unknown) => {
        const change = item && typeof item === 'object' ? item as Record<string, unknown> : null;
        const changePath = clean(change?.path, MAX_PATH);
        return change && changePath ? [{ t: count(change.t), path: changePath, from: snapshotValue(change.from, 1), to: snapshotValue(change.to, 1) }] : [];
    });
    return {
        durationMs: count(watch.durationMs),
        initial,
        changes,
        dropped: count(watch.dropped) + Math.max(0, rawChanges.length - MAX_CHANGES),
        unmountedAt: watch.unmountedAt == null ? null : count(watch.unmountedAt),
    };
}

/**
 * Where a `data-insp-path` points, if it is inside the project.
 * @param {unknown} raw Untrusted stamp.
 * @param {string} projectRoot Absolute project root.
 * @returns {{ file: string, line: number } | null} Absolute file and line, or `null`.
 */
function stampLocation(raw: unknown, projectRoot: string): { file: string; line: number } | null {
    try {
        const parsed = parseInspPath(raw);
        return { file: assertPathInsideRoot(parsed.file, projectRoot), line: parsed.line };
    }
    catch {
        return null;
    }
}

/**
 * Read a source file that already passed `assertPathInsideRoot`.
 * @param {string} file Absolute path inside the project.
 * @returns {string | null} Contents, or `null` when it cannot be read.
 */
function readSource(file: string): string | null {
    try {
        return fs.readFileSync(file, 'utf8');
    }
    catch {
        return null;
    }
}

/**
 * Locate a React component from stamps written in its render, and name its state slots.
 *
 * @param {unknown} candidates Untrusted stamp list.
 * @param {string} name Component name from the page.
 * @param {string[]} slotKeys `#<slot>` keys seen in the readings.
 * @param {string} projectRoot Absolute project root.
 * @returns {{ definition: ResolvedComponentState['definition'], slotNames: Record<string, string> | null }} What was found.
 */
function locateReactComponent(candidates: unknown, name: string, slotKeys: string[], projectRoot: string) {
    const list = Array.isArray(candidates) ? candidates.slice(0, MAX_CANDIDATES) : [];
    for (const candidate of list) {
        const location = stampLocation(candidate, projectRoot);
        if (!location || !SCRIPT_FILE.test(location.file))
            continue;
        const code = readSource(location.file);
        const found = code === null ? null : findComponentHooks(code, location.file, location.line, name);
        if (!found)
            continue;
        const names = nameStateSlots(found.hooks, slotKeys);
        return {
            definition: { file: location.file, startLine: found.startLine, endLine: found.endLine },
            slotNames: names ? Object.fromEntries(names) : null,
        };
    }
    return { definition: null, slotNames: null };
}

/**
 * Normalize the page's `componentState` payload and resolve its source locations.
 *
 * @param {unknown} raw Untrusted `payload.componentState`.
 * @param {string} projectRoot Absolute project root; only files inside it are read or referenced.
 * @returns {ResolvedComponentState | null} Resolved state, or `null` when nothing usable was attached.
 */
export function resolveComponentState(raw: unknown, projectRoot: string): ResolvedComponentState | null {
    const payload = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    const component = payload?.component && typeof payload.component === 'object' ? payload.component as Record<string, unknown> : null;
    const snapshot = normalizeReading(payload?.snapshot);
    const watch = normalizeWatch(payload?.watch);
    if (!component || (!snapshot && !watch))
        return null;
    const framework = component.framework === 'vue' ? 'vue' : 'react';
    const name = clean(component.name, MAX_NAME);
    const hookState = framework === 'react' && component.hookState === true;
    const slotKeys = [...new Set([...Object.keys(snapshot?.state ?? {}), ...Object.keys(watch?.initial.state ?? {})])].filter((key) => /^#\d+$/.test(key));
    const vueFile = typeof component.definitionFile === 'string' ? path.resolve(projectRoot, component.definitionFile) : '';
    const located = framework === 'react'
        ? locateReactComponent(component.stampCandidates, name, hookState ? slotKeys : [], projectRoot)
        : { definition: vueFile && isInsideRoot(vueFile, projectRoot) ? { file: vueFile } : null, slotNames: null };
    return {
        framework,
        name,
        hookState,
        usage: stampLocation(component.usagePath, projectRoot),
        definition: located.definition,
        slotNames: hookState ? located.slotNames : null,
        snapshot,
        watch,
    };
}

/**
 * One value as prompt text: compact JSON, capped.
 * @param {StateValue} value Bounded value.
 * @returns {string} Text.
 */
function valueText(value: StateValue): string {
    const text = (JSON.stringify(value) ?? 'null').replace(CONTROL_CHARS, ' ');
    return text.length > MAX_VALUE_TEXT ? `${text.slice(0, MAX_VALUE_TEXT)}…` : text;
}

/**
 * Rewrite a `state.#3…` path to `state.left…` when slot 3 has a name.
 * @param {string} at Change or entry path.
 * @param {Record<string, string> | null} names Slot names.
 * @returns {string} Path with the slot named, or unchanged.
 */
function namedPath(at: string, names: Record<string, string> | null): string {
    const match = /^state\.(#\d+)(.*)$/.exec(at);
    return match && names?.[match[1]] ? `state.${names[match[1]]}${match[2]}` : at;
}

/**
 * Lines listing one reading as `props.x = …` / `state.y = …`.
 * @param {Reading} reading Bounded reading.
 * @param {Record<string, string> | null} names Slot names.
 * @returns {string[]} Indented lines.
 */
function readingLines(reading: Reading, names: Record<string, string> | null): string[] {
    const lines = [
        ...Object.entries(reading.props).map(([key, value]) => `  props.${key} = ${valueText(value)}`),
        ...Object.entries(reading.state).map(([key, value]) => `  ${namedPath(`state.${key}`, names)} = ${valueText(value)}`),
    ];
    return lines.length ? lines : ['  (no props or state)'];
}

/**
 * Build the component-state prompt block.
 *
 * Boundary: returns `[]` when the request carries no component state, so prompts without it are unchanged. Unnamed
 * React slots get one explanatory line so the agent can match them to the hook calls itself.
 *
 * @param {{ componentState?: ResolvedComponentState | null, projectRoot?: string }} request Normalized request.
 * @param {'relative' | 'absolute'} [pathStyle='relative'] How source paths are shown.
 * @returns {string[]} Prompt lines.
 */
export function buildComponentStateLines(request: { componentState?: ResolvedComponentState | null; projectRoot?: string }, pathStyle: 'relative' | 'absolute' = 'relative'): string[] {
    const state = request.componentState;
    if (!state)
        return [];
    const names = state.slotNames;
    const where = [
        state.definition ? `defined at @${formatRefPath(state.definition.file, request.projectRoot, pathStyle)}${state.definition.startLine ? ` #${state.definition.startLine}-${state.definition.endLine}` : ''}` : '',
        state.usage ? `used at @${formatRefPath(state.usage.file, request.projectRoot, pathStyle)} #${state.usage.line}` : '',
    ].filter(Boolean).join(', ');
    const lines = [`Component: ${state.name || 'Anonymous'} (${state.framework === 'vue' ? 'Vue' : 'React'})${where ? ` — ${where}` : ''}`];
    if (state.hookState && !names && [state.snapshot, state.watch?.initial].some((reading) => reading && Object.keys(reading.state).length))
        lines.push('(state.#n are React hook state slots in call order; their variable names could not be matched)');
    if (state.snapshot)
        lines.push('State at send time:', ...readingLines(state.snapshot, names));
    if (state.watch) {
        const { watch } = state;
        const total = watch.changes.length + watch.dropped;
        lines.push(`Watched for ${(watch.durationMs / 1000).toFixed(1)}s, starting from:`, ...readingLines(watch.initial, names));
        lines.push(`Changes while watching (${total}${watch.dropped ? `, first ${watch.changes.length} shown` : ''}):`);
        for (const change of watch.changes)
            lines.push(`  +${(change.t / 1000).toFixed(1)}s ${namedPath(change.path, names)}: ${valueText(change.from)} → ${valueText(change.to)}`);
        if (watch.unmountedAt != null)
            lines.push(`  +${(watch.unmountedAt / 1000).toFixed(1)}s component unmounted`);
        if (!total && watch.unmountedAt == null)
            lines.push('  (none)');
    }
    return lines;
}
