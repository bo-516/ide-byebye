import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createClaudeAppAdapter } from './claude-app.js';
import { buildClaudeAppFilePrompt, buildClaudeAppWorktreePrompt, findClaudeAppWorktreeRedirect } from './claude-app-worktree.js';

/** Main checkout used by the pure tests. */
const REPO = path.resolve('/work/repo');

/** Package root of a dev server running inside a Claude worktree of {@link REPO}. */
const WORKTREE_ROOT = path.join(REPO, '.claude', 'worktrees', 'feat-x', 'demo', 'react');

/**
 * Minimal intent request rooted at `projectRoot`, with one source chip at `src/App.tsx #12`.
 *
 * @param projectRoot Absolute package root the request was resolved against.
 * @returns Request accepted by the Claude App adapter and prompt builders.
 */
function requestAt(projectRoot: string) {
    return {
        id: 'req-1',
        createdAt: '2026-10-19T07:00:00.000Z',
        intent: 'Make the button blue',
        agent: 'claude-app',
        applyMode: 'edit',
        pageUrl: 'http://localhost:5173/',
        projectRoot,
        selection: { file: 'src/App.tsx', line: 12, column: 3 },
        source: { filePath: path.join(projectRoot, 'src', 'App.tsx') },
    };
}

/**
 * Write a recorder that appends each opened target to `logFile`, and return the opener config pair for it.
 *
 * @param logFile Absolute path the recorder appends to.
 * @returns `openCommand` / `openArgs` spread into the adapter config.
 */
function recorder(logFile: string) {
    const script = path.join(path.dirname(logFile), 'record-open.mjs');
    fs.writeFileSync(script, `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(logFile)}, (process.argv[2] ?? '') + '\\n');`);
    return { openCommand: process.execPath, openArgs: [script] };
}

test('findClaudeAppWorktreeRedirect maps a folder inside .claude/worktrees to the main checkout', () => {
    assert.deepEqual(findClaudeAppWorktreeRedirect(WORKTREE_ROOT), { worktree: WORKTREE_ROOT, opened: REPO });
    assert.deepEqual(
        findClaudeAppWorktreeRedirect(path.join(REPO, '.Claude', 'WORKTREES', 'feat-x')),
        { worktree: path.join(REPO, '.Claude', 'WORKTREES', 'feat-x'), opened: REPO },
    );
});

test('findClaudeAppWorktreeRedirect leaves folders Desktop opens as given', () => {
    assert.equal(findClaudeAppWorktreeRedirect(path.join(REPO, 'demo', 'react')), null);
    assert.equal(findClaudeAppWorktreeRedirect(path.join(REPO, '.claude', 'worktrees')), null);
    assert.equal(findClaudeAppWorktreeRedirect(path.join(REPO, 'claude', 'worktrees', 'feat-x')), null);
    assert.equal(findClaudeAppWorktreeRedirect(path.join('.claude', 'worktrees', 'feat-x')), null);
    assert.equal(findClaudeAppWorktreeRedirect(undefined), null);
});

test('buildClaudeAppWorktreePrompt names the worktree first and makes every reference absolute', () => {
    const redirect = findClaudeAppWorktreeRedirect(WORKTREE_ROOT);
    assert.ok(redirect);
    const lines = buildClaudeAppWorktreePrompt(requestAt(WORKTREE_ROOT), redirect).split('\n');
    assert.equal(lines[0], `Work in the git worktree ${WORKTREE_ROOT}; the page is served from there, not from the opened folder.`);
    assert.equal(lines[1], '');
    assert.equal(lines[2], `@${path.join(WORKTREE_ROOT, 'src', 'App.tsx').split(path.sep).join('/')} #12`);
    assert.equal(lines.at(-2), 'Make the button blue');
});

test('buildClaudeAppFilePrompt keeps relative references unless the session opens elsewhere', () => {
    const request = requestAt(WORKTREE_ROOT);
    const handoff = path.join(WORKTREE_ROOT, '.intent-inspector', 'requests', 'req-1.md');
    assert.equal(buildClaudeAppFilePrompt(request, handoff), `@src/App.tsx #12\n${handoff}\n\nMake the button blue\n`);
    const redirected = buildClaudeAppFilePrompt(request, handoff, findClaudeAppWorktreeRedirect(WORKTREE_ROOT)).split('\n');
    assert.match(redirected[0], /^Work in the git worktree /);
    assert.equal(redirected[2], `@${path.join(WORKTREE_ROOT, 'src', 'App.tsx').split(path.sep).join('/')} #12`);
});

test('claude-app send from a worktree prefills the worktree prompt and keeps the folder param', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-app-worktree-'));
    try {
        const root = path.join(tmp, '.claude', 'worktrees', 'feat-x');
        const logFile = path.join(tmp, 'opened.log');
        const adapter = createClaudeAppAdapter({ ...recorder(logFile), attachFiles: false });
        const events: { type: string, text?: string }[] = [];
        const result = await adapter.send(requestAt(root), {
            emit: (event) => events.push(event),
            prompt: '@src/App.tsx #12\n\nMake the button blue\n',
            outputDir: path.join(root, '.intent-inspector'),
            projectRoot: root,
        });
        assert.equal(result.ok, true);
        const url = new URL(fs.readFileSync(logFile, 'utf8').trim());
        assert.deepEqual(url.searchParams.getAll('folder'), [root]);
        assert.match(url.searchParams.get('q') ?? '', new RegExp(`^Work in the git worktree ${root.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')};`));
        assert.ok(events.some((event) => event.type === 'notice' && event.text?.includes(`opens ${tmp}`)));
    }
    finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('claude-app send outside a worktree passes the routed prompt through unchanged', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-app-plain-'));
    try {
        const logFile = path.join(tmp, 'opened.log');
        const adapter = createClaudeAppAdapter({ ...recorder(logFile), attachFiles: false });
        const prompt = '@src/App.tsx #12\n\nMake the button blue\n';
        const events: { type: string, text?: string }[] = [];
        await adapter.send(requestAt(tmp), { emit: (event) => events.push(event), prompt, outputDir: path.join(tmp, '.intent-inspector'), projectRoot: tmp });
        const url = new URL(fs.readFileSync(logFile, 'utf8').trim());
        assert.equal(url.searchParams.get('q'), prompt);
        assert.equal(events.some((event) => event.type === 'notice'), false);
    }
    finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
