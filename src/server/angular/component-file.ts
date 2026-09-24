import fs from 'node:fs';
import path from 'node:path';
import { assertPathInsideRoot, isInsideRoot } from '../security.js';

/**
 * Project roots declared in an Angular workspace's `angular.json` (`projects.*.root`).
 *
 * @param {string} workspaceRoot Absolute workspace directory.
 * @returns {string[]} Relative project roots (possibly empty); unreadable / invalid files yield `[]`.
 */
function angularProjectRoots(workspaceRoot: string) {
    try {
        const json = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'angular.json'), 'utf8'));
        return Object.values(json?.projects ?? {})
            .map((project: any) => project?.root)
            .filter((root) => typeof root === 'string' && root.length > 0);
    }
    catch {
        return [];
    }
}

/**
 * Resolve the component file Angular's `debugInfo.filePath` names.
 *
 * Purpose: Angular records the path relative to the compiling project's `tsconfig` directory — the workspace root for
 * single-project workspaces, `projects/<name>/` in multi-project ones. The workspace-relative candidate is tried first,
 * then each `angular.json` project root.
 *
 * Boundary: every candidate must pass the project-root guard; the first guarded candidate is returned when none exists
 * so the caller reports the usual "file not found". Page-supplied input, so no candidate may escape `projectRoot`.
 *
 * @param {string} file Path parsed from the synthetic `inspPath` (usually relative).
 * @param {string} projectRoot Absolute project root.
 * @returns {string} Absolute component path inside `projectRoot`.
 */
export function resolveAngularComponentFile(file: string, projectRoot: string) {
    const direct = assertPathInsideRoot(file, projectRoot);
    if (path.isAbsolute(file) || fs.existsSync(direct))
        return direct;
    for (const projectDir of angularProjectRoots(projectRoot)) {
        const candidate = path.resolve(projectRoot, projectDir, file);
        if (isInsideRoot(candidate, projectRoot) && fs.existsSync(candidate))
            return candidate;
    }
    return direct;
}
