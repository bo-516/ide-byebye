import { createCascadeIdeAdapter } from './cascade-ide.js';
import { WINDSURF_IDE_SPEC } from './cascade-ide-spec.js';

/**
 * Create the Windsurf IDE adapter (pre-merge standalone Windsurf).
 *
 * Boundary: opt-in (`agents.windsurfIde`). `windsurf` opens the project folder; the bridge extension
 * places the prompt in the Cascade composer via `windsurf.sendChatActionMessage` without submitting
 * (`submit: true` sends it as a new conversation instead).
 *
 * @param {Record<string, unknown>} config Windsurf IDE adapter options from plugin config.
 * @returns {{ name: string, isAvailable: Function, send: Function }} Agent adapter.
 */
export function createWindsurfIdeAdapter(config: Record<string, unknown> = {}) {
    return createCascadeIdeAdapter(WINDSURF_IDE_SPEC, config);
}
