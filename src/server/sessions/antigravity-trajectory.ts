import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { antigravityIdeWorkspaceId, antigravityIdeWorkspaceSlug } from '../agents/antigravity-ide-bridge-host.js';
import { normalizeScopePath } from './project-scope.js';

/** Run states treated as `working`. `undefined` is included so a missing status can be passed to `Set.has` and stays idle. */
const WORKING_STATUSES = new Set<string | undefined>([
    'CASCADE_RUN_STATUS_RUNNING',
    'CASCADE_RUN_STATUS_CANCELING',
    'CASCADE_RUN_STATUS_BUSY',
]);

/**
 * One `CascadeTrajectorySummary` from `GetAllCascadeTrajectories`.
 *
 * Boundary: values stay `unknown` until each field is tested — `killed === true`, string `status`, array
 * `waitingSteps`, `workspaces[].workspaceFolderAbsoluteUri` URI strings. Anything unexpected falls back to the
 * field's default handling in the caller.
 */
export interface TrajectorySummary {
    killed?: unknown;
    status?: string;
    notFullyIdle?: unknown;
    waitingSteps?: unknown;
    summary?: unknown;
    workspaces?: Array<{ workspaceFolderAbsoluteUri?: unknown } | null> | null;
    lastModifiedTime?: string | number | { seconds?: unknown } | null;
}

/**
 * Map a trajectory summary's run state onto the shared status codes.
 *
 * Boundary: `killed` rows are omitted by the caller before this runs. Running, canceling, busy, or `notFullyIdle`
 * are `working` even when `waitingSteps` is also set. A non-empty `waitingSteps` is otherwise `waiting`.
 *
 * @param {{ status?: string, notFullyIdle?: unknown, waitingSteps?: unknown } | null | undefined} summary
 *        One `CascadeTrajectorySummary`. A missing object is idle. `waitingSteps` is only tested with `Array.isArray`.
 * @returns {'working' | 'waiting' | 'idle'}
 */
export function statusOf(summary: { status?: string; notFullyIdle?: unknown; waitingSteps?: unknown } | null | undefined) {
    if (WORKING_STATUSES.has(summary?.status) || summary?.notFullyIdle === true)
        return 'working';
    if (Array.isArray(summary?.waitingSteps) && summary.waitingSteps.length > 0)
        return 'waiting';
    return 'idle';
}

/**
 * Turn `file://` workspace URIs into a filesystem path.
 *
 * @param {unknown} uri `workspaceFolderAbsoluteUri` or a raw path. Non-strings become `''`.
 * @returns {string} Absolute path, or `''` when the URI cannot be parsed.
 */
export function cwdFromWorkspace(uri: unknown) {
    if (typeof uri !== 'string' || !uri)
        return '';
    if (uri.startsWith('file:')) {
        try {
            return fileURLToPath(uri);
        }
        catch {
            return '';
        }
    }
    return uri;
}

/**
 * Directory strings whose Antigravity workspace encodings should be tried.
 *
 * Boundary: the IDE hashes the folder it was opened with, which can be the pre-realpath path (`/var` vs
 * `/private/var`). A missing directory still contributes `path.resolve`. Duplicate strings are dropped.
 *
 * @param {string | string[]} projectRoots Inspector root and its realpath, either or both.
 * @returns {string[]} Distinct directories.
 */
function workspaceRoots(projectRoots: string | string[]) {
    const roots: string[] = [];
    const push = (value: unknown) => {
        if (typeof value === 'string' && value && !roots.includes(value))
            roots.push(value);
    };
    for (const root of Array.isArray(projectRoots) ? projectRoots : [projectRoots]) {
        push(root);
        try {
            push(path.resolve(root));
        }
        catch {
            // Ignore a root path.resolve cannot handle.
        }
        try {
            push(fs.realpathSync.native(root));
        }
        catch {
            // Missing folder: the resolved string above is still hashed.
        }
    }
    return roots;
}

/**
 * Whether this language server's `--workspace_id` is the project we are serving.
 *
 * Boundary: a match is the raw path, its `file://` URL, `antigravityIdeWorkspaceId` (sha256 of that URL), or
 * `antigravityIdeWorkspaceSlug` (`file_` + underscores). A mismatch does not drop the row; it only loses the dedupe
 * tie-break, so the first server that returned the cascade is kept.
 *
 * @param {string} workspaceId Flag value from the language server.
 * @param {string | string[]} projectRoots Inspector project root, before and after realpath.
 * @returns {boolean} True when the flag points at this project.
 */
export function workspaceMatches(workspaceId: string, projectRoots: string | string[]) {
    if (!workspaceId)
        return false;
    for (const root of workspaceRoots(projectRoots)) {
        if (workspaceId === root || workspaceId === pathToFileURL(root).href)
            return true;
        if (workspaceId === antigravityIdeWorkspaceId(root) || workspaceId === antigravityIdeWorkspaceSlug(root))
            return true;
    }
    if (String(workspaceId).startsWith('file:')) {
        try {
            const asPath = normalizeScopePath(fileURLToPath(workspaceId));
            return workspaceRoots(projectRoots).some((root) => normalizeScopePath(root) === asPath);
        }
        catch {
            return false;
        }
    }
    return false;
}

/**
 * ISO timestamp from a summary's `lastModifiedTime`.
 *
 * Boundary: ISO strings pass through. Numeric seconds or milliseconds are converted. Anything else becomes the
 * current time so the row still sorts instead of dropping out.
 *
 * @param {string | number | { seconds?: unknown } | null | undefined} value Summary timestamp. A `{ seconds }` object is
 *        treated as epoch seconds. Anything else becomes the current time.
 * @returns {string} ISO 8601.
 */
export function updatedAtFrom(value: string | number | { seconds?: unknown } | null | undefined) {
    if (typeof value === 'string' && Number.isFinite(Date.parse(value)))
        return new Date(value).toISOString();
    if (typeof value === 'number' && Number.isFinite(value)) {
        const ms = value > 1_000_000_000_000 ? value : value * 1000;
        return new Date(ms).toISOString();
    }
    if (value && typeof value === 'object' && Number.isFinite(Number(value.seconds)))
        return new Date(Number(value.seconds) * 1000).toISOString();
    return new Date().toISOString();
}

/**
 * Body of `SendUserCascadeMessage`.
 *
 * Boundary: a working session queues with `MESSAGE_DELIVERY_STRATEGY_WHEN_IDLE`. An idle or waiting session omits
 * `deliveryStrategy` so the IDE runs it immediately. `metadata` and `api_key` are never added — if the server
 * rejects that, the caller returns `ls-requires-credentials` instead of reading a credential file.
 *
 * @param {{ id: string, status?: string }} session Target session.
 * @param {string} prompt Prompt text. v1 sends text only; screenshot paths may already be inside it.
 * @returns {Record<string, unknown>} JSON body.
 */
export function buildCascadeSendBody(session: { id: string, status?: string }, prompt: string) {
    const body: Record<string, unknown> = {
        cascadeId: session.id,
        items: [{ text: String(prompt ?? '') }],
    };
    if (session.status === 'working')
        body.deliveryStrategy = 'MESSAGE_DELIVERY_STRATEGY_WHEN_IDLE';
    return body;
}
