import fs from 'node:fs';
import path from 'node:path';
import { findNearestGitRoot } from '../workspace-root.js';

/**
 * Path implementation for scope checks.
 *
 * Boundary: tests pass `win32` on a macOS host so case-folding is covered without a Windows filesystem. Production
 * uses `process.platform`. Mixing the two (posix paths with `win32`) mis-classifies separators.
 *
 * @param {string} platform Node platform id.
 * @returns {path.PlatformPath} `path.win32` or `path.posix`.
 */
function pathApi(platform) {
    return platform === 'win32' ? path.win32 : path.posix;
}

/**
 * Resolve a path for comparison.
 *
 * Boundary: `realpathSync.native` collapses symlinks so a link into the repo matches the real root. When the path
 * does not exist (Grok `cwd-missing`) or realpath throws, `path.resolve` is used and the string can still be compared.
 * Page input must never be passed here — only server-derived cwd strings and config roots.
 *
 * @param {string} input Absolute or relative path.
 * @param {{ realpathSync?: { native?: Function } }} [io] Filesystem used for realpath. Defaults to `node:fs`.
 * @returns {string} Canonical absolute path, or a resolved absolute path when realpath fails.
 */
export function normalizeScopePath(input, io = fs) {
    const resolved = path.resolve(input);
    const realpath = io.realpathSync?.native ?? io.realpathSync;
    if (typeof realpath !== 'function')
        return resolved;
    try {
        return realpath(resolved);
    }
    catch {
        // A deleted session directory still has to line up with a realpath'd project root (/var vs /private/var).
        const exists = typeof io.existsSync === 'function' ? (candidate) => io.existsSync(candidate) : (candidate) => fs.existsSync(candidate);
        let cursor = resolved;
        const suffix = [];
        while (true) {
            const parent = path.dirname(cursor);
            if (parent === cursor)
                return resolved;
            suffix.unshift(path.basename(cursor));
            cursor = parent;
            try {
                if (exists(cursor))
                    return path.join(realpath(cursor), ...suffix);
            }
            catch {
                // That ancestor could not be canonicalized; try the next one up.
            }
        }
    }
}

/**
 * Relationship of `child` to `parent` after both have been normalized.
 *
 * Boundary: equality is its own result because security's `isInsideRoot` treats equality as outside, and session
 * scope must treat "same directory" as in scope. `win32` comparison is case-insensitive via `path.win32.relative`.
 *
 * @param {string} child Candidate path.
 * @param {string} parent Root path.
 * @param {string} platform Node platform id.
 * @returns {'equal' | 'inside' | 'outside'}
 */
function classify(child, parent, platform) {
    const api = pathApi(platform);
    const rel = api.relative(parent, child);
    if (rel === '')
        return 'equal';
    if (rel.startsWith('..') || api.isAbsolute(rel))
        return 'outside';
    return 'inside';
}

/**
 * Build the set of directories that count as "this project".
 *
 * Boundary: roots are `projectRoot`, the nearest git root (when one exists), and any agent `projectRoot` override.
 * Paths are realpath'd. A missing git root leaves `gitRoot` null, which disables the ancestor exception — a session
 * opened above the package is then out of scope. `opts.platform` / `opts.realpath` exist so tests can simulate win32
 * without touching the disk.
 *
 * @param {string} projectRoot Bundler / package root the inspector is serving.
 * @param {string[]} [extraRoots] Agent-configured project roots. Blank entries are ignored.
 * @param {{ platform?: string, realpath?: (input: string) => string, gitRoot?: string | null, io?: typeof fs }} [opts]
 *        Test hooks. Omit them in production.
 * @returns {{ projectRoot: string, gitRoot: string | null, roots: string[], platform: string }} Scope used by matchers.
 */
export function buildProjectScope(projectRoot, extraRoots = [], opts: any = {}) {
    const platform = opts.platform ?? process.platform;
    const realpath = opts.realpath ?? ((input) => normalizeScopePath(input, opts.io));
    const root = realpath(projectRoot);
    const discovered = opts.gitRoot === undefined ? findNearestGitRoot(root) : opts.gitRoot;
    const gitRoot = discovered ? realpath(discovered) : null;
    const extras = (Array.isArray(extraRoots) ? extraRoots : [])
        .filter((entry) => typeof entry === 'string' && entry.trim())
        .map((entry) => realpath(entry.trim()));
    const roots = [];
    for (const candidate of [root, gitRoot, ...extras]) {
        if (!candidate)
            continue;
        if (!roots.some((existing) => classify(candidate, existing, platform) === 'equal'))
            roots.push(candidate);
    }
    return { projectRoot: root, gitRoot, roots, platform };
}

/**
 * Whether a session cwd belongs to this project.
 *
 * Boundary: in scope when the cwd equals a root, is inside a root, or is an ancestor of `projectRoot` that is not
 * above the git root (a session opened at the repo root while the plugin runs in a package). Symlinks are realpath'd
 * first. An ancestor above the git root is out of scope. A wrong `platform` flips win32 case-folding.
 *
 * @param {string} cwd Session working directory from the agent store (not from the page).
 * @param {{ projectRoot: string, gitRoot: string | null, roots: string[], platform?: string }} scope Result of {@link buildProjectScope}.
 * @param {{ platform?: string, realpath?: (input: string) => string }} [opts] Test hooks.
 * @returns {boolean} True when the session may be listed.
 */
export function matchSessionCwd(cwd, scope, opts: any = {}) {
    if (!cwd || typeof cwd !== 'string' || !scope?.projectRoot)
        return false;
    const platform = opts.platform ?? scope.platform ?? process.platform;
    const realpath = opts.realpath ?? ((input) => normalizeScopePath(input));
    let resolved;
    try {
        resolved = realpath(cwd);
    }
    catch {
        return false;
    }
    for (const root of scope.roots ?? []) {
        const relation = classify(resolved, root, platform);
        if (relation === 'equal' || relation === 'inside')
            return true;
    }
    if (!scope.gitRoot)
        return false;
    const ancestor = classify(scope.projectRoot, resolved, platform) === 'inside';
    const notAboveGit = classify(resolved, scope.gitRoot, platform) !== 'outside';
    return ancestor && notAboveGit;
}

/**
 * `cwd` relative to the inspector project root, with `/` separators.
 *
 * Boundary: the same directory is `'.'`. Ancestors become `..` / `../..`, which the menu labels as the repo root.
 * The result is not an absolute path. A missing cwd returns `'.'`.
 *
 * @param {string} cwd Normalized session cwd.
 * @param {string} projectRoot Normalized inspector project root.
 * @param {string} [platform=process.platform] Platform whose `relative` should run.
 * @returns {string} Relative location, never empty.
 */
export function sessionLocation(cwd, projectRoot, platform = process.platform) {
    const rel = pathApi(platform).relative(projectRoot, cwd);
    if (!rel)
        return '.';
    return rel.split(pathApi(platform).sep).join('/');
}

/**
 * Directory basename shown when the session is not an ancestor of the project.
 *
 * @param {string} cwd Session cwd.
 * @param {string} [platform=process.platform] Platform whose basename rules apply.
 * @returns {string} Final path segment, or the cwd itself when it has none.
 */
export function sessionProjectName(cwd, platform = process.platform) {
    const base = pathApi(platform).basename(cwd);
    return base || cwd;
}
