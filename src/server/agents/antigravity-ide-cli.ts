import path from 'node:path';
import { isInsideRoot } from '../security.js';
import { buildPromptReferenceLines, filterInlineReferenceLines } from '../prompt.js';
import { powershellSingleQuote, shellSingleQuote } from './grok-build-launcher.js';

/** Default argv budget before the IDE chat prompt is replaced by a file pointer. */
export const DEFAULT_ANTIGRAVITY_IDE_PROMPT_ARG_LIMIT = 12000;
/** CLI name on PATH when `antigravityIde.command` is omitted. */
export const DEFAULT_ANTIGRAVITY_IDE_COMMAND = 'antigravity-ide';
/**
 * macOS app-bundle CLI. The shell command is optional; this path works after a normal install.
 *
 * @type {string}
 */
const DARWIN_APP_CLI = '/Applications/Antigravity IDE.app/Contents/Resources/app/bin/antigravity-ide';

/**
 * Resolve the directory Antigravity IDE should open for the chat session.
 *
 * Boundary: `antigravityIde.projectRoot` wins only when it is a non-blank string. Relative values resolve from the
 * Node process cwd. Blank / non-string values fall back to `context.projectRoot` (the bundler project). Passing the
 * wrong root opens chat in a different workspace than the files the prompt names.
 *
 * @param {Record<string, unknown>} config Antigravity IDE adapter config.
 * @param {{ projectRoot: string }} context Agent context carrying the bundler project root.
 * @returns {string} Absolute workspace directory passed to the IDE CLI.
 */
export function resolveAntigravityIdeProjectRoot(config, context) {
    const configured = typeof config?.projectRoot === 'string' ? config.projectRoot.trim() : '';
    return configured ? path.resolve(configured) : context.projectRoot;
}

/**
 * Candidate executables for the Antigravity IDE CLI, in probe order.
 *
 * Boundary: `config.command` replaces the defaults entirely. Otherwise the PATH name is first, then the platform
 * install location (macOS app bundle, Windows user install). Linux has no well-known extra path — set `command` when
 * `antigravity-ide` is not on PATH. `platform` / `env` are injectable so tests do not depend on the host machine.
 *
 * @param {Record<string, unknown>} [config] Antigravity IDE adapter config.
 * @param {{ platform?: string, env?: NodeJS.ProcessEnv, homedir?: string }} [options] Overrides for tests.
 * @returns {string[]} Ordered command candidates.
 */
