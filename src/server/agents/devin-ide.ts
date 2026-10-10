import { createCascadeIdeAdapter } from './cascade-ide.js';
import { DEVIN_IDE_SPEC } from './cascade-ide-spec.js';

/**
 * Create the Devin Desktop IDE adapter.
 *
 * Boundary: opt-in (`agents.devinIde`). `devin-desktop` opens the project folder; the bridge extension
 * places the prompt in the Cascade composer via `devin.sendChatActionMessage` without submitting
 * (`submit: true` sends it as a new conversation instead).
 *
 * @param {Record<string, unknown>} config Devin IDE adapter options from plugin config.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter.
 */
export function createDevinIdeAdapter(config: Record<string, unknown> = {}) {
    return createCascadeIdeAdapter(DEVIN_IDE_SPEC, config);
}
