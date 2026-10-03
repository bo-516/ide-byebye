import { writeHandoffPromptFile } from './launch-files.js';
import { buildAgentFilePrompt, buildAgentPrompt } from './launch-prompt.js';

/** The prompt a CLI agent will send, plus the handoff file once the full request has moved to disk. */
export interface PromptHandoffState {
    prompt: string;
    writtenPromptPath?: string;
}

/** Request fields used to build the prompt and to name the handoff file. */
export type HandoffPromptRequest = Parameters<typeof buildAgentPrompt>[0] & { id: string, createdAt: string | number | Date };

/**
 * Track one send's prompt and switch it to a file pointer at most once.
 *
 * Purpose: the deeplink and Terminal routes each have their own size limit, and `promptMode: "file"` forces the pointer
 * up front, so the decision can come at different points of a send. `toPointer` writes `requests/<stamp>-<id>.md` with
 * the full prompt, swaps `state.prompt` for the short pointer, and reports a `file-change` event; later calls do nothing.
 * Boundary: the request file must stay inside the project root ({@link writeHandoffPromptFile} throws otherwise).
 *
 * @param {HandoffPromptRequest} request Normalized intent request.
 * @param {{ outputDir: string, projectRoot: string }} context Where the handoff file goes.
 * @param {Record<string, unknown>} config Agent config (path style and `projectRoot` for both prompts).
 * @param {(type: string, text: string) => void} report Records a progress event.
 * @returns {{ state: PromptHandoffState, toPointer: () => void, fitIntent: (fits: (prompt: string) => boolean) => boolean,
 *          note: () => string }} Mutable state, the switch, the intent shortener, and the output suffix naming the
 *          handoff file (`''` before the switch).
 */
export function createPromptHandoff(
    request: HandoffPromptRequest,
    context: { outputDir: string, projectRoot: string },
    config: Record<string, unknown>,
    report: (type: string, text: string) => void,
) {
    const state: PromptHandoffState = { prompt: buildAgentPrompt(request, config) };
    return {
        state,
        toPointer() {
            if (state.writtenPromptPath)
                return;
            state.writtenPromptPath = writeHandoffPromptFile(request, { ...context, prompt: state.prompt });
            state.prompt = buildAgentFilePrompt(request, state.writtenPromptPath, config);
            report('file-change', `Wrote ${state.writtenPromptPath}`);
        },
        /**
         * Make the pointer prompt pass `fits` by cutting the intent's inline copy, keeping references and the file path.
         *
         * Boundary: only after {@link toPointer} — the full intent is in the file the pointer names, so the cut copy
         * ends with `…` and nothing is lost. Cuts fall on code-point boundaries, so no lone surrogate reaches an encoder.
         * Without a pointer this only reports whether the prompt fits.
         *
         * @param {(prompt: string) => boolean} fits The route's size check.
         * @returns {boolean} True when `state.prompt` now fits; false when even an empty intent does not.
         */
        fitIntent(fits: (prompt: string) => boolean) {
            const handoffPath = state.writtenPromptPath;
            if (fits(state.prompt))
                return true;
            if (!handoffPath)
                return false;
            const chars = Array.from(String(request.intent ?? '').trim());
            const build = (count: number) => buildAgentFilePrompt({ ...request, intent: count ? `${chars.slice(0, count).join('')}…` : '' }, handoffPath, config);
            if (!fits(build(0)))
                return false;
            // Invariant: build(low) fits and build(high) does not.
            let low = 0;
            let high = chars.length;
            while (high - low > 1) {
                const mid = Math.floor((low + high) / 2);
                if (fits(build(mid)))
                    low = mid;
                else
                    high = mid;
            }
            state.prompt = build(low);
            return true;
        },
        note() {
            return state.writtenPromptPath ? ` Full request context was written to ${state.writtenPromptPath}.` : '';
        },
    };
}
