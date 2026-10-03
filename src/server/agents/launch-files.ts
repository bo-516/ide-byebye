import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { assertPathInsideRoot } from '../security.js';
import { renderRequestMarkdown } from './file.js';
import { launcherExtension } from './launch-script.js';

/** Kill timeout for one `--version` probe, so `isAvailable` cannot stall `GET /agents`. */
export const COMMAND_PROBE_TIMEOUT_MS = 5000;

/**
 * Most CLI candidates one agent probes.
 *
 * Boundary: {@link resolveFirstCommand} starts every probe at once, so this caps both the processes spawned per check
 * and keeps the whole check near one {@link COMMAND_PROBE_TIMEOUT_MS}. Extra candidates are ignored.
 */
export const MAX_COMMAND_CANDIDATES = 4;

/** File-name tag: lowercase letters, digits, and dashes, so it cannot add a path segment. */
const LAUNCH_TAG = /^[a-z0-9-]*$/;

/** Request fields that name handoff files. */
interface HandoffRequest {
    id: string;
    createdAt: string | number | Date;
}

/** Where handoff files go: `outputDir` must stay inside `projectRoot`. */
interface HandoffContext {
    outputDir: string;
    projectRoot: string;
}

/**
 * Build a filesystem-safe timestamp fragment for handoff file names.
 *
 * Boundary: `date` must expose `toISOString()`. A non-Date-like value throws before any file is named.
 *
 * @param {Date} date Date used to stamp the file name.
 * @returns {string} `YYYY-MM-DDTHH-MM-SS` in UTC.
 */
export function fileStamp(date: Date) {
    return date.toISOString().replace(/:/g, '-').replace(/\..+$/, '');
}

/**
 * Probe whether a command exits successfully for `--version`.
 *
 * Boundary: a missing binary (`ENOENT`) or non-zero exit marks the candidate unavailable; a hang is killed after the
 * timeout so `isAvailable` cannot stall the agents endpoint.
 *
 * @param {string} command Executable path or PATH name.
 * @param {number} [timeoutMs=COMMAND_PROBE_TIMEOUT_MS] Kill timeout for the probe.
 * @returns {Promise<boolean>} True when `--version` exits 0.
 */
export function probeCommandVersion(command: string, timeoutMs = COMMAND_PROBE_TIMEOUT_MS) {
    return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (ok: boolean) => {
            if (settled)
                return;
            settled = true;
            resolve(ok);
        };
        let child: ChildProcess;
        try {
            child = spawn(command, ['--version'], { stdio: 'ignore' });
        }
        catch {
            finish(false);
            return;
        }
        const timer = setTimeout(() => {
            child.kill();
            finish(false);
        }, timeoutMs);
        child.once('error', () => {
            clearTimeout(timer);
            finish(false);
        });
        child.once('close', (code) => {
            clearTimeout(timer);
            finish(code === 0);
        });
    });
}

/**
 * First candidate, in list order, whose `--version` succeeds.
 *
 * Boundary: all probes start at once, and the result is returned as soon as every earlier candidate has failed, so the
 * wait is about one probe timeout rather than one per candidate. Only the first {@link MAX_COMMAND_CANDIDATES} are
 * tried. Callers must treat `null` as unavailable — never spawn an unverified name after this fails.
 *
 * @param {readonly string[]} candidates Ordered executables (absolute paths or PATH names).
 * @param {(command: string) => Promise<boolean>} [probe=probeCommandVersion] Probe, injected in tests.
 * @returns {Promise<string | null>} The working candidate, or null.
 */
export async function resolveFirstCommand(candidates: readonly string[], probe: (command: string) => Promise<boolean> = probeCommandVersion) {
    const tried = candidates.slice(0, MAX_COMMAND_CANDIDATES);
    const probes = tried.map((candidate) => probe(candidate));
    for (const [index, candidate] of tried.entries()) {
        if (await probes[index])
            return candidate;
    }
    return null;
}

/**
 * Write the full request markdown under `outputDir/requests`.
 *
 * Boundary: the directory must stay inside the trusted project root; outside paths throw before any file is created.
 *
 * @param {HandoffRequest} request Normalized intent request. The markdown renderer expects the full handoff shape; the
 *        assertion at the call is erased.
 * @param {HandoffContext & { prompt: string }} context Storage plus the prompt to render.
 * @returns {string} Absolute path of the written markdown file.
 */
export function writeHandoffPromptFile(request: HandoffRequest, context: HandoffContext & { prompt: string }) {
    const requestsDir = path.join(context.outputDir, 'requests');
    assertPathInsideRoot(requestsDir, context.projectRoot);
    fs.mkdirSync(requestsDir, { recursive: true });
    const target = path.join(requestsDir, `${fileStamp(new Date(request.createdAt))}-${request.id}.md`);
    fs.writeFileSync(target, renderRequestMarkdown(request as Parameters<typeof renderRequestMarkdown>[0], context.prompt), 'utf8');
    return target;
}

/**
 * Write a launcher's prompt file and the executable script that reads it.
 *
 * Boundary: both files go to `outputDir/launches` inside the project root, named
 * `<stamp>-<id>[.<tag>].prompt.txt` and `<stamp>-<id>[.<tag>]<.command|.cmd>`. The script is built first, so a builder
 * that rejects its input (a bad session id, an unsafe flag) throws before any file is written. The prompt file holds the
 * exact text the CLI receives and always ends with a newline; the script only names its path.
 *
 * @param {{ request: HandoffRequest, context: HandoffContext, tag?: string, prompt: string,
 *         buildScript: (promptPath: string) => string, platform?: string }} input `tag` tells agents apart in the
 *         folder (`''` keeps the bare name); `buildScript` gets the prompt file path; `platform` picks the suffix.
 * @returns {{ launchPath: string, promptPath: string }} Absolute paths of the launcher and the prompt file.
 */
export function writeLaunchFiles(input: {
    request: HandoffRequest,
    context: HandoffContext,
    tag?: string,
    prompt: string,
    buildScript: (promptPath: string) => string,
    platform?: string,
}) {
    const tag = input.tag ?? '';
    if (!LAUNCH_TAG.test(tag))
        throw new Error(`Invalid launcher tag: ${JSON.stringify(tag)}`);
    const launchesDir = path.join(input.context.outputDir, 'launches');
    assertPathInsideRoot(launchesDir, input.context.projectRoot);
    const stem = `${fileStamp(new Date(input.request.createdAt))}-${input.request.id}${tag ? `.${tag}` : ''}`;
    const promptPath = path.join(launchesDir, `${stem}.prompt.txt`);
    const launchPath = path.join(launchesDir, `${stem}${launcherExtension(input.platform)}`);
    const script = input.buildScript(promptPath);
    fs.mkdirSync(launchesDir, { recursive: true });
    fs.writeFileSync(promptPath, input.prompt.endsWith('\n') ? input.prompt : `${input.prompt}\n`, 'utf8');
    fs.writeFileSync(launchPath, script, { encoding: 'utf8', mode: 0o755 });
    return { launchPath, promptPath };
}
