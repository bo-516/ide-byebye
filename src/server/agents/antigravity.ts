import { resolveFirstCommand, writeLaunchFiles } from './launch-files.js';
import { readPositiveLimit } from './launch-prompt.js';
import { openTarget } from './opener.js';
import { createPromptHandoff, type HandoffPromptRequest } from './prompt-handoff.js';
import { buildAntigravityDeepLink, DEFAULT_ANTIGRAVITY_PROMPT_URL_LIMIT, resolveAntigravityApp } from './antigravity-app.js';
import { resolveAntigravityProject, type AntigravityProject } from './antigravity-projects.js';
import {
    antigravityMissingMessage,
    buildAntigravityLauncherFile,
    resolveAntigravityCommandCandidates,
    resolveAntigravityProjectRoot,
    shouldWriteAntigravityPromptFile,
} from './antigravity-launcher.js';

/**
 * First `agy` candidate whose `--version` succeeds.
 *
 * @param {{ command?: unknown }} config Antigravity adapter config.
 * @returns {Promise<string | null>} Command to embed in the launcher, or null.
 */
function resolveAntigravityCommand(config: { command?: unknown }) {
    return resolveFirstCommand(resolveAntigravityCommandCandidates(config));
}

/** Side effects of the desktop route, replaceable in tests. */
export interface AntigravityDeps {
    /** Installed desktop app path, or null (see {@link resolveAntigravityApp}). */
    findApp: () => string | null;
    /** Antigravity project whose folder contains `dir`, or null. */
    findProject: (dir: string) => AntigravityProject | null;
    /** Hand a deep link or launcher path to the OS opener. */
    open: (config: Record<string, unknown>, target: string) => Promise<void>;
}

/**
 * Create the Antigravity adapter.
 *
 * Boundary: registered by default in `buildRegistry` unless `agents.antigravity` is `false` or `{ enabled: false }`.
 * The desktop app is preferred: an `antigravity://open` link puts the prompt in its home composer, switched to the
 * Antigravity project whose folder contains the project root. With no such project the app stays on its current
 * project and the output says so. The link is handed to the OS, so the app is launched when it is closed. The `agy`
 * CLI is only used when that app is not installed. Availability is the installed app, not a running window.
 *
 * @param {Record<string, unknown>} config Antigravity adapter options from plugin config.
 * @param {Partial<AntigravityDeps>} [overrides] Replacement side effects for tests.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter.
 */
export function createAntigravityAdapter(config: Record<string, unknown> = {}, overrides: Partial<AntigravityDeps> = {}) {
    const deps: AntigravityDeps = {
        findApp: () => resolveAntigravityApp(),
        findProject: (dir) => resolveAntigravityProject(dir),
        open: (openConfig, target) => openTarget(openConfig, target),
        ...overrides,
    };
    return {
        name: 'antigravity',
        async isAvailable() {
            if (deps.findApp())
                return { available: true };
            const command = await resolveAntigravityCommand(config);
            if (!command)
                return {
                    available: false,
                    reason: 'Antigravity is not installed. Install the Antigravity desktop app, or the agy CLI and put it on PATH.',
                };
            return { available: true };
        },
        async send(request: HandoffPromptRequest, context: {
            emit: (event: { type: string, text?: string }) => void,
            prompt: string,
            outputDir: string,
            projectRoot: string,
        }) {
            const events: { type: string, text: string }[] = [];
            const push = (type: string, text: string) => {
                const event = { type, text };
                events.push(event);
                context.emit(event);
            };
            push('started', 'Opening Antigravity');
            try {
                const cwd = resolveAntigravityProjectRoot(config, context);
                const handoff = createPromptHandoff(request, context, config, push);
                if (config.promptMode === 'file')
                    handoff.toPointer();
                if (deps.findApp()) {
                    const project = deps.findProject(cwd);
                    const linkFor = (prompt: string) => buildAntigravityDeepLink({ prompt, projectId: project?.id });
                    const urlLimit = readPositiveLimit(config.promptUrlLimit, DEFAULT_ANTIGRAVITY_PROMPT_URL_LIMIT);
                    const fits = (prompt: string) => linkFor(prompt).length <= urlLimit;
                    if (!fits(handoff.state.prompt))
                        handoff.toPointer();
                    if (!handoff.fitIntent(fits))
                        throw new Error(`The Antigravity link is longer than promptUrlLimit (${urlLimit}) even with the request moved to a file`);
                    await deps.open(config, linkFor(handoff.state.prompt));
                    const where = project ? ` in the ${project.name} project` : '';
                    push('completed', `Antigravity opened${where} with the prompt in the composer`);
                    const notes = [
                        `Opened Antigravity${where} with the prompt in the composer.`,
                        project ? '' : `No Antigravity project contains ${cwd}, so the current project was kept. Add that folder as a project in Antigravity to switch to it automatically.`,
                    ];
                    return {
                        ok: true,
                        agent: 'antigravity',
                        requestId: request.id,
                        events,
                        output: notes.filter(Boolean).join(' ') + handoff.note(),
                        writtenPromptPath: handoff.state.writtenPromptPath,
                    };
                }
                const command = await resolveAntigravityCommand(config);
                if (!command)
                    throw new Error(antigravityMissingMessage(config));
                if (shouldWriteAntigravityPromptFile(config, handoff.state.prompt))
                    handoff.toPointer();
                const mode = typeof config.mode === 'string' && config.mode.trim() ? config.mode.trim() : undefined;
                const { launchPath, promptPath } = writeLaunchFiles({
                    request,
                    context,
                    tag: 'agy',
                    prompt: handoff.state.prompt,
                    buildScript: (promptFile) => buildAntigravityLauncherFile({ command, cwd, promptPath: promptFile, mode }),
                });
                push('file-change', `Wrote launcher ${launchPath}`);
                await deps.open(config, launchPath);
                push('completed', 'Antigravity opened with a prefilled prompt');
                const writtenPromptPath = handoff.state.writtenPromptPath;
                return {
                    ok: true,
                    agent: 'antigravity',
                    requestId: request.id,
                    events,
                    output: writtenPromptPath
                        ? `Opened Antigravity. Full request context was written to ${writtenPromptPath}.`
                        : `Opened Antigravity with the generated prompt prefilled (${promptPath}).`,
                    writtenPromptPath: writtenPromptPath ?? promptPath,
                };
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                push('failed', error);
                return {
                    ok: false,
                    agent: 'antigravity',
                    requestId: request.id,
                    events,
                    error,
                };
            }
        },
    };
}
