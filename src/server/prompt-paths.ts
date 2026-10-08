import fs from 'node:fs';
import path from 'node:path';

/**
 * Path formatting for prompt references.
 *
 * Purpose: one place that turns a validated file path into the text after `@` (and into the plain paths of the
 * portal render-chain line), so every prompt line formats paths the same way.
 * Boundary: formatting only. Callers pass paths already checked against the project root; nothing here reads files
 * except `realpath` lookups that tolerate missing paths.
 */

/**
 * Convert an absolute project file path into a POSIX-style path relative to the project root.
 *
 * Boundary: files outside `projectRoot` fall back to their original path because this helper formats references only;
 * path trust is enforced earlier by source and screenshot writers. Passing a wrong root keeps absolute paths in prompts.
 *
 * @param {string | undefined} filePath Absolute or relative file path to reference. Missing paths are passed through to `path`.
 * @param {string | undefined} projectRoot Project root that should be stripped from in-repo paths. Missing roots are passed through to `path`.
 * @returns {string} Project-relative POSIX path, or the original path when it is outside the root.
 */
function repoRelativePath(filePath: string | undefined, projectRoot: string | undefined) {
    // Realpath both sides so a session cwd that went through /private/var still strips a /var/folders source path.
    const root = canonical(projectRoot);
    const file = canonical(filePath);
    const rel = path.relative(root, file);
    const value: string = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : filePath!;
    // `filePath` may be omitted; `path` still receives a string at runtime when a chip is rendered.
    return value.split(path.sep).join('/');
}

/**
 * Best-effort canonical path. Missing fixture paths stay resolved so unit tests that use fake directories keep working.
 *
 * @param {string | undefined} input File or directory path. `path.resolve` still requires a string, so a missing value is asserted.
 * @returns {string} Realpath when the path exists, otherwise `path.resolve`.
 */
function canonical(input: string | undefined) {
    const resolved = path.resolve(input as string);
    try {
        return fs.realpathSync.native(resolved);
    }
    catch {
        return resolved;
    }
}

/**
 * Format a filesystem path as a POSIX absolute path for prompt `@` references.
 *
 * Boundary: always `path.resolve`s first. Relative inputs resolve against the Node process cwd — callers should pass
 * absolute paths from screenshot / source writers. Prefer rewriting `request.projectRoot` to the agent cwd (Grok Build
 * does this via `withGrokBuildPathRoot`) so relative `@` refs stay short; absolute is only for files outside that root.
 *
 * @param {string | undefined} filePath Absolute or relative filesystem path. A missing path is asserted for `path.resolve`.
 * @returns {string} Absolute POSIX path (forward slashes).
 */
function absolutePosixPath(filePath: string | undefined) {
    return path.resolve(filePath as string).split(path.sep).join('/');
}

/**
 * Format a path for a prompt `@` reference.
 *
 * Boundary: `absolute` always wins with a resolved path. `relative` strips `projectRoot` when the file is inside it;
 * outside paths stay absolute so callers still get a usable reference.
 *
 * @param {string | undefined} filePath Absolute or relative filesystem path.
 * @param {string | undefined} projectRoot Project root used when `pathStyle` is `relative`.
 * @param {'relative' | 'absolute'} pathStyle How to present the path in the prompt.
 * @returns {string} Path text after `@` (no leading `@`).
 */
export function formatRefPath(filePath: string | undefined, projectRoot: string | undefined, pathStyle: 'relative' | 'absolute') {
    if (pathStyle === 'absolute')
        return absolutePosixPath(filePath);
    return repoRelativePath(filePath, projectRoot);
}
