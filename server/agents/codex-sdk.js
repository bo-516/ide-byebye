const PACKAGE = '@openai/codex-sdk';

/**
 * Build the nested Codex SDK runtime config.
 *
 * Boundary: adapter-level `config.config` may contain SDK-specific options from
 * the host project; this helper preserves those options while forcing raw agent
 * reasoning on for the dock stream. Passing a non-object config drops the
 * caller's nested SDK options, and omitting the return value prevents native
 * reasoning events from being exposed by the SDK.
 *
 * @param {Record<string, unknown>} config Adapter config supplied from plugin options.
 * @returns {Record<string, unknown>} SDK `config` object passed to `new Codex`.
 */
function buildCodexRuntimeConfig(config) {
    const sdkConfig = config?.config && typeof config.config === 'object' && !Array.isArray(config.config)
        ? config.config
        : {};
    return { ...sdkConfig, show_raw_agent_reasoning: true };
}

async function importCodex() {
    try {
        // Dynamic import keeps the SDK an optional dependency.
        return await import(/* @vite-ignore */ PACKAGE);
    }
    catch {
        return null;
    }
}

export function resolveCodexSdkThreadId(config, request, storedThreadId) {
    if (request?.newThread === true)
        return undefined;
    const explicitThreadId = typeof request?.threadId === 'string' && request.threadId
        ? request.threadId
        : undefined;
    return explicitThreadId ??
        config.threadId ??
        (config.resumeLastThread && request?.resume ? storedThreadId : undefined);
}

/** Normalize Codex turn items into our event shape. */
export function normalizeCodexItems(items) {
    if (!Array.isArray(items))
        return [];
    return items.map((item) => normalizeCodexItem(item));
}

function normalizeCodexItem(item, eventType = '') {
    const obj = (item ?? {});
    const kind = String(obj.type ?? obj.item_type ?? 'message');
    if (kind === 'reasoning') {
        return { type: 'reasoning', text: stringifyItem(obj), raw: { eventType, item: obj } };
    }
    if (kind === 'agent_message') {
        return { type: 'assistant', text: stringifyItem(obj), raw: { eventType, item: obj } };
    }
    if (kind === 'error') {
        return { type: 'failed', text: stringifyItem(obj), raw: { eventType, item: obj } };
    }
    if (kind.includes('command') || kind.includes('tool') || kind.includes('web_search')) {
        return { type: 'tool', text: stringifyItem(obj), raw: { eventType, item: obj } };
    }
    if (kind.includes('file') || kind.includes('patch') || kind.includes('diff')) {
        return { type: 'file-change', text: stringifyItem(obj), raw: { eventType, item: obj } };
    }
    return { type: 'message', text: stringifyItem(obj), raw: { eventType, item: obj } };
}

/**
 * Normalize one streamed Codex SDK event into the dock's portable event shape.
 *
 * Boundary: the SDK emits structured thread events; this function exposes only public progress summaries, tool/file
 * activity, and final/error messages for UI rendering.
 *
 * @param {Record<string, unknown>} event Raw Codex SDK stream event.
 * @returns {{ type: string, text?: string, raw: unknown }} Normalized inspector event.
 */
export function normalizeCodexThreadEvent(event) {
    const obj = (event ?? {});
    const type = String(obj.type ?? '');
    if (type === 'thread.started') {
        return { type: 'started', text: `Started Codex thread ${obj.thread_id}`, raw: obj };
    }
    if (type === 'turn.started') {
        return { type: 'started', text: 'Codex is working', raw: obj };
    }
    if (type === 'background_event') {
        return { type: 'message', text: obj.message ?? obj.text ?? 'Background progress', raw: obj };
    }
    if (type === 'turn.completed') {
        return { type: 'completed', text: 'Turn completed', raw: obj };
    }
    if (type === 'turn.failed') {
        return { type: 'failed', text: obj.error?.message ?? 'Turn failed', raw: obj };
    }
    if (type === 'error') {
        return { type: 'failed', text: obj.message ?? 'Codex stream failed', raw: obj };
    }
    if ((type === 'item.started' || type === 'item.updated' || type === 'item.completed') && obj.item) {
        return normalizeCodexItem(obj.item, type);
    }
    return { type: 'message', text: type || undefined, raw: obj };
}

