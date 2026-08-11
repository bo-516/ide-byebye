#!/usr/bin/env node
/**
 * Publish `ide-byebye` to npm with version bump, preflight checks, and optional git tagging.
 *
 * Boundary: this script owns release orchestration only (git / npm / version). It does not change
 * package contents beyond what `npm version` writes to `package.json`. Build + test stay on
 * `prepublishOnly`. Passing a bad bump aborts before any publish; `--dry-run` never hits the registry.
 *
 * Usage:
 *   node scripts/publish.js [patch|minor|major|current|<semver>] [options]
 *
 * Options:
 *   --dry-run       Build, test, pack, and print the plan; do not bump / publish / push
 *   --no-git        Skip git commit / tag / push (still bumps package.json for real publish)
 *   --tag <dist>    npm dist-tag (default: latest)
 *   --otp <code>    npm one-time password for 2FA
 *   --allow-dirty   Allow a dirty working tree
 *   --branch <name> Required branch (default: main)
 *   -h, --help      Show help
 *
 * Exit codes: 0 success; 1 usage / preflight / publish failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    parseArgs,
    resolveNextVersion,
    run,
    runCapture,
} from './publish-lib.js';

const ROOT_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');

/**
 * Read the root package.json.
 *
 * @returns {{ name: string, version: string }} Package identity fields used by publish.
 */
function readPackageJson() {
    const raw = fs.readFileSync(PACKAGE_JSON_PATH, 'utf8');
    const pkg = JSON.parse(raw);
    if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') {
        throw new Error('package.json must define string "name" and "version"');
    }
    return pkg;
}

/**
 * Ensure git working tree and branch are safe to release from.
 *
 * @param {import('./publish-lib.js').PublishOptions} options Parsed CLI options.
 */
function assertGitReady(options) {
    const inside = runCapture(ROOT_DIR, 'git', ['rev-parse', '--is-inside-work-tree']);
    if (inside !== 'true') {
        throw new Error('Not inside a git work tree');
    }

    const branch = runCapture(ROOT_DIR, 'git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch !== options.branch) {
        throw new Error(`Expected branch "${options.branch}", currently on "${branch}"`);
    }

    if (!options.allowDirty) {
        const dirty = runCapture(ROOT_DIR, 'git', ['status', '--porcelain']);
        if (dirty) {
            throw new Error(
                'Working tree is dirty. Commit/stash first, or pass --allow-dirty.\n' + dirty,
            );
        }
    }
}

/**
 * Ensure the current npm user can publish and the target version is free on the registry.
 *
 * Boundary: network-facing. A 404 for the package name is treated as first publish (ok).
 *
 * @param {string} name Package name.
 * @param {string} nextVersion Version about to publish.
 */
function assertNpmReady(name, nextVersion) {
    const whoami = run(ROOT_DIR, 'npm', ['whoami'], { allowFail: true });
    if (whoami.status !== 0) {
        throw new Error('Not logged in to npm. Run `npm login` first.');
    }
    const user = (whoami.stdout || '').trim();
    console.log(`npm user: ${user}`);

    const view = run(ROOT_DIR, 'npm', ['view', `${name}@${nextVersion}`, 'version'], {
        allowFail: true,
    });
    if (view.status === 0) {
        throw new Error(`${name}@${nextVersion} already exists on npm`);
    }

    const stderr = (view.stderr || '').toLowerCase();
    // First publish of the package, or version not found — both are fine.
    if (!stderr.includes('404') && !stderr.includes('e404') && !stderr.includes('not found')) {
        const detail = (view.stderr || view.stdout || '').trim();
        throw new Error(
            `Failed to check registry for ${name}@${nextVersion}${detail ? `\n${detail}` : ''}`,
        );
    }
}

/**
 * Remove leftover pack tarballs from a previous dry-run / pack in the package root.
 *
 * Boundary: only deletes `name-*.tgz` matching the current package name; never touches other files.
 *
 * @param {string} name Package name.
 */
function cleanupPackArtifacts(name) {
    const prefix = `${name}-`;
    for (const entry of fs.readdirSync(ROOT_DIR)) {
        if (entry.startsWith(prefix) && entry.endsWith('.tgz')) {
            fs.unlinkSync(path.join(ROOT_DIR, entry));
        }
    }
}

/**
 * Build, test, then `npm pack --dry-run` so the publish tarball contents are visible.
 */
