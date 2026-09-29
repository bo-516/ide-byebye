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
    /**
     * @param request Intent request. Only `id` is copied onto the result.
     * @param context Route context. `prompt` is the text the page copies; `emit` records the two status events.
     */
    async send(request: { id: string }, context: { emit: (event: { type: string, text?: string }) => void, prompt: string }) {
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