function stringifyItem(obj) {
    if (typeof obj.text === 'string')
        return obj.text;
    if (typeof obj.message === 'string')
        return obj.message;
    if (typeof obj.query === 'string')
        return `Search: ${obj.query}`;
    if (typeof obj.command === 'string') {
        const output = typeof obj.aggregated_output === 'string'
            ? obj.aggregated_output.trimEnd()
            : typeof obj.aggregatedOutput === 'string'
                ? obj.aggregatedOutput.trimEnd()
                : '';
        return output ? `$ ${obj.command}\n${output}` : `$ ${obj.command}`;
    }
    if (Array.isArray(obj.changes)) {
        return obj.changes
            .map((change) => {
            const next = change ?? {};
            const kind = typeof next.kind === 'string' ? next.kind : 'change';
            return typeof next.path === 'string' ? `${kind}: ${next.path}` : kind;
        })
            .filter(Boolean)
            .join('\n');
    }
    if (Array.isArray(obj.items)) {
        return obj.items
            .map((item) => {
            const text = typeof item?.text === 'string' ? item.text : '';
            if (!text)
                return '';
            return `${item.completed ? '✓' : '○'} ${text}`;
        })
            .filter(Boolean)
            .join('\n');
    }
    if (typeof obj.server === 'string' && typeof obj.tool === 'string') {
        const title = `${obj.server}.${obj.tool}`;
        const error = obj.error?.message;
        if (typeof error === 'string')
            return `${title}\n${error}`;
        return title;
    }
    if (obj.content != null)
        return typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content);
    if (obj.error?.message)
        return String(obj.error.message);
    return undefined;
}

/**
 * Track the latest version of a streamed SDK item.
 *
 * Boundary: missing item ids are ignored because they cannot be correlated across `item.updated` events.
 *
 * @param {Map<string, Record<string, unknown>>} itemsById Latest streamed items by SDK id.
 * @param {Record<string, unknown>} item Raw SDK item from a stream event.
 * @returns {void}
 */
function upsertItem(itemsById, item) {
    const obj = item ?? {};
    const id = typeof obj.id === 'string' && obj.id ? obj.id : undefined;
    if (!id)
        return;
    itemsById.set(id, obj);
}

function numberFrom(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
}

function pickNumber(sources, keys) {
    for (const source of sources) {
        if (!source || typeof source !== 'object')
            continue;
        for (const key of keys) {
            const value = numberFrom(source[key]);
            if (value != null)
                return value;
        }
    }
    return undefined;
}

function roundMetric(value) {
    if (!Number.isFinite(value))
        return undefined;
    return Math.round(value * 10) / 10;
}

/**
 * Extract portable usage metrics from the SDK result.
 *
 * Boundary: Codex SDK versions may rename usage fields. This helper accepts
 * common camelCase/snake_case shapes and falls back to elapsed wall time for
 * a coarse tokens/s value when only token counts are present.
 */
export function extractCodexMetrics(turn, startedAt, finishedAt) {
    const usage = turn?.usage;
    const metrics = turn?.metrics;
    const tokenUsage = turn?.tokenUsage ?? turn?.token_usage;
    const context = turn?.context;
    const sources = [turn, usage, metrics, tokenUsage, context];
    const inputTokens = pickNumber(sources, ['inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens']);
    const outputTokens = pickNumber(sources, ['outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens']);
    const explicitTotal = pickNumber(sources, ['totalTokens', 'total_tokens', 'tokensUsed', 'tokens_used', 'contextTokens', 'context_tokens']);
    const tokensUsed = explicitTotal ?? ((inputTokens ?? 0) + (outputTokens ?? 0) || undefined);
    const contextWindow = pickNumber(sources, ['contextWindow', 'context_window', 'maxContextTokens', 'max_context_tokens', 'contextLimit', 'context_limit']);
    let contextPercent = pickNumber(sources, ['contextPercent', 'context_percent', 'contextUsedPercent', 'context_used_percent', 'percentUsed', 'percent_used']);
    if (contextPercent != null && contextPercent <= 1)
        contextPercent *= 100;
    if (contextPercent == null && tokensUsed != null && contextWindow) {
        contextPercent = (tokensUsed / contextWindow) * 100;
    }
    const directRate = pickNumber(sources, ['tokensPerSecond', 'tokens_per_second', 'tokenRate', 'token_rate']);
    const elapsedSeconds = Math.max(0, (Number(finishedAt) - Number(startedAt)) / 1000);
    const tokensPerSecond = directRate ?? (tokensUsed != null && elapsedSeconds > 0 ? tokensUsed / elapsedSeconds : undefined);
    return {
        tokensPerSecond: roundMetric(tokensPerSecond),
        contextPercent: roundMetric(contextPercent),
        tokensUsed: tokensUsed != null ? Math.round(tokensUsed) : undefined,
        contextWindow: contextWindow != null ? Math.round(contextWindow) : undefined,
    };
}

