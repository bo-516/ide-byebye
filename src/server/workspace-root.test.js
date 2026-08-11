import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    findNearestGitRoot,
    resolveDefaultWorkspaceDir,
    resolveDefaultWorkspaceName,
    workspaceNameFromDir,
} from './workspace-root.js';

/**
 * Create an empty temp directory under the OS temp root.
 *
 * @returns {string} Absolute path of the new directory.
 */
function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-inspector-ws-'));
}

/**
 * Recursively remove a temp directory created by tests.
 *
 * @param {string} dir Absolute path to remove.
 */
function rimraf(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

test('findNearestGitRoot returns null when no .git exists above start', () => {
    const root = makeTempDir();
    try {
        const nested = path.join(root, 'a', 'b');
        fs.mkdirSync(nested, { recursive: true });
        assert.equal(findNearestGitRoot(nested), null);
    }
    finally {
        rimraf(root);
    }
});

test('findNearestGitRoot prefers the nearest .git over a parent repo', () => {
    const root = makeTempDir();
    try {
        const outer = path.join(root, 'outer');
        const inner = path.join(outer, 'packages', 'app');
        fs.mkdirSync(inner, { recursive: true });
        fs.mkdirSync(path.join(outer, '.git'));
        fs.mkdirSync(path.join(inner, '.git'));
        assert.equal(findNearestGitRoot(inner), inner);
        assert.equal(findNearestGitRoot(path.join(outer, 'packages')), outer);
    }
    finally {
        rimraf(root);
    }
});

test('findNearestGitRoot accepts a .git file (git worktree / submodule link)', () => {
    const root = makeTempDir();
    try {
        const repo = path.join(root, 'repo');
        const nested = path.join(repo, 'demo', 'vue');
        fs.mkdirSync(nested, { recursive: true });
        fs.writeFileSync(path.join(repo, '.git'), 'gitdir: /tmp/fake-worktree\n');
        assert.equal(findNearestGitRoot(nested), repo);
    }
    finally {
        rimraf(root);
    }
});

test('resolveDefaultWorkspaceDir falls back to the run directory without git', () => {
    const root = makeTempDir();
    try {
        const runDir = path.join(root, 'scratch', 'app');
        fs.mkdirSync(runDir, { recursive: true });
        assert.equal(resolveDefaultWorkspaceDir(runDir), path.resolve(runDir));
        assert.equal(resolveDefaultWorkspaceName(runDir), 'app');
    }
    finally {
        rimraf(root);
    }
});

test('resolveDefaultWorkspaceDir uses nearest git root basename for the workspace name', () => {
    const root = makeTempDir();
    try {
        const repo = path.join(root, 'ai-inspector');
        const runDir = path.join(repo, 'demo', 'vue');
        fs.mkdirSync(runDir, { recursive: true });
        fs.mkdirSync(path.join(repo, '.git'));
        assert.equal(resolveDefaultWorkspaceDir(runDir), repo);
        assert.equal(resolveDefaultWorkspaceName(runDir), 'ai-inspector');
    }
    finally {
        rimraf(root);
    }
});

test('workspaceNameFromDir strips .code-workspace suffix', () => {
    assert.equal(workspaceNameFromDir('/tmp/workspaces/example.code-workspace'), 'example');
    assert.equal(workspaceNameFromDir('/tmp/workspaces/plain'), 'plain');
});
