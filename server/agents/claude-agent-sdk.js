const PACKAGE = '@anthropic-ai/claude-agent-sdk';
async function importSdk() {
    try {
        return await import(/* @vite-ignore */ PACKAGE);
    }
    catch {
        return null;
    }
}
/** Convert an SDK message object into our event shape. */
export function normalizeClaudeSdkMessage(message) {
    const obj = (message ?? {});
    const type = String(obj.type ?? 'message');
    if (type === 'system') {
        return { type: 'started', text: `system: ${String(obj.subtype ?? 'init')}`, raw: obj };
    }
    if (type === 'result') {
        const isError = obj.is_error === true || String(obj.subtype ?? '').includes('error');
        return {
            type: isError ? 'failed' : 'completed',
            text: typeof obj.result === 'string' ? obj.result : undefined,
            raw: obj,
        };
    }
    if (type === 'assistant' || type === 'user') {
        const message_ = obj.message;
        return { type: 'message', text: extractText(message_?.content), raw: obj };
    }
    return { type: 'message', raw: obj };
}
function extractText(content) {
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
            if (part && typeof part === 'object') {
                const p = part;
                if (p.type === 'text' && typeof p.text === 'string')
                    return p.text;
                if (p.type === 'tool_use')
                    return `[tool_use: ${String(p.name)}]`;
            }
            return '';
        })
            .filter(Boolean)
            .join('\n');
    }
    return undefined;
}
function extractSessionId(message) {
    const obj = (message ?? {});
    if (typeof obj.session_id === 'string')
        return obj.session_id;
    return undefined;
}
export function createClaudeAgentSdkAdapter(config) {
    return {
        name: 'claude-agent-sdk',
        async isAvailable() {
            const mod = await importSdk();
            if (!mod) {
                return { available: false, reason: `Install ${PACKAGE} to use the Claude Agent SDK adapter` };
            }
            if (typeof mod.query !== 'function') {
                return { available: false, reason: `${PACKAGE} did not export "query"` };
            }
            return { available: true };
        },
        async send(request, context) {
            const mod = await importSdk();
            if (!mod || typeof mod.query !== 'function') {
                return {
                    ok: false,
                    agent: 'claude-agent-sdk',
                    requestId: request.id,
                    error: `Install ${PACKAGE} to use the Claude Agent SDK adapter`,
                };
            }
            const stored = context.sessionStore.get('claudeAgentSdk.lastSessionId');
            const resume = config.sessionId ?? (config.resumeLastSession && request.resume ? stored : undefined);
            const options = {
                cwd: context.projectRoot,
                allowedTools: config.allowedTools ?? ['Read', 'Edit', 'Bash', 'Glob', 'Grep'],
                permissionMode: request.applyMode === 'prompt-only'
                    ? 'plan'
                    : config.permissionMode ?? 'acceptEdits',
                resume,
                pathToClaudeCodeExecutable: config.pathToClaudeCodeExecutable,
                settingSources: config.settingSources,
            };
            const events = [];
            let sessionId = resume;
            let finalText;
            try {
                context.emit({ type: 'started', text: resume ? `Resuming session ${resume}` : 'Starting Claude Agent SDK query' });
                for await (const message of mod.query({ prompt: context.prompt, options })) {
                    const sid = extractSessionId(message);
                    if (sid)
                        sessionId = sid;
                    const event = normalizeClaudeSdkMessage(message);
                    if (event.type === 'completed' && event.text)
                        finalText = event.text;
                    events.push(event);
                    context.emit(event);
                    context.logger.audit({
                        kind: 'claude-agent-sdk-message',
                        requestId: request.id,
                        messageType: event.type,
                    });
                }
                if (sessionId) {
                    context.sessionStore.set('claudeAgentSdk.lastSessionId', sessionId);
                }
                return {
                    ok: true,
                    agent: 'claude-agent-sdk',
                    requestId: request.id,
                    sessionId,
                    output: finalText,
                    events,
                };
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                context.emit({ type: 'failed', text: error });
                return {
                    ok: false,
                    agent: 'claude-agent-sdk',
                    requestId: request.id,
                    sessionId,
                    events,
                    error,
                };
            }
        },
    };
}
