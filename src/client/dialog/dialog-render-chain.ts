import { el } from './dialog-utils.js';
import { basename, parseInspPathLite } from '../inspect/insp-path-lite.js';
import { t } from '../lib/i18n.js';

/**
 * The intent field's pinned row: the primary chip, and for a portal pick the mount chain around it.
 *
 * Purpose: an element picked inside `createPortal` / `<Teleport>` resolves to its own file; where it was mounted from
 * (the `renderChain` the picker attached, innermost first) shows as plain buttons beside the chip, and choosing one
 * makes it the primary target. Any other pick renders the chip alone, exactly as before.
 * Boundary: renders into the editor's `.cii-editor-pinned` node only and never resolves sources (the dialog does,
 * through `onSwitch`). Crumb labels come from the chain's own paths, so they need no server round trip.
 */

/** Selection fields the row reads. The index signature matches the dialog's `ElementSelection`. */
interface PinnedSelection {
    inspPath?: string;
    renderChain?: unknown;
    portal?: unknown;
    [key: string]: unknown;
}

/** Separator drawn between chain entries: inner ‹ outer. Decorative, hidden from assistive tech. */
const CHAIN_SEPARATOR = '‹';

/**
 * Mount chain of a selection: its `renderChain` when it is a portal pick with at least two entries.
 *
 * @param {PinnedSelection | null | undefined} selection Primary selection.
 * @returns {string[] | null} The entries, or `null` when the chip renders alone.
 */
function chainEntriesOf(selection: PinnedSelection | null | undefined): string[] | null {
    const chain = selection?.renderChain;
    if (selection?.portal !== true || !Array.isArray(chain) || chain.length < 2)
        return null;
    return chain.every((entry) => typeof entry === 'string' && entry) ? chain as string[] : null;
}

/**
 * Location of the element that was actually clicked: the first chain entry of a portal pick (the primary may have
 * been switched to a mount point since), else the selection's own `inspPath`.
 *
 * @param {PinnedSelection | null | undefined} selection Primary selection.
 * @returns {string | null} `data-insp-path`-shaped location, or `null` without a selection.
 */
export function pickedLocation(selection: PinnedSelection | null | undefined): string | null {
    return chainEntriesOf(selection)?.[0] ?? selection?.inspPath ?? null;
}

/**
 * One chain entry as a button: `App.tsx #24`, titled with the full path and tag.
 *
 * @param {string} entry Chain entry (`data-insp-path` form).
 * @param {(inspPath: string) => void} onSwitch Called with `entry` on click, Enter or Space.
 * @returns {HTMLButtonElement} The crumb.
 */
function createCrumb(entry: string, onSwitch: (inspPath: string) => void): HTMLButtonElement {
    const parsed = parseInspPathLite(entry);
    const line = parsed.line;
    const tag = /:\d+:\d+:([^:]+)$/.exec(entry)?.[1];
    const label = `${basename(parsed.file)}${line != null ? ` #${line}` : ''}`;
    const button: HTMLButtonElement = el('button', 'cii-chain-crumb', label);
    button.type = 'button';
    button.dataset.chainEntry = entry;
    button.title = `${parsed.file}${line != null ? `:${line}` : ''}${tag ? ` <${tag}>` : ''}`;
    button.setAttribute('aria-label', t('editor.renderChain.switch', { target: label }));
    // A mouse click keeps the caret in the intent editor; keyboard users focus the crumb itself.
    button.addEventListener('mousedown', (event: MouseEvent) => event.preventDefault());
    button.addEventListener('click', (event: MouseEvent) => {
        event.preventDefault();
        onSwitch(entry);
    });
    return button;
}

/**
 * Render the pinned row: hidden without a primary, the chip alone, or the chip in place among its chain's crumbs.
 *
 * Boundary: replaces the row's children on every call. A crumb that had keyboard focus keeps it across the re-render;
 * when that crumb's entry just became the chip, focus moves to the crumb of the entry it replaced, so Enter switches
 * straight back. No chain renders without `onSwitch` or when the current `inspPath` is not one of the entries.
 *
 * @param {HTMLElement} pinnedEl The editor's `.cii-editor-pinned` node.
 * @param {{ label: string, selection: PinnedSelection } | null} primary Primary label and selection; null hides the row.
 * @param {(label: string, inspPath?: string) => HTMLElement} createChip Builds the static primary chip.
 * @param {(inspPath: string) => void} [onSwitch] Makes a chain entry the primary. Omitted renders the chip alone.
 * @returns {void}
 */
export function renderPinnedRow(
    pinnedEl: HTMLElement,
    primary: { label: string; selection: PinnedSelection } | null,
    createChip: (label: string, inspPath?: string) => HTMLElement,
    onSwitch?: (inspPath: string) => void,
): void {
    const active = (pinnedEl.getRootNode() as { activeElement?: Element | null }).activeElement;
    const focusedEntry = active instanceof HTMLElement && pinnedEl.contains(active) ? active.dataset.chainEntry : undefined;
    const previous = pinnedEl.querySelector<HTMLElement>('.cii-mention')?.dataset.inspPath;
    const current = primary?.selection.inspPath;
    const entries = onSwitch && current ? chainEntriesOf(primary?.selection) : null;
    pinnedEl.innerHTML = '';
    pinnedEl.hidden = !primary;
    if (!primary)
        return;
    const chip = createChip(primary.label, current);
    chip.title = t('editor.primaryPinned.title', { target: current ?? primary.label });
    if (!entries || !onSwitch || !current || !entries.includes(current)) {
        pinnedEl.append(chip);
        return;
    }
    const row: HTMLElement = el('div', 'cii-chain');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', t('editor.renderChain.aria'));
    entries.forEach((entry, index) => {
        const item = entry === current ? chip : createCrumb(entry, onSwitch);
        if (index === 0) {
            row.append(item);
            return;
        }
        // Each separator travels with the entry after it, so a wrapped row never ends in a dangling `‹`.
        const link: HTMLElement = el('span', 'cii-chain-link');
        const separator: HTMLElement = el('span', 'cii-chain-sep', CHAIN_SEPARATOR);
        separator.setAttribute('aria-hidden', 'true');
        link.append(separator, item);
        row.append(link);
    });
    pinnedEl.append(row);
    const refocus = focusedEntry === current ? previous : focusedEntry;
    if (refocus)
        Array.from(row.querySelectorAll<HTMLElement>('.cii-chain-crumb')).find((crumb) => crumb.dataset.chainEntry === refocus)?.focus();
}
