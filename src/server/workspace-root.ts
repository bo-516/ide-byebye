import fs from 'node:fs';
import path from 'node:path';

/**
 * Workspace file suffix stripped when deriving a display/routing name from a path.
 *
 * Boundary: only the name is adjusted; filesystem paths are never rewritten by this constant.
 *
 * @type {string}
 */
export const WORKSPACE_FILE_SUFFIX = '.code-workspace';

/**
 * Walk upward from `startDir` to the filesystem root and return the nearest directory that contains a `.git`
 * entry (directory or worktree file).
 *
 * Purpose: default agent workspace routing should match the repo the developer has open (e.g. Cursor window
 * named after the git root), not a nested package folder such as `demo/vue`.
 *
 * Boundary: `startDir` is resolved to an absolute path first. Permission errors on intermediate directories are
 * skipped so a single unreadable parent does not abort the walk. Returns `null` when no `.git` is found.
 *
 * @param {string} startDir Directory to start from (usually the bundler project root / run directory).
 * @returns {string | null} Absolute path of the nearest git root, or `null` when none exists.
 */
export function findNearestGitRoot(startDir) {
    let current = path.resolve(startDir);
    const { root } = path.parse(current);

    while (true) {
        const gitEntry = path.join(current, '.git');
        try {
            if (fs.existsSync(gitEntry)) {
                return current;
            }
        }
        catch {
            // Permission / transient FS errors: keep walking toward root.
        }

        if (current === root) {
            break;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }

    return null;
}

/**
 * Resolve the default workspace directory for agent routing.
 *
 * Purpose: prefer the nearest git repository above the run directory; fall back to the run directory itself
 * when the tree is not under git (zip downloads, scratch folders).
 *
 * Boundary: always returns an absolute path. Does not open or validate the directory beyond the `.git` probe.
 *
 * @param {string} runDir Bundler / process run directory (Vite `config.root`, webpack `compiler.context`, cwd).
 * @returns {string} Absolute workspace directory.
 */
export function resolveDefaultWorkspaceDir(runDir) {
    const start = path.resolve(runDir);
    return findNearestGitRoot(start) ?? start;
}

/**
 * Derive a workspace **name** (not a path) from a directory for deeplink routing.
 *
 * Boundary: Cursor's prompt deeplink matches on the window/workspace display name. `.code-workspace` file basenames
 * are stripped to the stem Cursor typically shows.
 *
 * @param {string} dir Absolute or relative directory path.
 * @returns {string} Workspace name for routing.
 */
export function workspaceNameFromDir(dir) {
    const basename = path.basename(path.resolve(dir));
    return basename.endsWith(WORKSPACE_FILE_SUFFIX)
        ? basename.slice(0, -WORKSPACE_FILE_SUFFIX.length)
        : basename;
}

/**
 * Resolve the default workspace **name** from the run directory (nearest git root basename, else run-dir basename).
 *
 * @param {string} runDir Bundler / process run directory.
 * @returns {string} Workspace name suitable for Cursor `workspace=` routing.
 */
export function resolveDefaultWorkspaceName(runDir) {
    return workspaceNameFromDir(resolveDefaultWorkspaceDir(runDir));
}
