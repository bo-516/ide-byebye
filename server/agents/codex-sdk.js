const PACKAGE = '@openai/codex-sdk';
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
    return items.map((item) => {
        const obj = (item ?? {});
        const kind = String(obj.type ?? obj.item_type ?? 'message');
        if (kind.includes('command') || kind.includes('tool')) {
            return { type: 'tool', text: stringifyItem(obj), raw: obj };
        }
        if (kind.includes('file') || kind.includes('patch') || kind.includes('diff')) {
            return { type: 'file-change', text: stringifyItem(obj), raw: obj };
        }
        return { type: 'message', text: stringifyItem(obj), raw: obj };
    });
}
function stringifyItem(obj) {
    if (typeof obj.text === 'string')
        return obj.text;
    if (typeof obj.message === 'string')
        return obj.message;
    if (obj.content != null)
        return typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content);
    return undefined;
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
                });
                const stored = context.sessionStore.get('codexSdk.lastThreadId');
                const threadId = resolveCodexSdkThreadId(config, request, stored);
                context.emit({
                    type: 'started',
                    text: threadId ? `Resuming Codex thread ${threadId}` : 'Starting new Codex thread',
                });
                const threadOptions = {
                    model: request.model ?? config.model,
                    sandboxMode: config.sandboxMode,
                    approvalPolicy: config.approvalPolicy,
                    workingDirectory: config.workingDirectory ?? context.projectRoot,
                    skipGitRepoCheck: config.skipGitRepoCheck,
                };
                const thread = threadId && typeof codex.resumeThread === 'function'
                    ? codex.resumeThread(threadId, threadOptions)
                    : codex.startThread(threadOptions);
                const startedAt = Date.now();
                const turn = await thread.run(context.prompt);
                const metrics = extractCodexMetrics(turn, startedAt, Date.now());
                const resolvedThreadId = thread.id ?? turn?.threadId;
                if (resolvedThreadId) {
                    context.sessionStore.set('codexSdk.lastThreadId', resolvedThreadId);
                    context.sessionStore.set(`codexSdk.threadsByProject.${encodeKey(context.projectRoot)}`, resolvedThreadId);
                }
                const events = normalizeCodexItems(turn?.items);
                for (const event of events)
                    context.emit(event);
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
