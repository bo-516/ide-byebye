import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    fileStamp,
    MAX_COMMAND_CANDIDATES,
    resolveFirstCommand,
    writeHandoffPromptFile,
    writeLaunchFiles,
} from './launch-files.js';

/** Minimal request carrying the fields both writers name files with. */
const REQUEST = {
    id: 'r1',
    createdAt: '2026-10-03T07:30:00.123Z',
    agent: 'claude-cli',
    applyMode: 'prompt-only',
    pageUrl: 'http://localhost:5300/',
    selection: { file: 'src/App.tsx', line: 4, column: 2 },
};

/**
 * Run `fn` with a throwaway project root whose `.intent-inspector` output dir sits inside it.
 *
 * @param {(dirs: { projectRoot: string, outputDir: string }) => void} fn Test body.
 */
function withProject(fn: (dirs: { projectRoot: string, outputDir: string }) => void) {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-byebye-launch-'));
    try {
        fn({ projectRoot, outputDir: path.join(projectRoot, '.intent-inspector') });
    }
    finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
    }
}

test('fileStamp drops colons and the fractional seconds', () => {
    assert.equal(fileStamp(new Date('2026-10-03T07:30:00.123Z')), '2026-10-03T07-30-00');
});

test('resolveFirstCommand returns the first working candidate in list order', async () => {
    const started: string[] = [];
    const probe = async (command: string) => {
        started.push(command);
        return command !== 'missing';
    };
    assert.equal(await resolveFirstCommand(['missing', 'b', 'c'], probe), 'b');
    // Every probe starts up front, so a slow candidate costs one timeout, not one per candidate.
    assert.deepEqual(started, ['missing', 'b', 'c']);
    assert.equal(await resolveFirstCommand(['missing'], probe), null);
    assert.equal(await resolveFirstCommand([], probe), null);
});

test('resolveFirstCommand does not wait for later candidates once an earlier one works', async () => {
    let releaseSlow = () => {};
    const slow = new Promise<boolean>((resolve) => {
        releaseSlow = () => resolve(true);
    });
    const result = await resolveFirstCommand(['fast', 'slow'], async (command) => (command === 'fast' ? true : slow));
    assert.equal(result, 'fast');
    releaseSlow();
});

test('resolveFirstCommand probes at most MAX_COMMAND_CANDIDATES', async () => {
    const started: string[] = [];
    const candidates = Array.from({ length: MAX_COMMAND_CANDIDATES + 2 }, (_, index) => `c${index}`);
    assert.equal(await resolveFirstCommand(candidates, async (command) => {
        started.push(command);
        return false;
    }), null);
    assert.equal(started.length, MAX_COMMAND_CANDIDATES);
});

test('writeLaunchFiles names both files after the request and tag, and keeps them in launches/', () => {
    withProject(({ projectRoot, outputDir }) => {
        let seenPromptPath = '';
        const { launchPath, promptPath } = writeLaunchFiles({
            request: REQUEST,
            context: { outputDir, projectRoot },
            tag: 'claude',
            prompt: 'hello',
            platform: 'darwin',
            buildScript: (file) => {
                seenPromptPath = file;
                return '#!/bin/bash\n';
            },
        });
        assert.equal(promptPath, path.join(outputDir, 'launches', '2026-10-03T07-30-00-r1.claude.prompt.txt'));
        assert.equal(launchPath, path.join(outputDir, 'launches', '2026-10-03T07-30-00-r1.claude.command'));
        assert.equal(seenPromptPath, promptPath);
        assert.equal(fs.readFileSync(promptPath, 'utf8'), 'hello\n');
        assert.equal(fs.readFileSync(launchPath, 'utf8'), '#!/bin/bash\n');
        if (process.platform !== 'win32')
            assert.equal(fs.statSync(launchPath).mode & 0o111, 0o111);
        const bare = writeLaunchFiles({
            request: REQUEST,
            context: { outputDir, projectRoot },
            prompt: 'x\n',
            platform: 'win32',
            buildScript: () => '@echo off\r\n',
        });
        assert.equal(path.basename(bare.launchPath), '2026-10-03T07-30-00-r1.cmd');
        assert.equal(fs.readFileSync(bare.promptPath, 'utf8'), 'x\n');
    });
});

test('writeLaunchFiles writes nothing when the script builder throws', () => {
    withProject(({ projectRoot, outputDir }) => {
        assert.throws(() => writeLaunchFiles({
            request: REQUEST,
            context: { outputDir, projectRoot },
            prompt: 'hello',
            buildScript: () => {
                throw new Error('Invalid resume session id');
            },
        }), /Invalid resume session id/);
        assert.equal(fs.existsSync(path.join(outputDir, 'launches')), false);
    });
});

test('writeLaunchFiles rejects a tag that adds a path segment and an output dir outside the project', () => {
    withProject(({ projectRoot, outputDir }) => {
        const base = { request: REQUEST, prompt: 'p', buildScript: () => '' };
        assert.throws(() => writeLaunchFiles({ ...base, context: { outputDir, projectRoot }, tag: '../x' }), /Invalid launcher tag/);
        assert.throws(() => writeLaunchFiles({ ...base, context: { outputDir: os.tmpdir(), projectRoot } }));
    });
});

test('writeHandoffPromptFile writes requests/<stamp>-<id>.md inside the project', () => {
    withProject(({ projectRoot, outputDir }) => {
        const target = writeHandoffPromptFile(REQUEST, { outputDir, projectRoot, prompt: '@src/App.tsx #4\n\nfix it\n' });
        assert.equal(target, path.join(outputDir, 'requests', '2026-10-03T07-30-00-r1.md'));
        const markdown = fs.readFileSync(target, 'utf8');
        assert.match(markdown, /^# Intent request r1\n/);
        assert.match(markdown, /## Prompt\n\n@src\/App\.tsx #4\n\nfix it\n/);
        assert.throws(() => writeHandoffPromptFile(REQUEST, { outputDir: os.tmpdir(), projectRoot, prompt: 'x' }));
    });
});
