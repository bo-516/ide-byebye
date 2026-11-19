import fs from 'node:fs';
import os from 'node:os';
import { probeCommandVersion, resolveFirstCommand } from './launch-files.js';
import { readPositiveLimit } from './launch-prompt.js';
import { openTarget } from './opener.js';
import { createPromptHandoff, type HandoffPromptRequest } from './prompt-handoff.js';
import type { AgentEmitEvent } from './types.js';
import {
    buildTraeAppDeepLink,
    DEFAULT_TRAE_PROMPT_URL_LIMIT,
    normalizeTraeScheme,
    readTraeEdition,
    TRAE_APP_NOT_FOUND,
    TRAE_SCHEME_CN,
    TRAE_SCHEME_INTL,
    TRAE_URI_QUERY_LIMIT,
    traeAppCandidates,
} from './trae-route.js';

/** Side effects of the TRAE IDE adapter; replaceable in tests so nothing is probed or opened on the host. */
export interface TraeAppDeps {
    platform: string;
    homedir: string;
    env: NodeJS.ProcessEnv;
    exists: (file: string) => boolean;
    probe: (command: string) => Promise<boolean>;
    open: (config: Record<string, unknown>, target: string) => Promise<void>;
}

/** Route context read by {@link createTraeAppAdapter}. */
interface TraeAppContext {
    emit: (event: AgentEmitEvent) => void;
    outputDir: string;
    projectRoot: string;
    prompt: string;
}

/**
 * Production side effects for {@link createTraeAppAdapter}.
 *
 * @returns {TraeAppDeps} Default host dependencies.
 */
function defaultDeps(): TraeAppDeps {
    return {
        platform: process.platform,
        homedir: os.homedir(),
        env: process.env,
        exists: fs.existsSync,
        probe: (command) => probeCommandVersion(command),
        open: (config, target) => openTarget(config, target),
    };
}

/**
 * Linux / non-bundle fallback: probe `trae` / `trae-cn` IDE CLIs on PATH to determine scheme and availability.
 *
 * @param {'auto' | 'cn' | 'intl'} edition Configured edition filter.
 * @param {(command: string) => Promise<boolean>} probe `--version` probe.
 * @returns {Promise<string | null>} Detected URL scheme (`trae` or `trae-cn`), or null.
 */
async function resolvePathIdeScheme(
    edition: 'auto' | 'cn' | 'intl',
    probe: (command: string) => Promise<boolean>,
): Promise<string | null> {
    if (edition === 'cn')
        return resolveFirstCommand([TRAE_SCHEME_CN], probe);
    if (edition === 'intl')
        return resolveFirstCommand([TRAE_SCHEME_INTL], probe);
    return resolveFirstCommand([TRAE_SCHEME_INTL, TRAE_SCHEME_CN], probe);
}

/**
 * Create the TRAE IDE deeplink adapter (`trae-app`).
 *
 * Boundary: opens `<scheme>://trae.ai-ide/side-chat?query=…` (`trae` for global builds, `trae-cn` for domestic `Trae CN`
 * builds). TRAE's URI handler caps `query` at 2000 characters, so longer prompts automatically move to a Markdown
 * handoff file under `<outputDir>/requests/` and send a short file pointer instead of letting the IDE truncate text.
 *
 * @param {Record<string, unknown>} [config] `agents.traeApp` options.
 * @param {Partial<TraeAppDeps>} [overrides] Test seam overrides.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter.
 */
export function createTraeAppAdapter(
    config: Record<string, unknown> = {},
    overrides: Partial<TraeAppDeps> = {},
) {
    const deps: TraeAppDeps = { ...defaultDeps(), ...overrides };
    const edition = readTraeEdition(config.edition);
    const explicitScheme = typeof config.scheme === 'string' && config.scheme.trim()
        ? config.scheme.trim()
        : undefined;
    const resolveTargetScheme = async (): Promise<string | null> => {
        const bundle = traeAppCandidates(config, deps).find((item) => deps.exists(item.appPath));
        if (bundle)
            return normalizeTraeScheme(explicitScheme, bundle.scheme);
        if (explicitScheme && deps.platform !== 'darwin' && deps.platform !== 'win32')
            return normalizeTraeScheme(explicitScheme);
        const cliScheme = deps.platform !== 'darwin' && deps.platform !== 'win32'
            ? await resolvePathIdeScheme(edition, deps.probe)
            : null;
        return cliScheme ? normalizeTraeScheme(explicitScheme, cliScheme) : null;
    };

    return {
        name: 'trae-app',
        async isAvailable() {
            if (await resolveTargetScheme())
                return { available: true };
            return { available: false, reason: TRAE_APP_NOT_FOUND };
        },
        async send(request: HandoffPromptRequest, context: TraeAppContext) {
            const events: AgentEmitEvent[] = [];
            const push = (type: string, text: string) => {
                const event = { type, text };
                events.push(event);
                context.emit(event);
            };
            push('started', 'Opening TRAE');
            try {
                const scheme = await resolveTargetScheme();
                if (!scheme)
                    throw new Error(TRAE_APP_NOT_FOUND);
                const handoff = createPromptHandoff(request, context, config, push);
                const urlLimit = readPositiveLimit(config.promptUrlLimit, DEFAULT_TRAE_PROMPT_URL_LIMIT);
                const linkFor = (prompt: string) => buildTraeAppDeepLink({
                    scheme,
                    authority: config.authority,
                    route: config.route,
                    prompt,
                });
                const fits = (prompt: string) => prompt.length <= TRAE_URI_QUERY_LIMIT && linkFor(prompt).length <= urlLimit;
                if (config.promptMode === 'file' || !fits(handoff.state.prompt))
                    handoff.toPointer();
                if (!handoff.fitIntent(fits))
                    throw new Error(`The TRAE deeplink exceeds the URI limit (${TRAE_URI_QUERY_LIMIT} characters) even with the request moved to a file`);
                await deps.open(config, linkFor(handoff.state.prompt));
                push('completed', 'TRAE opened with the prompt prefilled');
                return {
                    ok: true,
                    agent: 'trae-app',
                    requestId: request.id,
                    events,
                    output: `Opened TRAE with the prompt prefilled in Side AI Chat.${handoff.note()}`,
                    writtenPromptPath: handoff.state.writtenPromptPath,
                };
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                push('failed', error);
                return { ok: false, agent: 'trae-app', requestId: request.id, events, error };
            }
        },
    };
}
