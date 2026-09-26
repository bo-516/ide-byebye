/**
 * Resolve `sourceStamp` and the deprecated `codeInspector` option.
 *
 * Purpose: stamping is on unless `sourceStamp: false` or the legacy `close: true`. Legacy
 * `include`, `exclude`, and `escapeTags` map onto the new option; every other key is named in
 * one deprecation warning. An explicit `sourceStamp` object wins over the legacy mapping.
 *
 * Boundary: does not stamp. `warn` is called at most once per process for the deprecation.
 * A pattern that is neither a string nor a RegExp is kept and rejected later by the dispatcher
 * so a bad option fails open instead of throwing out of plugin setup.
 */

import type { EscapeTag, IdeByebyeOptions, SourceStampOptions } from '../../types.js';

const MAPPED = new Set(['include', 'exclude', 'escapeTags', 'close']);
let deprecatedWarned = false;

export interface ResolvedStampOptions {
    enabled: boolean;
    include: Array<string | RegExp>;
    exclude: Array<string | RegExp>;
    escapeTags: EscapeTag[];
}

/**
 * Normalize plugin options into the stamp switch.
 *
 * @param {IdeByebyeOptions | undefined} options Raw plugin options. Omit for the defaults (stamping on).
 * @param {(message: string) => void} warn Receives the deprecation warning. Called once per process.
 * @returns {ResolvedStampOptions} `enabled: false` means the transform must return the original source and not warn.
 */
export function resolveStampOptions(options: IdeByebyeOptions | undefined, warn: (message: string) => void): ResolvedStampOptions {
    const stamp = options?.sourceStamp;
    const legacy = options?.codeInspector;
    let enabled = stamp !== false;
    let include = [] as Array<string | RegExp>;
    let exclude = [] as Array<string | RegExp>;
    let escapeTags: EscapeTag[] = [];
    if (legacy && typeof legacy === 'object') {
        const mapped = [];
        if ('include' in legacy) {
            include = asList(legacy.include);
            mapped.push('include');
        }
        if ('exclude' in legacy) {
            exclude = asList(legacy.exclude);
            mapped.push('exclude');
        }
        if ('escapeTags' in legacy) {
            escapeTags = asList(legacy.escapeTags) as EscapeTag[];
            mapped.push('escapeTags');
        }
        if (legacy.close === true) {
            enabled = false;
            mapped.push('close');
        }
        const ignored = Object.keys(legacy).filter((key) => !MAPPED.has(key));
        if (!deprecatedWarned) {
            deprecatedWarned = true;
            const mappedText = mapped.length ? mapped.join(', ') : 'none';
            const ignoredText = ignored.length ? ` Ignored: ${ignored.join(', ')}.` : '';
            warn(`[code-intent-inspector] "codeInspector" is deprecated. Mapped to sourceStamp: ${mappedText}.${ignoredText}`);
        }
    }
    if (stamp && typeof stamp === 'object') {
        const body = stamp as SourceStampOptions;
        if (body.include != null)
            include = asList(body.include);
        if (body.exclude != null)
            exclude = asList(body.exclude);
        if (body.escapeTags != null)
            escapeTags = body.escapeTags;
        enabled = true;
    }
    if (stamp === false)
        enabled = false;
    return { enabled, include, exclude, escapeTags };
}

/**
 * Allow the deprecation warning to fire again. Tests call this; production does not.
 *
 * @returns {void}
 */
export function resetStampOptionWarnings(): void {
    deprecatedWarned = false;
}

function asList(value): Array<string | RegExp> {
    if (value == null)
        return [];
    return Array.isArray(value) ? value : [value];
}

/**
 * JSON form of resolved stamp options for the Next loader. RegExp becomes `{ source, flags }`.
 *
 * @param {IdeByebyeOptions | undefined} options Plugin options. Triggers the deprecation warning when `codeInspector` is set.
 * @returns {object} A value that survives `JSON.parse(JSON.stringify(...))`.
 */
export function serializeStampOptions(options: IdeByebyeOptions | undefined) {
    const resolved = resolveStampOptions(options, (message) => console.warn(message));
    return {
        enabled: resolved.enabled,
        include: serializeList(resolved.include),
        exclude: serializeList(resolved.exclude),
        escapeTags: serializeList(resolved.escapeTags),
    };
}

/**
 * Restore loader options, including RegExps that were serialized as `{ source, flags }`.
 *
 * @param {object} raw Options object from `this.getOptions()`. A missing object means stamping on with no filters.
 * @returns {ResolvedStampOptions}
 */
export function reviveStampOptions(raw): ResolvedStampOptions {
    return {
        enabled: raw?.enabled !== false,
        include: reviveList(raw?.include),
        exclude: reviveList(raw?.exclude),
        escapeTags: reviveList(raw?.escapeTags),
    };
}

function serializeList(list) {
    return (list ?? []).map((item) => item instanceof RegExp ? { source: item.source, flags: item.flags } : item);
}

function reviveList(list) {
    return (list ?? []).map((item) => (item && typeof item === 'object' && typeof item.source === 'string')
        ? new RegExp(item.source, item.flags || '')
        : item);
}
