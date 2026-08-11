/**
 * Shared helpers for `scripts/publish.js`: argv parsing, semver, and process runners.
 *
 * Boundary: pure parsing / comparison stay side-effect free; `run` / `runCapture` spawn processes.
 * Callers pass absolute paths and validated bump strings — this module does not read package.json.
 */

import { spawnSync } from 'node:child_process';

/** @type {ReadonlySet<string>} Allowed relative bump kinds (plus exact semver / `current`). */
export const BUMP_KINDS = new Set(['patch', 'minor', 'major', 'current']);

/**
 * Parsed CLI options for one publish run.
 *
 * @typedef {object} PublishOptions
 * @property {string} bump Version bump kind (`patch` / `minor` / `major` / `current`) or exact semver.
 * @property {boolean} dryRun When true, never mutate git / registry / package.json version.
 * @property {boolean} noGit When true, skip commit / tag / push after a real publish.
 * @property {string} tag npm dist-tag applied on publish.
 * @property {string | null} otp npm 2FA OTP, or null when unused.
 * @property {boolean} allowDirty When true, dirty working tree is allowed.
 * @property {string} branch Required current branch name.
 */

/**
 * Print help to stdout.
 *
 * Boundary: side-effecting. Callers exit after this when `--help` was requested.
 */
export function printHelp() {
    console.log(`Usage: node scripts/publish.js [patch|minor|major|current|<semver>] [options]

Options:
  --dry-run         Plan only: build, test, pack; no bump / publish / push
  --no-git          Skip git commit / tag / push
  --tag <dist>      npm dist-tag (default: latest)
  --otp <code>      npm one-time password
  --allow-dirty     Allow dirty working tree
  --branch <name>   Required branch (default: main)
  -h, --help        Show help

Examples:
  node scripts/publish.js current --dry-run
  node scripts/publish.js patch
  node scripts/publish.js minor
  node scripts/publish.js 0.2.0 --tag latest
  node scripts/publish.js patch --otp 123456
`);
}

/**
 * Parse argv into publish options.
 *
 * Boundary: throws on unknown flags or missing option values. Default bump is `current`
 * (publish package.json as-is) so a first release does not force an accidental bump.
 *
 * @param {string[]} argv Process argv slice after node + script path.
 * @returns {PublishOptions} Normalized options.
 */
export function parseArgs(argv) {
    /** @type {PublishOptions} */
    const options = {
        bump: 'current',
        dryRun: false,
        noGit: false,
        tag: 'latest',
        otp: null,
        allowDirty: false,
        branch: 'main',
    };

    let bumpSeen = false;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];

        if (arg === '-h' || arg === '--help') {
            printHelp();
            process.exit(0);
        }

        if (arg === '--dry-run') {
            options.dryRun = true;
            continue;
        }

        if (arg === '--no-git') {
            options.noGit = true;
            continue;
        }

        if (arg === '--allow-dirty') {
            options.allowDirty = true;
            continue;
        }

        if (arg === '--tag') {
            const value = argv[++i];
            if (!value) {
                throw new Error('--tag requires a dist-tag name');
            }
            options.tag = value;
            continue;
        }

        if (arg === '--otp') {
            const value = argv[++i];
            if (!value) {
                throw new Error('--otp requires a one-time password');
            }
            options.otp = value;
            continue;
        }

        if (arg === '--branch') {
            const value = argv[++i];
            if (!value) {
                throw new Error('--branch requires a branch name');
            }
            options.branch = value;
            continue;
        }

        if (arg.startsWith('-')) {
            throw new Error(`Unknown option: ${arg}`);
        }

        if (bumpSeen) {
            throw new Error(`Unexpected argument: ${arg}`);
        }

        options.bump = arg;
        bumpSeen = true;
    }

    if (!BUMP_KINDS.has(options.bump) && !isSemver(options.bump)) {
        throw new Error(
            `Invalid bump "${options.bump}". Use patch, minor, major, current, or an exact semver.`,
        );
    }

    return options;
}

/**
 * Whether `value` looks like a plain semver without a leading `v`.
 *
 * @param {string} value Candidate version string.
 * @returns {boolean} True when the string is `major.minor.patch` with optional prerelease / build.
 */
export function isSemver(value) {
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

/**
 * Compare two plain/prerelease-free semver strings numerically on major.minor.patch.
 *
 * Boundary: prerelease / build metadata are ignored for ordering here; release script expects stable versions.
 *
 * @param {string} a Left version.
 * @param {string} b Right version.
 * @returns {number} Negative if a < b, 0 if equal, positive if a > b.
 */
export function compareSemver(a, b) {
    const parse = (value) => value.split('-')[0].split('.').map((part) => Number(part));
    const left = parse(a);
    const right = parse(b);
    for (let i = 0; i < 3; i += 1) {
        const diff = (left[i] || 0) - (right[i] || 0);
        if (diff !== 0) {
            return diff;
        }
    }
    return 0;
}

/**
 * Compute the next version string for a bump kind or exact semver.
 *
 * Boundary: `current` returns `current` unchanged. Exact semver must be strictly greater.
 *
 * @param {string} current Current package version.
 * @param {string} bump `patch` / `minor` / `major` / `current` / exact semver.
 * @returns {string} Next version without a leading `v`.
 */
export function resolveNextVersion(current, bump) {
    if (bump === 'current') {
        return current;
    }

    if (isSemver(bump)) {
        if (compareSemver(bump, current) <= 0) {
            throw new Error(`Target version ${bump} must be greater than current ${current}`);
        }
        return bump;
    }

    const parts = current.split('.').map((part) => Number(part));
    if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
        throw new Error(`Cannot bump non-plain version "${current}"; pass an exact semver instead`);
    }

    const [major, minor, patch] = parts;
    if (bump === 'major') {
        return `${major + 1}.0.0`;
    }
    if (bump === 'minor') {
        return `${major}.${minor + 1}.0`;
    }
    return `${major}.${minor}.${patch + 1}`;
}

/**
 * Run a command in `cwd` and throw on non-zero exit.
 *
 * Boundary: inherits stdio so npm/git progress stays visible unless `allowFail` pipes output.
 *
 * @param {string} cwd Working directory for the child process.
 * @param {string} command Executable name.
 * @param {string[]} args Argument list.
 * @param {{ allowFail?: boolean }} [opts] When `allowFail`, return the result instead of throwing.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} Command result.
 */
export function run(cwd, command, args, opts = {}) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        stdio: opts.allowFail ? 'pipe' : 'inherit',
        shell: false,
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0 && !opts.allowFail) {
        throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}`);
    }

    return result;
}

/**
 * Run a command and return trimmed stdout, throwing on failure.
 *
 * @param {string} cwd Working directory for the child process.
 * @param {string} command Executable name.
 * @param {string[]} args Argument list.
 * @returns {string} Trimmed stdout.
 */
export function runCapture(cwd, command, args) {
    const result = run(cwd, command, args, { allowFail: true });
    if (result.status !== 0) {
        const detail = (result.stderr || result.stdout || '').trim();
        throw new Error(
            `${command} ${args.join(' ')} failed with exit ${result.status}${detail ? `\n${detail}` : ''}`,
        );
    }
    return (result.stdout || '').trim();
}
