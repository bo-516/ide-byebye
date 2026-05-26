import { spawn } from 'node:child_process';
/**
 * Build the argv for the `claude` CLI. Pure and exported for unit testing.
 * Never interpolates user input into a shell string — values are passed as
 * discrete argv entries to `spawn`.
 */
export function buildClaudeArgs(config, prompt, mode, sessionId) {
    const args = [];
    if (mode === 'continue') {
        args.push('-c');
    }
    if (mode === 'resume' && sessionId) {
        args.push('-r', sessionId);
    }
    if (config.bare) {
        args.push('--bare');
    }
    args.push('-p', prompt);
    const outputFormat = config.outputFormat ?? 'stream-json';
    args.push('--output-format', outputFormat);
    // The CLI requires --verbose alongside stream-json in print mode.
    if (outputFormat === 'stream-json') {
        args.push('--verbose');
    }
    if (config.permissionMode) {
        args.push('--permission-mode', config.permissionMode);
    }
    if (config.allowedTools && config.allowedTools.length > 0) {
        args.push('--allowedTools', config.allowedTools.join(','));
    }
    return args;
}
function eventFromStreamJson(obj) {
    const type = obj.type;
    if (type === 'system') {
        return { type: 'started', text: `system: ${String(obj.subtype ?? 'init')}`, raw: obj };
    }
    if (type === 'assistant' || type === 'user') {
        const message = obj.message;
        return { type: 'message', text: extractText(message?.content), raw: obj };
    }
    if (type === 'result') {
        const isError = obj.is_error === true || obj.subtype === 'error';
        return {
            type: isError ? 'failed' : 'completed',
            text: typeof obj.result === 'string' ? obj.result : undefined,
            raw: obj,
        };
    }
    return { type: 'message', raw: obj };
}
function extractText(content) {
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
            if (typeof part === 'string')
                return part;
            if (part && typeof part === 'object' && 'text' in part) {
                return String(part.text);
            }
            return '';
        })
            .filter(Boolean)
            .join('\n');
    }
    return undefined;
}
function resolveMode(config, request, storedSessionId) {
    if (config.mode === 'resume') {
        return { mode: 'resume', sessionId: config.sessionId ?? storedSessionId };
    }
    if (config.mode === 'continue' || (request.resume && config.resumeLastSession !== false)) {
        return { mode: 'continue', sessionId: undefined };
    }
    if (config.resumeLastSession && storedSessionId) {
        return { mode: 'resume', sessionId: storedSessionId };
    }
    return { mode: 'new', sessionId: undefined };
}
export function createClaudeCliAdapter(config) {
    const command = config.command ?? 'claude';
    const timeoutMs = config.timeoutMs ?? 10 * 60 * 1000;
    return {
        name: 'claude-cli',
        async isAvailable() {
            return new Promise((resolve) => {
                try {
                    const child = spawn(command, ['--version'], { stdio: 'ignore' });
                    const timer = setTimeout(() => {
                        child.kill();
                        resolve({ available: false, reason: 'claude --version timed out' });
                    }, 5000);
                    child.on('error', (err) => {
                        clearTimeout(timer);
                        resolve({
                            available: false,
                            reason: err.code === 'ENOENT'
                                ? `"${command}" not found in PATH. Install the Claude Code CLI.`
                                : err.message,
                        });
                    });
                    child.on('close', (code) => {
                        clearTimeout(timer);
                        resolve(code === 0
                            ? { available: true }
                            : { available: false, reason: `claude --version exited with code ${code}` });
                    });
                }
                catch (err) {
                    resolve({ available: false, reason: err instanceof Error ? err.message : String(err) });
                }
            });
        },
        async send(request, context) {
            const stored = context.sessionStore.get('claudeCli.lastSessionId');
            const { mode, sessionId } = resolveMode(config, request, stored);
            const args = buildClaudeArgs(config, context.prompt, mode, sessionId);
            const outputFormat = config.outputFormat ?? 'stream-json';
            context.emit({ type: 'started', text: `claude ${redact(args)}` });
            return new Promise((resolve) => {
                const child = spawn(command, args, {
                    cwd: context.projectRoot,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    env: process.env,
                });
                const events = [];
                let stdoutBuf = '';
                let stderr = '';
                let capturedSessionId;
                let finalText;
                const emit = (event) => {
                    events.push(event);
                    context.emit(event);
                };
                const handleStreamLine = (line) => {
                    const trimmed = line.trim();
                    if (!trimmed)
                        return;
                    try {
                        const obj = JSON.parse(trimmed);
                        if (typeof obj.session_id === 'string')
                            capturedSessionId = obj.session_id;
                        const event = eventFromStreamJson(obj);
                        if (event.type === 'completed' && event.text)
                            finalText = event.text;
                        emit(event);
                    }
                    catch {
                        emit({ type: 'message', text: trimmed });
                    }
                };
                const timer = setTimeout(() => {
                    child.kill('SIGTERM');
                    finish(false, `claude CLI timed out after ${timeoutMs}ms`);
                }, timeoutMs);
                let settled = false;
                const finish = (ok, error) => {
                    if (settled)
                        return;
                    settled = true;
                    clearTimeout(timer);
                    if (capturedSessionId) {
                        context.sessionStore.set('claudeCli.lastSessionId', capturedSessionId);
                    }
                    resolve({
                        ok,
                        agent: 'claude-cli',
                        requestId: request.id,
                        sessionId: capturedSessionId,
                        output: (finalText ?? stdoutBuf.trim()) || undefined,
                        events,
                        error,
                    });
                };
                child.stdout.setEncoding('utf8');
                child.stdout.on('data', (chunk) => {
                    stdoutBuf += chunk;
                    if (outputFormat === 'stream-json') {
                        const lines = stdoutBuf.split('\n');
                        stdoutBuf = lines.pop() ?? '';
                        for (const line of lines)
                            handleStreamLine(line);
                    }
                });
                child.stderr.setEncoding('utf8');
                child.stderr.on('data', (chunk) => {
                    stderr += chunk;
                });
                child.on('error', (err) => {
                    const reason = err.code === 'ENOENT'
                        ? `"${command}" not found in PATH. Install the Claude Code CLI.`
                        : err.message;
                    emit({ type: 'failed', text: reason });
                    finish(false, reason);
                });
                child.on('close', (code) => {
                    // Flush any trailing stream-json line.
                    if (outputFormat === 'stream-json' && stdoutBuf.trim()) {
                        handleStreamLine(stdoutBuf);
                        stdoutBuf = '';
                    }
                    if (outputFormat === 'json') {
                        try {
                            const obj = JSON.parse(stdoutBuf);
                            if (typeof obj.session_id === 'string')
                                capturedSessionId = obj.session_id;
                            finalText = typeof obj.result === 'string' ? obj.result : undefined;
                            emit({ type: 'message', text: finalText, raw: obj });
                        }
                        catch (err) {
                            const reason = `Failed to parse claude JSON output: ${err instanceof Error ? err.message : String(err)}`;
                            emit({ type: 'failed', text: reason });
                            finish(false, reason);
                            return;
                        }
                    }
                    else if (outputFormat === 'text') {
                        finalText = stdoutBuf.trim();
                    }
                    if (code === 0) {
                        emit({ type: 'completed', text: finalText });
                        finish(true);
                    }
                    else {
                        const reason = stderr.trim() || `claude exited with code ${code}`;
                        emit({ type: 'failed', text: reason });
                        finish(false, reason);
                    }
                });
            });
        },
    };
}
/** Redact the prompt body from a logged argv. */
function redact(args) {
    const out = [];
    for (let i = 0; i < args.length; i += 1) {
        if (args[i] === '-p') {
            out.push('-p', '<prompt>');
            i += 1;
        }
        else {
            out.push(args[i]);
        }
    }
    return out.join(' ');
}
