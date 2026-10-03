import {
    buildClaudeCliDeepLink,
    CLAUDE_CLI_QUERY_LIMIT,
    claudeCliLauncherArgs,
    claudeCliQueryProblem,
    claudeCliUnavailableMessage,
    isClaudeCliCwdAllowed,
    pickClaudeCliRoute,
    readClaudeCliLaunch,
    WINDOWS_START_URL_LIMIT,
} from './claude-cli-route.js';
import { defaultClaudeCliDeps, isClaudeCliHandlerRegistered, resolveClaudeCliCommand, type ClaudeCliDeps } from './claude-cli-host.js';
import { writeLaunchFiles } from './launch-files.js';
import { resolveAgentProjectRoot, shouldWriteLauncherPromptFile } from './launch-prompt.js';
import { buildLauncherFile } from './launch-script.js';
import { createPromptHandoff, type HandoffPromptRequest } from './prompt-handoff.js';
import type { AgentEmitEvent } from './types.js';

/** Route context the adapter reads. */
interface ClaudeCliContext {
    emit: (event: AgentEmitEvent) => void;
    outputDir: string;
    projectRoot: string;
    prompt: string;
}

/**
 * Create the Claude Code CLI adapter (`claude-cli`).
 *
 * Boundary: `launch: 'auto'` (default) opens `claude-cli://open` in the user's own terminal with the prompt prefilled
 * (they press Enter) when the handler is registered and accepts the prompt and folder; otherwise a Terminal launcher
 * runs `claude -- "<prompt>"`, which submits it. The deeplink has no permission mode; `permissionMode` only applies
 * to the launcher. Nothing is installed or registered here.
 *
 * @param {Record<string, unknown>} [config] `agents.claudeCli` options.
 * @param {Partial<ClaudeCliDeps>} [overrides] Replacement side effects for tests.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter.
 */
export function createClaudeCliAdapter(config: Record<string, unknown> = {}, overrides: Partial<ClaudeCliDeps> = {}) {
    const deps: ClaudeCliDeps = { ...defaultClaudeCliDeps(), ...overrides };
    const launch = readClaudeCliLaunch(config.launch);
    const handlerRegistered = () => isClaudeCliHandlerRegistered(deps);
    const resolveCli = () => resolveClaudeCliCommand(config, deps);

    return {
        name: 'claude-cli',
        async isAvailable() {
            if (launch !== 'terminal' && await handlerRegistered())
                return { available: true };
            if (launch === 'deeplink')
                return { available: false, reason: claudeCliUnavailableMessage('handler') };
            if (await resolveCli())
                return { available: true };
            return { available: false, reason: claudeCliUnavailableMessage(launch === 'terminal' ? 'cli' : 'missing') };
        },
        async send(request: HandoffPromptRequest, context: ClaudeCliContext) {
            const events: AgentEmitEvent[] = [];
            const push = (type: string, text: string) => {
                const event = { type, text };
                events.push(event);
                context.emit(event);
            };
            push('started', 'Opening Claude Code CLI');
            try {
                const cwd = resolveAgentProjectRoot(config, context);
                const handoff = createPromptHandoff(request, context, config, push);
                const fits = (text: string) => claudeCliQueryProblem(text) === null
                    && (deps.platform !== 'win32' || buildClaudeCliDeepLink({ cwd, prompt: text }).length <= WINDOWS_START_URL_LIMIT);
                if (config.promptMode === 'file')
                    handoff.toPointer();
                const registered = launch !== 'terminal' && await handlerRegistered();
                const cwdAllowed = isClaudeCliCwdAllowed(cwd);
                const promptFits = fits(handoff.state.prompt);
                // Probe the CLI only when the deeplink cannot carry this send on its own.
                const command = launch === 'deeplink' || (launch === 'auto' && registered && cwdAllowed && promptFits)
                    ? null
                    : await resolveCli();
                const route = pickClaudeCliRoute({ launch, handlerRegistered: registered, cliAvailable: command !== null, cwdAllowed, promptFits });
                if (route.route === 'unavailable')
                    throw new Error(claudeCliUnavailableMessage(route.reason, cwd));
                if (route.route === 'deeplink') {
                    if (route.pointer)
                        handoff.toPointer();
                    // The pointer still repeats the intent; cut that copy (the file has it all) before giving up.
                    if (!handoff.fitIntent(fits))
                        throw new Error(`The prompt is too long for claude-cli:// even as a file pointer (limit ${CLAUDE_CLI_QUERY_LIMIT} characters). Set agents.claudeCli.launch to "terminal".`);
                    await deps.open(config, buildClaudeCliDeepLink({ cwd, prompt: handoff.state.prompt }));
                    push('completed', 'Claude Code CLI opened with the prompt prefilled');
                    return {
                        ok: true,
                        agent: 'claude-cli',
                        requestId: request.id,
                        events,
                        output: `Opened Claude Code CLI via claude-cli:// with the prompt prefilled — press Enter in the terminal to send.${handoff.note()}`,
                        writtenPromptPath: handoff.state.writtenPromptPath,
                    };
                }
                // `pickClaudeCliRoute` only returns `terminal` when the probe found a CLI.
                if (!command)
                    throw new Error(claudeCliUnavailableMessage('cli', cwd));
                if (shouldWriteLauncherPromptFile(config, handoff.state.prompt))
                    handoff.toPointer();
                const { launchPath, promptPath } = writeLaunchFiles({
                    request,
                    context,
                    tag: 'claude',
                    prompt: handoff.state.prompt,
                    platform: deps.platform,
                    buildScript: (promptFile) => buildLauncherFile({
                        command,
                        cwd,
                        promptPath: promptFile,
                        args: claudeCliLauncherArgs(config.permissionMode),
                    }, deps.platform),
                });
                push('file-change', `Wrote launcher ${launchPath}`);
                await deps.open(config, launchPath);
                push('completed', 'Claude Code CLI opened and the prompt was submitted');
                return {
                    ok: true,
                    agent: 'claude-cli',
                    requestId: request.id,
                    events,
                    output: `Opened Claude Code CLI in Terminal and submitted the prompt (${promptPath}).${handoff.note()}`,
                    writtenPromptPath: handoff.state.writtenPromptPath ?? promptPath,
                };
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                push('failed', error);
                return { ok: false, agent: 'claude-cli', requestId: request.id, events, error };
            }
        },
    };
}