function runBuildTestAndPackPreview() {
    run(ROOT_DIR, 'npm', ['run', 'build']);
    run(ROOT_DIR, 'npm', ['test']);
    run(ROOT_DIR, 'npm', ['pack', '--dry-run']);
}

/**
 * Bump package.json via `npm version` (and optionally create a git tag).
 *
 * Boundary: `current` is a no-op for version files; callers still may create a tag separately if needed.
 *
 * @param {string} bump Bump kind or exact semver (`current` skips npm version).
 * @param {boolean} noGit When true, skip git commit/tag (`--no-git-tag-version` on npm version).
 * @returns {string} Version from package.json after the bump (or unchanged for `current`).
 */
function bumpVersion(bump, noGit) {
    if (bump === 'current') {
        return readPackageJson().version;
    }

    const args = ['version', bump, '--message', 'chore: release v%s'];
    if (noGit) {
        args.push('--no-git-tag-version');
    }
    run(ROOT_DIR, 'npm', args);
    return readPackageJson().version;
}

/**
 * Ensure a `vX.Y.Z` git tag exists for the published version when using `current` + git.
 *
 * Boundary: no-op when the tag already exists. Does not create a release commit — only an annotated tag
 * on HEAD so `git push origin v*` still works for first publishes without a bump commit.
 *
 * @param {string} version Published version (without leading `v`).
 */
function ensureVersionTag(version) {
    const tag = `v${version}`;
    const existing = run(ROOT_DIR, 'git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
        allowFail: true,
    });
    if (existing.status === 0) {
        return;
    }
    run(ROOT_DIR, 'git', ['tag', '-a', tag, '-m', `chore: release ${tag}`]);
}

/**
 * Publish the current package version to npm.
 *
 * @param {import('./publish-lib.js').PublishOptions} options Parsed CLI options.
 */
function publishToNpm(options) {
    const args = ['publish', '--access', 'public', '--tag', options.tag];
    if (options.otp) {
        args.push('--otp', options.otp);
    }
    // prepublishOnly already runs build + test.
    run(ROOT_DIR, 'npm', args);
}

/**
 * Push the release commit (if any) and version tag to origin.
 *
 * @param {string} version Published version (without leading `v`).
 * @param {boolean} bumped Whether `npm version` created a release commit to push.
 */
function pushGitRelease(version, bumped) {
    if (bumped) {
        run(ROOT_DIR, 'git', ['push']);
    }
    run(ROOT_DIR, 'git', ['push', 'origin', `v${version}`]);
}

/**
 * Orchestrate one publish run.
 *
 * @param {import('./publish-lib.js').PublishOptions} options Parsed CLI options.
 */
function main(options) {
    const pkg = readPackageJson();
    const nextVersion = resolveNextVersion(pkg.version, options.bump);
    const willBump = options.bump !== 'current';

    console.log(`Package:  ${pkg.name}`);
    console.log(`Current:  ${pkg.version}`);
    console.log(`Next:     ${nextVersion}`);
    console.log(`Dist-tag: ${options.tag}`);
    console.log(`Mode:     ${options.dryRun ? 'dry-run' : 'publish'}`);

    if (!options.noGit || options.dryRun) {
        assertGitReady(options);
    }

    if (!options.dryRun) {
        assertNpmReady(pkg.name, nextVersion);
    }

    cleanupPackArtifacts(pkg.name);
    runBuildTestAndPackPreview();

    if (options.dryRun) {
        console.log('\nDry run complete. No version bump, publish, or git push performed.');
        console.log(`Would publish ${pkg.name}@${nextVersion} with tag "${options.tag}".`);
        cleanupPackArtifacts(pkg.name);
        return;
    }

    const publishedVersion = bumpVersion(options.bump, options.noGit);
    if (publishedVersion !== nextVersion) {
        throw new Error(`Version mismatch after bump: expected ${nextVersion}, got ${publishedVersion}`);
    }

    try {
        publishToNpm(options);
    } catch (error) {
        if (!options.noGit) {
            console.error(
                '\nPublish failed. Git tag/commit may already exist locally; fix and retry carefully.',
            );
        }
        throw error;
    }

    if (!options.noGit) {
        if (!willBump) {
            ensureVersionTag(publishedVersion);
        }
        pushGitRelease(publishedVersion, willBump);
    }

    cleanupPackArtifacts(pkg.name);
    console.log(`\nPublished ${pkg.name}@${publishedVersion} (tag: ${options.tag}).`);
}

try {
    const options = parseArgs(process.argv.slice(2));
    main(options);
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nPublish aborted: ${message}`);
    process.exit(1);
}
