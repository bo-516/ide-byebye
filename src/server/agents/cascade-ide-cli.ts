import path from 'node:path';
import { resolveAgentProjectRoot } from './launch-prompt.js';
import { powershellSingleQuote, shellSingleQuote } from './grok-build-launcher.js';
import type { CascadeIdeSpec } from './cascade-ide-spec.js';

/**
 * Resolve the directory the IDE should open for the chat session.
 *
 * Boundary: the adapter's `projectRoot` wins only when it is a non-blank string. Relative values resolve
 * from the Node process cwd. Blank / non-string values fall back to `context.projectRoot` (the bundler
 * project). Passing the wrong root opens chat in a different workspace than the files the prompt names.
 *
 * @param {Record<string, unknown>} config IDE adapter config.
 * @param {{ projectRoot: string }} context Agent context carrying the bundler project root.
 * @returns {string} Absolute workspace directory passed to the IDE CLI.
 */
export function resolveCascadeIdeProjectRoot(config: { projectRoot?: unknown } | null | undefined, context: { projectRoot: string }) {
    return resolveAgentProjectRoot(config, context);
}

/**
 * Candidate executables for the IDE CLI, in probe order.
 *
 * Boundary: `config.command` replaces the defaults entirely. Otherwise the PATH name is first, then the
 * platform install location (macOS app bundle, Windows user install under `%LOCALAPPDATA%`).
 * `platform` / `env` are injectable so tests do not depend on the host machine.
 *
 * @param {CascadeIdeSpec} spec Product spec.
 * @param {Record<string, unknown>} [config] IDE adapter config.
 * @param {{ platform?: string, env?: NodeJS.ProcessEnv }} [options] Overrides for tests.
 * @returns {string[]} Ordered command candidates.
 */
export function resolveCascadeIdeCommandCandidates(spec: CascadeIdeSpec, config: Record<string, unknown> = {}, options: { platform?: string, env?: NodeJS.ProcessEnv } = {}) {
    if (typeof config.command === 'string' && config.command.trim())
        return [config.command.trim()];
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    const candidates = [spec.defaultCommand];
    if (platform === 'darwin' && spec.darwinAppCli)
        candidates.push(spec.darwinAppCli);
    else if (platform === 'win32' && spec.win32AppDataCli && env.LOCALAPPDATA)
        candidates.push(path.join(env.LOCALAPPDATA, spec.win32AppDataCli));
    return candidates;
}

/**
 * Window flag for opening the project folder.
 *
 * Boundary: `newWindow` forces a new IDE window. `reuseWindow` forces the last active window. When
 * neither is set, the IDE's own window policy decides.
 *
 * @param {{ newWindow?: unknown, reuseWindow?: unknown }} input Launcher fields.
 * @returns {string} Empty, `--new-window`, or `--reuse-window`.
 */
function bashOpenFlag(input: { newWindow?: unknown, reuseWindow?: unknown }) {
    if (input.newWindow)
        return ' --new-window';
    if (input.reuseWindow)
        return ' --reuse-window';
    return '';
}

/**
 * Build the bash launcher that opens the project in the IDE.
 *
 * Boundary: the prompt is not in this script. The chat input is filled afterwards by the bridge
 * extension. Paths and the binary are single-quoted.
 *
 * @param {{ command: string, cwd: string, newWindow?: boolean, reuseWindow?: boolean }} input Launcher fields.
 * @returns {string} Bash script including the shebang.
 */
export function buildCascadeIdeLauncherScript(input: { command: string, cwd: string, newWindow?: boolean, reuseWindow?: boolean }) {
    const command = shellSingleQuote(input.command);
    const cwd = shellSingleQuote(input.cwd);
    return [
        '#!/bin/bash',
        'set -euo pipefail',
        `cd ${cwd} || exit 1`,
        `${command} ${cwd}${bashOpenFlag(input)}`,
        '',
    ].join('\n');
}

/**
 * Build a `.cmd` wrapper that opens the project in the IDE.
 *
 * Boundary: the prompt is not in this script. The folder is the only argument, so cmd metacharacters
 * in the prompt never reach `cmd.exe`.
 *
 * @param {{ command: string, cwd: string, newWindow?: boolean, reuseWindow?: boolean }} input Launcher fields.
 * @returns {string} `.cmd` contents (CRLF).
 */
export function buildCascadeIdeWindowsLauncherScript(input: { command: string, cwd: string, newWindow?: boolean, reuseWindow?: boolean }) {
    const command = powershellSingleQuote(input.command);
    const cwd = powershellSingleQuote(input.cwd);
    const openFlag = input.newWindow ? ' --new-window' : input.reuseWindow ? ' --reuse-window' : '';
    const program = [
        `Set-Location -LiteralPath ${cwd}`,
        `& ${command} ${cwd}${openFlag}`,
    ].join('; ');
    const encoded = Buffer.from(program, 'utf16le').toString('base64');
    return `@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}\r\n`;
}

/**
 * Launcher suffix for the platform. Windows needs `.cmd`; other platforms use macOS `.command`.
 *
 * @param {string} [platform=process.platform] Node platform id.
 * @returns {'.cmd' | '.command'} Suffix including the dot.
 */
export function cascadeIdeLauncherExtension(platform = process.platform) {
    return platform === 'win32' ? '.cmd' : '.command';
}

/**
 * Launcher body for the platform.
 *
 * @param {{ command: string, cwd: string, newWindow?: boolean, reuseWindow?: boolean }} input Fields accepted by the bash / PowerShell builders.
 * @param {string} [platform=process.platform] Node platform id.
 * @returns {string} Script contents.
 */
export function buildCascadeIdeLauncherFile(input: { command: string, cwd: string, newWindow?: boolean, reuseWindow?: boolean }, platform = process.platform) {
    return platform === 'win32'
        ? buildCascadeIdeWindowsLauncherScript(input)
        : buildCascadeIdeLauncherScript(input);
}

/**
 * Error text when no IDE CLI candidate responds to `--version`.
 *
 * @param {CascadeIdeSpec} spec Product spec.
 * @param {Record<string, unknown>} [config] IDE adapter config.
 * @returns {string} Message safe to return to the page.
 */
export function cascadeIdeMissingMessage(spec: CascadeIdeSpec, config: Record<string, unknown> = {}) {
    const name = resolveCascadeIdeCommandCandidates(spec, config)[0];
    return `"${name}" not found. ${spec.installHint}`;
}
