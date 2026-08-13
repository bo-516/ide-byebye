import { spawn } from 'node:child_process';

/**
 * Command plus argv placed *before* the deeplink URL or launcher path.
 *
 * Boundary: `argsPrefix` is not a full argv — callers always append the target as the last argument
 * (after Windows quoting when needed). An empty prefix is valid (`open <url>`).
 */
export type ResolvedOpener = {
    command: string;
    argsPrefix: string[];
};

/**
 * Built-in opener for a Node `process.platform` id so footer agents work with zero config.
 *
 * Purpose: macOS has `open`, Windows needs `cmd /c start ""` (the empty title token stops `start`
 * from treating the URL as a window title), and desktop Linux uses `xdg-open`.
 * Boundary: pure. Unknown Unix-like platforms get `xdg-open` rather than failing closed — a missing
 * binary surfaces as spawn `ENOENT`. `win32` must keep `'""'` (two quote characters), not `''`.
 *
 * @param {string} [platform=process.platform] Node platform id (`darwin` / `win32` / `linux` / …).
 * @returns {ResolvedOpener} Executable and default args prefix.
 */
export function defaultOpenerForPlatform(platform: string = process.platform): ResolvedOpener {
    if (platform === 'darwin') {
        return { command: 'open', argsPrefix: [] };
    }
    if (platform === 'win32') {
        return { command: 'cmd', argsPrefix: ['/c', 'start', '""'] };
    }
    return { command: 'xdg-open', argsPrefix: [] };
}

/**
 * Read `openArgs` as a string array.
 *
 * Boundary: non-arrays become `[]` so a typo does not spread a string into single characters.
 *
 * @param {Record<string, unknown>} [config] Agent config object.
 * @returns {string[]} Extra argv entries, possibly empty.
 */
function readOpenArgs(config: Record<string, unknown> = {}): string[] {
    return Array.isArray(config.openArgs) ? config.openArgs.map((value) => String(value)) : [];
}

/**
 * Resolve the opener used to launch a deeplink or launcher file.
 *
 * Boundary: a non-blank `openCommand` replaces the platform default entirely and uses only
 * configured `openArgs` (not merged). When `openCommand` is omitted, `openArgs` are appended after
 * the platform prefix so macOS `openArgs: ['-a', 'Safari']` still works without setting `openCommand`.
 *
 * @param {Record<string, unknown>} [config] Agent config (`openCommand`, `openArgs`).
 * @param {string} [platform=process.platform] Used only when `openCommand` is omitted.
 * @returns {ResolvedOpener} Command and args prefix; never null.
 */
export function resolveOpener(config: Record<string, unknown> = {}, platform: string = process.platform): ResolvedOpener {
    const command = typeof config.openCommand === 'string' ? config.openCommand.trim() : '';
    const openArgs = readOpenArgs(config);
    if (command) {
        return { command, argsPrefix: openArgs };
    }
    const defaults = defaultOpenerForPlatform(platform);
    return { command: defaults.command, argsPrefix: [...defaults.argsPrefix, ...openArgs] };
}

/**
 * True when `command` is `cmd` / `cmd.exe` (basename only, so `C:\\Windows\\System32\\cmd.exe` matches).
 *
 * @param {string} command Executable path or PATH name.
 * @returns {boolean} Whether Windows cmd quoting / `windowsVerbatimArguments` should apply.
 */
export function isCmdExe(command: string): boolean {
    const base = String(command).replace(/\\/g, '/').split('/').pop() ?? '';
    return /^(cmd|cmd\.exe)$/i.test(base);
}

/**
 * Quote a single argv token for `cmd.exe` when using `windowsVerbatimArguments`.
 *
 * Boundary: cmd treats `& | < > ^ %` as metacharacters unless the token is wrapped in double quotes.
 * Deeplinks always contain `&`. Callers must pass the result as one argv entry and set
 * `windowsVerbatimArguments: true` — Node's default Windows quoting does not protect `&`.
 *
 * @param {string} value Raw URL or file path.
 * @returns {string} Double-quoted token; embedded quotes are doubled.
 */
export function quoteWindowsCmdArg(value: string): string {
    return `"${String(value).replace(/"/g, '""')}"`;
}

/**
 * Build the full argv for an opener, quoting the target when spawning through `cmd.exe`.
 *
 * Boundary: quoting applies only on `win32` when the command is cmd. Custom wrappers (`xdg-open`,
 * `powershell`, …) receive the raw target. Passing the wrong `platform` relative to `opener.command`
 * can skip quoting and let cmd split on `&`.
 *
 * @param {ResolvedOpener} opener Command plus prefix from {@link resolveOpener}.
 * @param {string} target Deeplink URL or launcher path, appended last.
 * @param {string} [platform=process.platform] Controls whether cmd quoting runs.
 * @returns {string[]} Full argv for `spawn(opener.command, argv)`.
 */
export function buildOpenerArgv(
    opener: ResolvedOpener,
    target: string,
    platform: string = process.platform,
): string[] {
    const targetArg = platform === 'win32' && isCmdExe(opener.command)
        ? quoteWindowsCmdArg(target)
        : target;
    return [...opener.argsPrefix, targetArg];
}

/**
 * Spawn an opener and wait until it exits.
 *
 * Boundary: success means the opener process exited 0, not that the target app accepted the URL.
 * `windowsVerbatimArguments` is set only when actually running on Windows against `cmd.exe`.
 * A missing binary rejects with spawn `ENOENT`.
 *
 * @param {string} command Executable name or path.
 * @param {string[]} args Full argv including the target.
 * @returns {Promise<void>} Resolves on exit 0; rejects on spawn error or non-zero exit.
 */
export function spawnOpener(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const onWindows = process.platform === 'win32';
        const child = spawn(command, args, {
            stdio: 'ignore',
            windowsHide: true,
            windowsVerbatimArguments: onWindows && isCmdExe(command),
        });
        const finish = (err: Error | undefined) => {
            if (settled)
                return;
            settled = true;
            if (err)
                reject(err);
            else
                resolve(undefined);
        };
        child.once('error', (err) => finish(err));
        child.once('close', (code, signal) => {
            if (code === 0) {
                finish(undefined);
                return;
            }
            finish(new Error(`${command} failed with ${signal ?? `exit code ${code ?? 'unknown'}`}`));
        });
    });
}

/**
 * Open a deeplink or launcher path with the resolved platform opener.
 *
 * Boundary: uses {@link resolveOpener} then {@link spawnOpener}. Does not check whether the
 * receiving app is installed — a missing protocol handler is an OS-level error after spawn.
 *
 * @param {Record<string, unknown>} config Agent config (`openCommand` / `openArgs` overrides).
 * @param {string} target Deeplink URL or absolute launcher path.
 * @param {string} [platform=process.platform] Injected in tests; production omits it.
 * @returns {Promise<void>} Resolves after the opener exits 0.
 */
export function openTarget(
    config: Record<string, unknown> = {},
    target: string,
    platform: string = process.platform,
): Promise<void> {
    const opener = resolveOpener(config, platform);
    return spawnOpener(opener.command, buildOpenerArgv(opener, target, platform));
}