export function resolveAntigravityIdeCommandCandidates(config: any = {}, options: any = {}) {
    if (typeof config.command === 'string' && config.command.trim())
        return [config.command.trim()];
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    const candidates = [DEFAULT_ANTIGRAVITY_IDE_COMMAND];
    if (platform === 'darwin')
        candidates.push(DARWIN_APP_CLI);
    else if (platform === 'win32' && env.LOCALAPPDATA) {
        candidates.push(path.join(env.LOCALAPPDATA, 'Programs', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'));
    }
    return candidates;
}

/**
 * Collect absolute paths the IDE chat session should receive as `--add-file`.
 *
 * Boundary: order is primary source, then `@code` references, screenshots, then recording stills. Duplicates are
 * dropped. These paths are not trusted yet — callers must run {@link retainPathsInsideRoots} before they are embedded
 * in a launcher. A missing `source` yields an empty list rather than throwing.
 *
 * @param {Record<string, unknown>} request Normalized intent request.
 * @returns {string[]} Unique absolute paths, unfiltered.
 */
export function collectAntigravityIdeContextFiles(request) {
    const files = [];
    const add = (filePath) => {
        if (typeof filePath === 'string' && filePath && !files.includes(filePath))
            files.push(filePath);
    };
    add(request?.source?.filePath);
    if (Array.isArray(request?.references)) {
        for (const reference of request.references)
            add(reference?.source?.filePath);
    }
    const screenshots = request?.screenshots?.length
        ? request.screenshots
        : request?.screenshot
            ? [request.screenshot]
            : [];
    for (const shot of screenshots)
        add(shot?.filePath);
    if (Array.isArray(request?.recordings)) {
        for (const clip of request.recordings)
            add(clip?.stillFramePath);
    }
    return files;
}

/**
 * Keep only paths that resolve inside one of `roots`.
 *
 * Boundary: page-supplied paths that escape the bundler project (and the configured IDE root) are dropped, not
 * passed to the IDE CLI. An empty `roots` list drops everything. `isInsideRoot` rejects paths outside each root.
 *
 * @param {string[]} files Candidate absolute paths.
 * @param {string[]} roots Trusted directories (plugin project root, IDE workspace).
 * @returns {string[]} Paths safe to pass as `--add-file`.
 */
export function retainPathsInsideRoots(files, roots) {
    const trusted = (roots ?? []).filter((root) => typeof root === 'string' && root);
    return (files ?? []).filter((file) => trusted.some((root) => isInsideRoot(file, root)));
}

/**
 * Decide whether the IDE should get a short file-pointer prompt.
 *
 * Boundary: `promptMode: "file"` always writes the handoff. A prompt whose first character is `-` is also written
 * out, because the IDE CLI parses a leading `-` as a flag and would drop the text. In `auto`, length over the argv
 * budget switches to the pointer. Any other `promptMode` keeps the inline prompt (unless it starts with `-`).
 *
 * @param {Record<string, unknown>} config Antigravity IDE adapter config.
 * @param {string} prompt Rendered prompt text.
 * @returns {boolean} True when the full prompt should be replaced by a pointer.
 */
export function shouldWriteAntigravityIdePromptFile(config, prompt) {
    const text = String(prompt ?? '');
    const mode = config?.promptMode ?? 'auto';
    if (mode === 'file' || text.startsWith('-'))
        return true;
    if (mode !== 'auto')
        return false;
    const rawLimit = Number(config?.promptArgLimit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : DEFAULT_ANTIGRAVITY_IDE_PROMPT_ARG_LIMIT;
    return text.length > limit;
}

/**
 * Short prompt used when the full request was written to disk.
 *
 * Boundary: the first line is a fixed label so the CLI positional cannot look like a flag. `promptPath` should be
 * the written handoff file; an empty path leaves the IDE with a pointer that does not name a file.
 *
 * @param {Record<string, unknown>} request Normalized intent request.
 * @param {string} promptPath Absolute handoff markdown path.
 * @returns {string} Prompt ending with a newline.
 */
export function buildAntigravityIdeFilePrompt(request, promptPath) {
    const intent = String(request?.intent ?? '').trim();
    const refs = filterInlineReferenceLines(buildPromptReferenceLines(request), intent);
    return ['Request file:', promptPath, ...refs, '', intent].join('\n').trim() + '\n';
}

/**
 * Window flag for opening the project folder.
 *
 * Boundary: `newWindow` forces a new IDE window. `reuseWindow` forces the last active window. When neither is set,
 * the IDE's own window policy decides. This script does not pass the prompt — `antigravity-ide chat` calls
 * `workbench.action.chat.newChat`, which this IDE does not register, so the agent input stays empty.
 *
 * @param {Record<string, unknown>} input Launcher fields.
 * @returns {string} Empty, `--new-window`, or `--reuse-window`.
 */
function bashOpenFlag(input) {
    if (input.newWindow)
        return ' --new-window';
    if (input.reuseWindow)
        return ' --reuse-window';
    return '';
}

/**
 * Build the bash launcher that opens the project in Antigravity IDE.
 *
 * Boundary: the prompt is not in this script. The agent input is filled afterwards by the bridge extension.
 * Paths and the binary are single-quoted.
 *
 * @param {{ command: string, cwd: string, newWindow?: boolean, reuseWindow?: boolean }} input Launcher fields.
 * @returns {string} Bash script including the shebang.
 */
export function buildAntigravityIdeLauncherScript(input) {
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
 * Build a `.cmd` wrapper that opens the project in Antigravity IDE.
 *
 * Boundary: the prompt is not in this script. The folder is the only argument, so cmd metacharacters in the
 * prompt never reach `cmd.exe`.
 *
 * @param {{ command: string, cwd: string, newWindow?: boolean, reuseWindow?: boolean }} input Launcher fields.
 * @returns {string} `.cmd` contents (CRLF).
 */
export function buildAntigravityIdeWindowsLauncherScript(input) {
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
export function antigravityIdeLauncherExtension(platform = process.platform) {
    return platform === 'win32' ? '.cmd' : '.command';
}

/**
 * Launcher body for the platform.
 *
 * @param {Record<string, unknown>} input Fields accepted by the bash / PowerShell builders.
 * @param {string} [platform=process.platform] Node platform id.
 * @returns {string} Script contents.
 */
export function buildAntigravityIdeLauncherFile(input, platform = process.platform) {
    return platform === 'win32'
        ? buildAntigravityIdeWindowsLauncherScript(input)
        : buildAntigravityIdeLauncherScript(input);
}

/**
 * Error text when no IDE CLI candidate responds to `--version`.
 *
 * @param {Record<string, unknown>} [config] Antigravity IDE adapter config.
 * @returns {string} Message safe to return to the page.
 */
export function antigravityIdeMissingMessage(config: any = {}) {
    const name = resolveAntigravityIdeCommandCandidates(config)[0];
    return `"${name}" not found. Install Antigravity IDE and ensure \`${DEFAULT_ANTIGRAVITY_IDE_COMMAND}\` is on PATH.`;
}
