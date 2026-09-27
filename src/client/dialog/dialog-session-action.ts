import { el } from './dialog-utils.js';

/** Session support before discovery; opt-in adapters stay hidden until the server advertises them. */
const DEFAULT_SESSION_AGENTS = new Set(['codex-app', 'grok-build']);

/**
 * Create one app action and its session-menu trigger without owning dialog state.
 * Boundary: the caller stores the returned nodes and owns sending, menu state, and later availability updates.
 * @param {{ name: string, label: string, title: string }} action Required configured agent; invalid data mislabels dispatch.
 * @param {HTMLElement} container Live action grid; a missing container cannot receive the control.
 * @param {(name: string) => void} onSend Required handoff callback, invoked only by the main button.
 * @param {(caret: HTMLButtonElement) => void} onMenu Required menu callback, given the actual clicked trigger for positioning.
 * @returns {{ root: HTMLElement, button: HTMLButtonElement, caret: HTMLButtonElement, dot: HTMLElement, action: object }} Split nodes.
 */
export function createSessionAction(action, container, onSend, onMenu) {
    const root = el('div', 'cii-agent-split');
    const button = el('button', 'cii-btn cii-btn-primary cii-agent-action', action.label);
    button.type = 'button';
    button.title = action.title;
    button.addEventListener('click', () => onSend(action.name));
    const caret = el('button', 'cii-session-caret');
    caret.type = 'button';
    caret.append(document.createTextNode('▾'));
    const dot = el('span', 'cii-session-dot');
    dot.hidden = true;
    caret.append(dot);
    const show = DEFAULT_SESSION_AGENTS.has(action.name);
    caret.hidden = !show;
    root.classList.toggle('cii-agent-split-on', show);
    caret.addEventListener('click', () => onMenu(caret));
    root.append(button, caret);
    container.append(root);
    return { root, button, caret, dot, action };
}