/**
 * Create the Codex SDK-backed agent adapter.
 *
 * Boundary: the adapter assumes an enabled Codex SDK config object and a
 * session store supplied by the route context. Passing an importer that does
 * not expose `Codex` makes availability and sends fail gracefully; passing
 * malformed runtime config may prevent SDK construction before any thread is
 * started.
 *
 * @param {Record<string, unknown>} config Adapter options from `agents.codexSdk`.
 * @param {() => Promise<Record<string, unknown> | null>} importCodexImpl Optional SDK importer for tests.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter used by the registry.
 */
export function createCodexSdkAdapter(config, importCodexImpl = importCodex) {
    return {
        name: 'codex-sdk',
        async isAvailable() {
            const mod = await importCodexImpl();
            if (!mod) {
                return { available: false, reason: `Install ${PACKAGE} to use the Codex SDK adapter` };
            }
            if (!mod.Codex) {
                return { available: false, reason: `${PACKAGE} did not export "Codex"` };
            }
            return { available: true };
        },
        async send(request, context) {
            const mod = await importCodexImpl();
            if (!mod || !mod.Codex) {
                return {
                    ok: false,
                    agent: 'codex-sdk',
                    requestId: request.id,
                    error: `Install ${PACKAGE} to use the Codex SDK adapter`,
                };
            }
            try {
                const codex = new mod.Codex({
                    apiKey: config.apiKey,
                    codexPathOverride: config.codexPathOverride,
                    config: buildCodexRuntimeConfig(config),
                });
                const stored = context.sessionStore.get('codexSdk.lastThreadId');
                const threadId = resolveCodexSdkThreadId(config, request, stored);
                context.emit({
                    type: 'started',
                    text: threadId ? `Resuming Codex thread ${threadId}` : 'Starting new Codex thread',
                });
                const threadOptions = {
                    model: request.model ?? config.model,
                    modelReasoningEffort: request.reasoningEffort ?? config.reasoningEffort,
                    sandboxMode: config.sandboxMode,
                    approvalPolicy: config.approvalPolicy,
                    workingDirectory: config.workingDirectory ?? context.projectRoot,
                    skipGitRepoCheck: config.skipGitRepoCheck,
                };
                const thread = threadId && typeof codex.resumeThread === 'function'
                    ? codex.resumeThread(threadId, threadOptions)
                    : codex.startThread(threadOptions);
                const startedAt = Date.now();
                let turn;
                let emittedStreamEvents = false;
                if (typeof thread.runStreamed === 'function') {
                    const itemsById = new Map();
                    let finalResponse = '';
                    let usage = null;
                    const streamed = await thread.runStreamed(context.prompt, { signal: context.signal });
                    for await (const event of streamed.events) {
                        if (event?.type === 'item.started' || event?.type === 'item.updated' || event?.type === 'item.completed') {
                            upsertItem(itemsById, event.item);
                            if (event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
                                finalResponse = event.item.text;
                            }
                        }
                        else if (event?.type === 'turn.completed') {
                            usage = event.usage ?? null;
                        }
                        const normalized = normalizeCodexThreadEvent(event);
                        if (normalized?.text) {
                            emittedStreamEvents = true;
                            context.emit(normalized);
                        }
                        if (event?.type === 'turn.failed') {
                            throw new Error(event.error?.message ?? 'Codex turn failed');
                        }
                    }
                    turn = { items: [...itemsById.values()], finalResponse, usage };
                }
                else {
                    turn = await thread.run(context.prompt);
                }
                const metrics = extractCodexMetrics(turn, startedAt, Date.now());
                const resolvedThreadId = thread.id ?? turn?.threadId;
                if (resolvedThreadId) {
                    context.sessionStore.set('codexSdk.lastThreadId', resolvedThreadId);
                    context.sessionStore.set(`codexSdk.threadsByProject.${encodeKey(context.projectRoot)}`, resolvedThreadId);
                }
                const events = normalizeCodexItems(turn?.items);
                if (!emittedStreamEvents) {
                    for (const event of events)
                        context.emit(event);
                }
                context.emit({ type: 'completed', text: turn?.finalResponse });
                return {
                    ok: true,
                    agent: 'codex-sdk',
                    requestId: request.id,
                    threadId: resolvedThreadId,
                    output: turn?.finalResponse,
                    events,
                    metrics,
                };
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                context.emit({ type: 'failed', text: error });
                return { ok: false, agent: 'codex-sdk', requestId: request.id, error };
            }
        },
    };
}
function encodeKey(value) {
    return value.replace(/\./g, '_');
}
