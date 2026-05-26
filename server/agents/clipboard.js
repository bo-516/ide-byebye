/**
 * The clipboard adapter never touches the filesystem. It returns the prompt so
 * the browser can copy it via `navigator.clipboard.writeText`. Always
 * available; the safe MVP fallback.
 */
export const clipboardAdapter = {
    name: 'clipboard',
    async isAvailable() {
        return { available: true };
    },
    async send(request, context) {
        context.emit({ type: 'started', text: 'Generating prompt for clipboard' });
        context.emit({ type: 'completed', text: 'Prompt ready to copy' });
        return {
            ok: true,
            agent: 'clipboard',
            requestId: request.id,
            output: context.prompt,
        };
    },
};
