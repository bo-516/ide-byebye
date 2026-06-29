import path from 'node:path';
import { buildPromptReferenceLines, filterInlineReferenceLines } from '../prompt.js';

/**
 * Default Cursor URL scheme declared by Cursor.app.
 *
 * Boundary: changing this only makes sense for custom builds; regular Cursor installations register `cursor`.
 *
 * @type {string} Scheme used before `://`.
 */
const DEFAULT_SCHEME = 'cursor';
/**
 * Default extension authority that handles Cursor prompt deeplinks.
 *
 * Boundary: this must match Cursor's bundled `cursor-deeplink` extension authority or the app treats the URL as
 * unrecognized.
 *
 * @type {string} Authority used after `cursor://`.
 */
const DEFAULT_AUTHORITY = 'anysphere.cursor-deeplink';
/**
 * Default route for Cursor's prompt prefill handler.
 *
 * Boundary: routes are parsed by Cursor's URI handler. Unsupported routes may open Cursor but do nothing useful.
 *
 * @type {string} Deeplink path segment without a leading slash.
 */
const DEFAULT_ROUTE = 'prompt';
/**
 * Workspace file suffix stripped when deriving a Cursor workspace name.
 *
 * Boundary: only display/routing names are changed; filesystem paths are not modified by this constant.
 *
 * @type {string} Cursor/VS Code workspace filename suffix.
 */
const WORKSPACE_FILE_SUFFIX = '.code-workspace';

/**
 * Normalize the URL scheme used for Cursor deeplinks.
 *
 * Boundary: the result omits a trailing colon and must be a valid URL scheme. Invalid schemes throw so no malformed
 * external URL is opened.
 *
 * @param {string | undefined} scheme Optional configured scheme.
 * @returns {string} Valid deeplink scheme, usually `cursor`.
 */
function normalizeScheme(scheme) {
    const value = (scheme ?? DEFAULT_SCHEME).replace(/:$/, '');
    if (!/^[a-z][a-z0-9+.-]*$/i.test(value)) {
        throw new Error(`Invalid Cursor URL scheme: ${scheme}`);
    }
    return value;
}

/**
 * Normalize the Cursor extension authority that receives deeplinks.
 *
 * Boundary: Cursor's prompt route is handled by `anysphere.cursor-deeplink`; changing this value is only for custom
 * builds or tests. Invalid values throw before spawning the opener.
 *
 * @param {string | undefined} authority Optional configured URL authority.
 * @returns {string} URL authority used after `cursor://`.
 */
function normalizeAuthority(authority) {
    const value = (authority ?? DEFAULT_AUTHORITY).trim();
    if (!/^[a-z0-9.-]+$/i.test(value)) {
        throw new Error(`Invalid Cursor deeplink authority: ${authority}`);
    }
    return value;
}

/**
 * Normalize the Cursor deeplink route.
 *
 * Boundary: the default `/prompt` route accepts `text`, `workspace`, and `mode`. Invalid route names throw rather than
 * silently opening an unsupported Cursor URL.
 *
 * @param {string | undefined} route Optional configured route name.
 * @returns {string} Route name without leading or trailing slashes.
 */
function normalizeRoute(route) {
    const value = String(route ?? DEFAULT_ROUTE).trim().replace(/^\/+|\/+$/g, '');
    if (!/^[a-z][a-z0-9._-]*$/i.test(value)) {
        throw new Error(`Invalid Cursor deeplink route: ${route}`);
    }
    return value;
}

/**
 * Build the Cursor prompt deeplink URL.
 *
 * Boundary: `prompt` becomes the required `text` query parameter. Cursor validates prompt text and may reject unsafe
 * or very long values; callers can switch to file handoff before calling this helper.
 *
 * @param {{ scheme?: string, authority?: string, route?: string, prompt: string, workspace?: string, mode?: string }} input Deeplink fields.
 * @returns {string} Fully encoded Cursor deeplink URL.
 */
export function buildCursorAppDeepLink(input) {
    const url = new URL(`${normalizeScheme(input.scheme)}://${normalizeAuthority(input.authority)}/${normalizeRoute(input.route)}`);
    url.searchParams.set('text', input.prompt);
    if (input.workspace)
        url.searchParams.set('workspace', input.workspace);
    if (input.mode)
        url.searchParams.set('mode', input.mode);
    return url.toString();
}

/**
 * Resolve the Cursor workspace name used for prompt-window routing.
 *
 * Boundary: Cursor's prompt deeplink accepts a workspace name, not an arbitrary folder path. `cursorApp.workspace`
 * wins, `false` omits the parameter, and otherwise the basename of `projectRoot` is used.
 *
 * @param {Record<string, unknown>} config Cursor App adapter config.
 * @param {{ projectRoot: string }} context Agent context carrying the Vite project root.
 * @returns {string | undefined} Workspace name for Cursor routing, or undefined to omit it.
 */
export function resolveCursorAppWorkspace(config, context) {
    if (config.workspace === false)
        return undefined;
    if (typeof config.workspace === 'string' && config.workspace.trim())
        return config.workspace.trim();
    const configuredRoot = typeof config.projectRoot === 'string' && config.projectRoot.trim()
        ? path.resolve(config.projectRoot.trim())
        : context.projectRoot;
    const basename = path.basename(configuredRoot);
    return basename.endsWith(WORKSPACE_FILE_SUFFIX)
        ? basename.slice(0, -WORKSPACE_FILE_SUFFIX.length)
        : basename;
}

/**
 * Build the short Cursor prompt used when full context is written to disk.
 *
 * Boundary: the prompt path should come from `writePromptFile`; an empty path would remove the handoff target from the
 * prompt and leave Cursor with only the original intent.
 *
 * @param {Record<string, unknown>} request Normalized intent request.
 * @param {string} promptPath Absolute prompt file path written under the inspector output directory.
 * @returns {string} Cursor handoff prompt ending with a newline.
 */
export function buildCursorAppFilePrompt(request, promptPath) {
    const intent = String(request.intent ?? '').trim();
    const refs = filterInlineReferenceLines(buildPromptReferenceLines(request), intent);
    return [...refs, promptPath, '', intent].join('\n').trim() + '\n';
}
