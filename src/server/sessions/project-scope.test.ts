import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildProjectScope, matchSessionCwd, sessionLocation } from './project-scope.js';

test('project scope matches equal, child, in-git ancestors, and bounded umbrella ancestors', () => {
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
    // An umbrella directory above the git root counts within the depth bound (a multi-repo folder).
    assert.equal(matchSessionCwd(base, scope), true);
    // Deeper ancestors and siblings stay out of scope.
    assert.equal(matchSessionCwd(path.dirname(base), scope), false);
    assert.equal(matchSessionCwd(path.join(base, 'other'), scope), false);
    assert.equal(matchSessionCwd(path.parse(base).root, scope), false);
    // The home guard rejects the home directory and everything above it, even inside the depth bound.
    const homeScope = buildProjectScope(pkg, [], { home: base });
    assert.equal(matchSessionCwd(base, homeScope), false);
    assert.equal(matchSessionCwd(path.dirname(base), homeScope), false);
    assert.equal(sessionLocation(scope.projectRoot, scope.projectRoot, scope.platform), '.');
    assert.ok(scope.gitRoot);
    assert.equal(sessionLocation(scope.gitRoot, scope.projectRoot, scope.platform), '..');
    assert.equal(sessionLocation(path.join(scope.projectRoot, 'src'), scope.projectRoot, scope.platform), 'src');
});

test('a non-git project still matches ancestor directories within the depth bound', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-nogit-'));
    const plain = path.join(base, 'plain');
    const sub = path.join(plain, 'sub');
    fs.mkdirSync(sub, { recursive: true });
    const scope = buildProjectScope(sub, [], { gitRoot: null });
    assert.equal(scope.gitRoot, null);
    assert.equal(matchSessionCwd(plain, scope), true);
    assert.equal(matchSessionCwd(base, scope), true);
    assert.equal(matchSessionCwd(path.dirname(base), scope), false);
    assert.equal(matchSessionCwd(path.join(base, 'other'), scope), false);
});

test('win32 scope comparison is case-insensitive', () => {
    const opts = { platform: 'win32', realpath: (input: string) => input };
    const scope = buildProjectScope('C:\\Repo\\pkg', [], {
        platform: 'win32',
        realpath: (input: string) => input,
        gitRoot: 'C:\\Repo',
        home: 'C:\\Users\\me',
    });
    assert.equal(matchSessionCwd('c:\\repo\\pkg', scope, opts), true);
    assert.equal(matchSessionCwd('c:\\repo\\pkg\\src', scope, opts), true);
    assert.equal(matchSessionCwd('c:\\repo', scope, opts), true);
    assert.equal(matchSessionCwd('C:\\', scope, opts), false);
    assert.equal(matchSessionCwd('C:\\Users\\me', scope, opts), false);
    const plainScope = buildProjectScope('C:\\Umbrella\\repo\\pkg', [], {
        platform: 'win32',
        realpath: (input: string) => input,
        gitRoot: null,
        home: 'C:\\Users\\me',
    });
    assert.equal(matchSessionCwd('c:\\umbrella', plainScope, opts), true);
    assert.equal(matchSessionCwd('C:\\', plainScope, opts), false);
    assert.equal(sessionLocation('c:\\repo', 'C:\\Repo\\pkg', 'win32'), '..');
});
