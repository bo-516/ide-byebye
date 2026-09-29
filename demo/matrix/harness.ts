/**
 * Start one matrix case, assert injection and source location over HTTP, then kill the process group.
 *
 * Purpose: the only side effects for the 16 demos. Cases describe what to check; this module spawns,
 * polls `127.0.0.1`, follows at most one level of same-origin static imports (≤ 30 fetches), and
 * always signals the group so a failed row does not leave a listener behind.
 *
 * Boundary: no browser, no clicks. `DEMO_OPEN=0`, `BROWSER=none`. Error text includes the case id,
 * the URL, and the missing marker, and never the session token.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandBin, launchArgs } from '../catalog.mjs';
import { runCheck, type Check } from './checks.js';

/**
 * One catalog row. `args`, `portFlag`, and `portArgs` are what {@link launchArgs} reads.
 * Omitting `portArgs` on an argv row throws inside that function.
 */
type DemoRow = {
    id: string;
    title: string;
    cwd: string;
    command: string;
    args: string[];
    portFlag: 'env' | 'argv';
    portArgs?: (port: number) => string[];
    testPort: number;
    readyMs: number;
    injection: Check;
    source: Check;
};

const demoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const groups = new Set<number>();
let exitHooked = false;

/**
 * Kill any server group this process spawned if the test runner exits first.
 * Call once from the matrix test file. Repeated calls are ignored.
 *
 * @returns {void}
 */
export function installExitCleanup() {
    if (exitHooked)
        return;
    exitHooked = true;
    process.on('exit', () => {
        for (const pid of groups)
            signal(pid, 'SIGKILL');
    });
}

/**
 * Boot `item` on its test port and run both checks.
 *
 * @param {DemoRow} item Case row from `demo/catalog.mjs`.
 * @param {AbortSignal} [signal] Cancelled when the test times out; the group is killed.
 * @returns {Promise<void>} Resolves when both checks pass. Rejects with the case id, URL, and marker.
 */
export async function runMatrixCase(item: DemoRow, signal?: AbortSignal) {
    const port = item.testPort;
    const label = `${item.id} ${item.title.replace(/ /g, '')}`;
    const args = launchArgs(item, port);
    const command = commandBin(demoDir, item.command);
    const child = spawn(command, args, {
        cwd: path.join(demoDir, item.cwd),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
            DEMO_OPEN: '0',
            PORT: String(port),
            NG_CLI_ANALYTICS: 'false',
            BROWSER: 'none',
            NODE_ENV: 'development',
        },
    });
    const pid = child.pid;
    if (!pid)
        throw new Error(`${label}: failed to spawn ${item.command} (port ${port})`);
    groups.add(pid);
    const logs = drain(child);
    let exitCode: number | null = null;
    child.on('exit', (code) => {
        exitCode = code ?? 0;
    });
    const onAbort = () => {
        void killGroup(pid);
    };
    signal?.addEventListener('abort', onAbort);
    try {
        const page = `http://127.0.0.1:${port}/`;
        const html = await waitForDocument(page, item.readyMs, label, () => exitCode, logs);
        await runCheck(item.injection, { port, label, html, page });
        await runCheck(item.source, { port, label, html, page });
    }
    finally {
        signal?.removeEventListener('abort', onAbort);
        await killGroup(pid);
        groups.delete(pid);
    }
}

/**
 * Poll `GET /` until status 200 and the body contains `<`, or `readyMs` elapses.
 * The first attempt's abort deadline is the full `readyMs`; later attempts use the time left.
 * A refused connection is retried every 250ms. A child that exits is a failure and names the port.
 *
 * @param {string} page Absolute `http://127.0.0.1:<port>/`.
 * @param {number} readyMs Deadline from the start of polling.
 * @param {string} label `C-06 svelte+vite`.
 * @param {() => number | null} exited Current child exit code, or null while it runs.
 * @param {{ text: string }} logs Captured server output, redacted only when we throw.
 * @returns {Promise<string>} HTML document.
 */
async function waitForDocument(page, readyMs, label, exited, logs) {
    const deadline = Date.now() + readyMs;
    let attempt = 0;
    let last = 'no response';
    while (Date.now() < deadline) {
        if (exited() !== null)
            throw new Error(`${label}: server exited ${exited()} before ready (port ${new URL(page).port})`);
        attempt += 1;
        const budget = Math.max(1, deadline - Date.now());
        try {
            const res = await fetch(page, { signal: AbortSignal.timeout(attempt === 1 ? readyMs : budget) });
            const text = await res.text();
            if (res.status === 200 && text.includes('<'))
                return text;
            last = `status ${res.status}`;
        }
        catch (error) {
            last = error instanceof Error ? error.message : String(error);
        }
        if (Date.now() + 250 >= deadline)
            break;
        await sleep(250);
    }
    const tail = redact(logs.text).slice(-500);
    throw new Error(`${label}: GET ${page} not ready within ${readyMs}ms (${last})${tail ? ` ${tail}` : ''}`);
}

/**
 * Keep a bounded log so a piped dev server cannot fill the buffer and stall.
 * The text is not written to the test output unless a later error quotes it.
 *
 * @param {ChildProcess} child Spawned CLI.
 * @returns {{ text: string }} Mutable log, capped at 40k characters.
 */
function drain(child: ChildProcess) {
    const logs = { text: '' };
    const take = (chunk: Buffer) => {
        if (logs.text.length < 40_000)
            logs.text += chunk.toString();
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    return logs;
}

/**
 * SIGTERM the process group, then SIGKILL if it is still alive after 1s.
 *
 * @param {number} pid Process-group leader (`detached: true`).
 * @returns {Promise<void>}
 */
async function killGroup(pid: number) {
    signal(pid, 'SIGTERM');
    await sleep(1000);
    if (alive(pid))
        signal(pid, 'SIGKILL');
}

/**
 * Signal the group, falling back to the leader if it has no group.
 *
 * @param {number} pid Leader pid.
 * @param {NodeJS.Signals} name Signal name.
 * @returns {void}
 */
function signal(pid: number, name: NodeJS.Signals) {
    try {
        process.kill(-pid, name);
    }
    catch {
        try {
            process.kill(pid, name);
        }
        catch {
            // already exited
        }
    }
}

/**
 * @param {number} pid Leader pid.
 * @returns {boolean} `true` when the leader still exists.
 */
function alive(pid: number) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}

/**
 * Strip session tokens before any log fragment is placed in an error string.
 *
 * @param {string} text Server output.
 * @returns {string} Text with `token` values replaced.
 */
function redact(text: string) {
    return text
        .replace(/token=[A-Za-z0-9_-]+/g, 'token=redacted')
        .replace(/"token"\s*:\s*"[^"]*"/g, '"token":"redacted"');
}

/**
 * @param {number} ms Delay.
 * @returns {Promise<void>}
 */
function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
