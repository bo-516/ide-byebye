import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyScopePath, normalizeScopePath } from '../sessions/project-scope.js';

/**
 * One Antigravity desktop project, reduced to what composer routing needs.
 *
 * Boundary: `id` is the sidebar section id the app routes on (`/?section=<id>`). `folders` are absolute local paths
 * taken from the project's folder resources; remote and google3 resources are dropped. A project with no local
 * folder can never match a workspace.
 */
export interface AntigravityProject {
    id: string;
    name: string;
    folders: string[];
}

/**
 * Filesystem calls {@link readAntigravityProjects} makes.
 *
 * Boundary: production uses `node:fs`. Tests pass an in-memory stand-in. Both calls may throw; a throw skips that
 * directory or file instead of failing the send.
 */
interface ProjectsFs {
    readdirSync(dir: string): string[];
    readFileSync(file: string, encoding: 'utf8'): string;
}

/**
 * Where the Antigravity desktop app keeps one JSON file per project.
 *
 * Boundary: the app resolves `~/.gemini/config` from `os.homedir()` on every platform, so there is no per-OS branch.
 * A wrong `homedir` reads no projects and the composer stays on whatever project was open.
 *
 * @param {string} [homedir=os.homedir()] User home directory.
 * @returns {string} Absolute directory holding `<projectId>.json` files.
 */
export function antigravityProjectsDir(homedir = os.homedir()) {
    return path.join(homedir, '.gemini', 'config', 'projects');
}

/**
 * Narrow a parsed JSON value to a plain object.
 *
 * @param {unknown} value Parsed JSON value.
 * @returns {Record<string, unknown> | null} The object, or null for arrays, primitives and null.
 */
function asRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * Local path of a project folder URI.
 *
 * Boundary: only `file:` URIs count. Other schemes and unparsable strings return null, which mirrors the app
 * ignoring resources it cannot parse.
 *
 * @param {unknown} uri `folderUri` value from a project resource.
 * @returns {string | null} Absolute local path, or null.
 */
function folderFromUri(uri: unknown) {
    if (typeof uri !== 'string' || !uri.trim())
        return null;
    try {
        const url = new URL(uri);
        return url.protocol === 'file:' ? fileURLToPath(url) : null;
    }
    catch {
        return null;
    }
}

/**
 * Parse one `~/.gemini/config/projects/<id>.json` body.
 *
 * Boundary: reads `id`, `name` and `projectResources.resources[]`, where a resource is `{ folderUri }` or
 * `{ gitFolder: { folderUri } }` (the two local kinds the app routes on). Anything else is ignored. A missing or blank
 * `id` returns null. A missing `name` falls back to the id.
 *
 * @param {unknown} raw Parsed JSON.
 * @returns {AntigravityProject | null} Project, or null when the body is not a project.
 */
export function parseAntigravityProject(raw: unknown): AntigravityProject | null {
    const record = asRecord(raw);
    if (!record || typeof record.id !== 'string' || !record.id.trim())
        return null;
    const resources = asRecord(record.projectResources)?.resources;
    const folders: string[] = [];
    for (const entry of Array.isArray(resources) ? resources : []) {
        const resource = asRecord(entry);
        const folder = folderFromUri(resource?.folderUri) ?? folderFromUri(asRecord(resource?.gitFolder)?.folderUri);
        if (folder)
            folders.push(folder);
    }
    const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : record.id;
    return { id: record.id, name, folders };
}

/**
 * Read every Antigravity project that has at least one local folder.
 *
 * Boundary: files are read in name order so ties resolve the same way on every send. An unreadable directory returns
 * `[]`. An unreadable or malformed file is skipped. This reads the user's own Antigravity config, never a path from
 * the page.
 *
 * @param {string} [dir=antigravityProjectsDir()] Projects directory.
 * @param {ProjectsFs} [io=fs] Filesystem.
 * @returns {AntigravityProject[]} Projects with local folders.
 */
export function readAntigravityProjects(dir = antigravityProjectsDir(), io: ProjectsFs = fs) {
    let names: string[];
    try {
        names = io.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
    }
    catch {
        return [];
    }
    const projects: AntigravityProject[] = [];
    for (const name of names) {
        try {
            const project = parseAntigravityProject(JSON.parse(io.readFileSync(path.join(dir, name), 'utf8')));
            if (project && project.folders.length > 0)
                projects.push(project);
        }
        catch {
            // A half-written or foreign file must not block the send.
        }
    }
    return projects;
}

/**
 * Pick the project whose folder is, or contains, `workspaceDir`.
 *
 * Boundary: the most specific folder wins, so a package project beats a monorepo project that also contains it. A
 * project folder nested inside `workspaceDir` does not match, because that project cannot see the rest of the
 * workspace. Paths are realpath'd before comparing. Equal folders keep the earlier project.
 *
 * @param {AntigravityProject[]} projects Candidates from {@link readAntigravityProjects}.
 * @param {string} workspaceDir Absolute directory the agent should work in.
 * @param {{ platform?: string, realpath?: (input: string) => string }} [opts] Test hooks for win32 case folding and
 *        realpath. Omit them in production.
 * @returns {AntigravityProject | null} Matching project, or null when none contains `workspaceDir`.
 */
export function selectAntigravityProject(projects: AntigravityProject[], workspaceDir: string, opts: { platform?: string, realpath?: (input: string) => string } = {}) {
    const platform = opts.platform ?? process.platform;
    const realpath = opts.realpath ?? ((input: string) => normalizeScopePath(input));
    const target = realpath(workspaceDir);
    let best: { project: AntigravityProject, folder: string } | null = null;
    for (const project of projects) {
        for (const folder of project.folders) {
            const resolved = realpath(folder);
            if (classifyScopePath(target, resolved, platform) === 'outside')
                continue;
            if (!best || resolved.length > best.folder.length)
                best = { project, folder: resolved };
        }
    }
    return best?.project ?? null;
}

/**
 * Antigravity project the composer should open in for `workspaceDir`.
 *
 * Boundary: reads the user's project files on each call (they change whenever a project is added in the app). Returns
 * null when Antigravity has no project for that folder; the caller then leaves the app on its current project.
 *
 * @param {string} workspaceDir Absolute agent working directory.
 * @param {string} [dir=antigravityProjectsDir()] Projects directory.
 * @returns {AntigravityProject | null} Matching project, or null.
 */
export function resolveAntigravityProject(workspaceDir: string, dir = antigravityProjectsDir()) {
    return selectAntigravityProject(readAntigravityProjects(dir), workspaceDir);
}
