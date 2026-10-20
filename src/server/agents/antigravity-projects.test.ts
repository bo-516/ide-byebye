import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
    antigravityProjectsDir,
    parseAntigravityProject,
    readAntigravityProjects,
    resolveAntigravityProject,
    selectAntigravityProject,
} from './antigravity-projects.js';

const identity = (input: string) => input;

test('antigravityProjectsDir is under ~/.gemini/config', () => {
    assert.equal(antigravityProjectsDir('/Users/me'), path.join('/Users/me', '.gemini', 'config', 'projects'));
});

test('parseAntigravityProject keeps local folder and git folder resources', () => {
    assert.deepEqual(parseAntigravityProject({
        id: 'p1',
        name: 'ai-inspector',
        projectResources: {
            resources: [
                { gitFolder: { folderUri: 'file:///Users/me/code/ai-inspector' } },
                { folderUri: 'file:///Users/me/My%20Docs' },
                { remoteResource: { type: 'user/file' } },
                { folderUri: 'https://example.com/repo' },
                { gitFolder: { folderUri: 'not a uri' } },
            ],
        },
    }), { id: 'p1', name: 'ai-inspector', folders: ['/Users/me/code/ai-inspector', '/Users/me/My Docs'] });
    assert.deepEqual(parseAntigravityProject({ id: 'default-cli-project', projectResources: {} }), {
        id: 'default-cli-project',
        name: 'default-cli-project',
        folders: [],
    });
    assert.equal(parseAntigravityProject({ name: 'no id' }), null);
    assert.equal(parseAntigravityProject([]), null);
});

test('selectAntigravityProject prefers the most specific folder that contains the workspace', () => {
    const projects = [
        { id: 'mono', name: 'mono', folders: ['/code/mono'] },
        { id: 'pkg', name: 'pkg', folders: ['/code/mono/plugins/pkg'] },
        { id: 'other', name: 'other', folders: ['/code/other'] },
    ];
    const pick = (dir: string) => selectAntigravityProject(projects, dir, { platform: 'darwin', realpath: identity })?.id ?? null;
    assert.equal(pick('/code/mono/plugins/pkg'), 'pkg');
    assert.equal(pick('/code/mono/plugins/pkg/demo/react'), 'pkg');
    assert.equal(pick('/code/mono/apps/web'), 'mono');
    assert.equal(pick('/code/mono-two'), null);
    // A project nested inside the workspace cannot see the rest of it.
    assert.equal(pick('/code'), null);
});

test('selectAntigravityProject folds case on win32', () => {
    const projects = [{ id: 'win', name: 'win', folders: ['C:\\Code\\App'] }];
    assert.equal(selectAntigravityProject(projects, 'c:\\code\\app\\src', { platform: 'win32', realpath: identity })?.id, 'win');
});

test('readAntigravityProjects skips malformed files and folderless projects', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-projects-'));
    try {
        const workspace = path.join(dir, 'workspace');
        fs.mkdirSync(workspace);
        fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({
            id: 'b',
            name: 'workspace',
            projectResources: { resources: [{ gitFolder: { folderUri: pathToFileURL(workspace).href } }] },
        }));
        fs.writeFileSync(path.join(dir, 'a.json'), '{ half written');
        fs.writeFileSync(path.join(dir, 'default-cli-project.json'), JSON.stringify({ id: 'default-cli-project', projectResources: {} }));
        fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
        assert.deepEqual(readAntigravityProjects(dir).map((project) => project.id), ['b']);
        assert.equal(resolveAntigravityProject(path.join(workspace, 'src'), dir)?.id, 'b');
        assert.equal(resolveAntigravityProject(dir, dir), null);
        assert.deepEqual(readAntigravityProjects(path.join(dir, 'missing')), []);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
