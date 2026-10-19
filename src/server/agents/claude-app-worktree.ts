import path from 'node:path';
import { buildPrompt, buildPromptReferenceLines, filterInlineReferenceLines } from '../prompt.js';

/** Request shape the Claude App prompt builders read. */
type PromptRequest = Parameters<typeof buildPrompt>[0];

/** Folder Claude Code keeps its own state in; `<repo>/.claude/worktrees/<name>` holds its git worktrees. */
const CLAUDE_DIR_SEGMENT = '.claude';

/** Child of {@link CLAUDE_DIR_SEGMENT} that holds one folder per Claude worktree. */
const WORKTREES_SEGMENT = 'worktrees';

/**
 * A `folder` that Claude Desktop will not open as given.
 *
 * `worktree` is the folder the deeplink names (inside `<repo>/.claude/worktrees/<name>`); `opened` is the main
 * checkout Desktop opens instead.
 */
export interface ClaudeAppWorktreeRedirect {
    worktree: string;
    opened: string;
}

/**
 * Fold one path segment the way Claude Desktop compares them: NFKC, lower case, trailing dots and spaces dropped.
 *
 * Boundary: `.` and `..` are kept as they are, and a segment made only of dots and spaces is kept rather than
 * emptied, matching Desktop (2.42304), so `.claude` never folds to something else.
 *
 * @param {string} segment One path segment, without separators.
 * @returns {string} The comparable form.
 */
function foldSegment(segment: string) {
    const folded = segment.normalize('NFKC').toLowerCase();
    if (folded === '.' || folded === '..')
        return folded;
    return folded.replace(/[. ]+$/, '') || folded;
}

/**
 * Find where Claude Desktop will really open a `claude://code/new` `folder`.
 *
 * Purpose: since Desktop 2.42304, a `folder` inside `<repo>/.claude/worktrees/<name>/…` is rewritten to `<repo>`
 * before the new-session page sees it, so the session starts in the main checkout, not the worktree the dev server
 * runs from. Callers use this to point the prompt back at the worktree.
 * Boundary: mirrors Desktop's check: absolute paths only, segments compared case-insensitively, and the worktree
 * name segment must exist (`<repo>/.claude/worktrees` itself is opened as is). Relative or missing input returns
 * `null`, as does any path Desktop leaves alone.
 *
 * @param {string | undefined} folder The `folder` value the deeplink will carry.
 * @returns {ClaudeAppWorktreeRedirect | null} The worktree and the checkout Desktop opens, or `null` when the folder
 *          is used unchanged.
 */
export function findClaudeAppWorktreeRedirect(folder: string | undefined): ClaudeAppWorktreeRedirect | null {
    if (!folder || !path.isAbsolute(folder))
        return null;
    const worktree = path.resolve(folder);
    const segments = worktree.split(path.sep);
    for (let index = 1; index + 2 < segments.length; index++) {
        if (foldSegment(segments[index]) === CLAUDE_DIR_SEGMENT && foldSegment(segments[index + 1]) === WORKTREES_SEGMENT)
            return { worktree, opened: segments.slice(0, index).join(path.sep) || path.sep };
    }
    return null;
}

/**
 * First prompt line for a send whose session opens in the main checkout instead of the worktree.
 *
 * Boundary: language-neutral English like the rest of the prompt. Without it, the agent edits the main checkout and
 * the page served from the worktree never changes.
 *
 * @param {ClaudeAppWorktreeRedirect} redirect Result of {@link findClaudeAppWorktreeRedirect}.
 * @returns {string} One instruction line naming the worktree folder.
 */
export function claudeAppWorktreeLine(redirect: ClaudeAppWorktreeRedirect) {
    return `Work in the git worktree ${redirect.worktree}; the page is served from there, not from the opened folder.`;
}

/**
 * Prompt for a send whose session opens in the main checkout: the worktree line, then the usual prompt with every
 * `@` reference absolute.
 *
 * Boundary: references relative to the worktree would resolve against the main checkout, which often holds the same
 * file names, so the agent would edit the wrong copy. Absolute paths hold whatever folder the session opens in.
 *
 * @param {PromptRequest} request Normalized intent request.
 * @param {ClaudeAppWorktreeRedirect} redirect Result of {@link findClaudeAppWorktreeRedirect}.
 * @returns {string} Prompt text ending with a newline.
 */
export function buildClaudeAppWorktreePrompt(request: PromptRequest, redirect: ClaudeAppWorktreeRedirect) {
    return `${claudeAppWorktreeLine(redirect)}\n\n${buildPrompt(request, { pathStyle: 'absolute', artifactPathStyle: 'absolute' })}`;
}

/**
 * Compact prompt that points Claude App at a handoff file.
 *
 * Boundary: references stay relative to `request.projectRoot` unless `redirect` is given, which switches them to
 * absolute and leads with the worktree line (see {@link buildClaudeAppWorktreePrompt} for why). `promptPath` is
 * written as given.
 *
 * @param {PromptRequest & { intent: string }} request Normalized intent request.
 * @param {string} promptPath Absolute path of the written handoff file.
 * @param {ClaudeAppWorktreeRedirect | null} [redirect] Worktree the session does not open in, if any.
 * @returns {string} Prompt text ending with a newline.
 */
export function buildClaudeAppFilePrompt(request: PromptRequest & { intent: string }, promptPath: string, redirect: ClaudeAppWorktreeRedirect | null = null) {
    const intent = request.intent.trim();
    const pathStyle = redirect ? 'absolute' : 'relative';
    const refs = filterInlineReferenceLines(buildPromptReferenceLines(request, { pathStyle }), intent);
    const lead = redirect ? [claudeAppWorktreeLine(redirect), ''] : [];
    return [...lead, ...refs, promptPath, '', intent].join('\n').trim() + '\n';
}
