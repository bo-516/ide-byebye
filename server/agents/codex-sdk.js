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
export function createCodexSdkAdapter(config) {
    return {
        name: 'codex-sdk',
        async isAvailable() {
            const mod = await importCodex();
            if (!mod) {
                return { available: false, reason: `Install ${PACKAGE} to use the Codex SDK adapter` };
            }
            if (!mod.Codex) {
                return { available: false, reason: `${PACKAGE} did not export "Codex"` };
            }
            return { available: true };
        },
        async send(request, context) {
            const mod = await importCodex();
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
                const threadId = config.threadId ?? (config.resumeLastThread && request.resume ? stored : undefined);
                context.emit({
                    type: 'started',
                    text: threadId ? `Resuming Codex thread ${threadId}` : 'Starting new Codex thread',
                });
                const threadOptions = {
                    model: config.model,
                    sandboxMode: config.sandboxMode,
                    approvalPolicy: config.approvalPolicy,
                    workingDirectory: config.workingDirectory ?? context.projectRoot,
                    skipGitRepoCheck: config.skipGitRepoCheck,
                };
                const thread = threadId && typeof codex.resumeThread === 'function'
                    ? codex.resumeThread(threadId, threadOptions)
                    : codex.startThread(threadOptions);
                const turn = await thread.run(context.prompt);
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
