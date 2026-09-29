import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildProjectScope, matchSessionCwd, sessionLocation } from './project-scope.js';

test('project scope matches equal, child, and in-git ancestors, and rejects above-git and symlinks outside', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-'));
    const repo = path.join(base, 'repo');
    const pkg = path.join(repo, 'pkg');
    const child = path.join(pkg, 'src');
    fs.mkdirSync(child, { recursive: true });
    fs.mkdirSync(path.join(repo, '.git'));
    const link = path.join(pkg, 'link-src');
    fs.symlinkSync(child, link, 'dir');
    const scope = buildProjectScope(pkg);
    assert.equal(matchSessionCwd(pkg, scope), true);
    assert.equal(matchSessionCwd(child, scope), true);
    assert.equal(matchSessionCwd(link, scope), true);
    assert.equal(matchSessionCwd(repo, scope), true);
    assert.equal(matchSessionCwd(base, scope), false);
    assert.equal(matchSessionCwd(path.join(base, 'other'), scope), false);
    assert.equal(sessionLocation(scope.projectRoot, scope.projectRoot, scope.platform), '.');
    assert.equal(sessionLocation(scope.gitRoot, scope.projectRoot, scope.platform), '..');
    assert.equal(sessionLocation(path.join(scope.projectRoot, 'src'), scope.projectRoot, scope.platform), 'src');
});

test('win32 scope comparison is case-insensitive', () => {
    const scope = buildProjectScope('C:\\Repo\\pkg', [], {
        platform: 'win32',
        realpath: (input: string) => input,
        gitRoot: 'C:\\Repo',
    });
    const opts = { platform: 'win32', realpath: (input: string) => input };
    assert.equal(matchSessionCwd('c:\\repo\\pkg', scope, opts), true);
    assert.equal(matchSessionCwd('c:\\repo\\pkg\\src', scope, opts), true);
    assert.equal(matchSessionCwd('c:\\repo', scope, opts), true);
    assert.equal(matchSessionCwd('C:\\', scope, opts), false);
    assert.equal(sessionLocation('c:\\repo', 'C:\\Repo\\pkg', 'win32'), '..');
});
