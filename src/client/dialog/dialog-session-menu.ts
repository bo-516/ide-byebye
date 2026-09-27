import { el, placeDropdownPanel } from './dialog-utils.js';
import { getLocale, t } from '../lib/i18n.js';
import { deliveryCopyKey, sessionMenuRow } from './dialog-session-model.js';

/**
 * Fill an existing session menu element.
 *
 * Boundary: does not fetch or store targets. `hooks.onChoose` is not called for disabled rows. The first button is
 * always "new session" so keyboard index 0 matches {@link applySessionMenuKey}. The required menu must already be
 * attached; a missing or invalid node cannot be rendered. Placement follows the supplied caret after every render,
 * including loading and refresh results, so each row of agent buttons opens its menu beside its own trigger.
 *
 * @param {HTMLElement} menuEl Menu node already attached to the dialog.
 * @param {{ name: string, label: string }} action Agent the menu belongs to.
 * @param {{ loading?: boolean, error?: string, overlay?: boolean, res?: Record<string, unknown> }} view Fetch state.
 *        `overlay` keeps `res.sessions` on screen and covers them instead of replacing the list with a loading note.
 * @param {{ busy?: boolean, selectedId?: string, onRefresh: Function, onNew: Function, onChoose: Function }} hooks Actions.
 * @param {HTMLElement | null} anchor Open caret; omitted/null leaves placement to the caller. A wrong node misanchors the menu.
 * @returns {{ rows: Array<Record<string, unknown>>, buttons: HTMLButtonElement[] }} Rows in keyboard order (index 0 is new).
 */
export function fillSessionMenu(menuEl, action, view, hooks, anchor = null) {
    const scrollTop = menuEl.scrollTop;
    menuEl.hidden = false;
    menuEl.replaceChildren();
    const head = el('div', 'cii-session-menu-head');
    const hint = view.res?.delivery ? t(deliveryCopyKey(view.res.delivery)) : '';
    const titleText = hint
        ? `${t('session.menu.title', { label: action.label })} · ${hint}`
        : t('session.menu.title', { label: action.label });
    const refresh = el('button', 'cii-session-refresh', '⟳');
    refresh.type = 'button';
    refresh.title = t('session.menu.refresh');
    if (view.loading)
        refresh.classList.add('cii-session-refreshing');
    refresh.addEventListener('click', () => hooks.onRefresh());
    head.append(el('div', 'cii-session-menu-title', titleText), refresh);
    menuEl.append(head);
    const fresh = el('button', 'cii-session-new', `＋ ${t('session.menu.new')}`);
    fresh.type = 'button';
    fresh.addEventListener('click', () => hooks.onNew());
    menuEl.append(fresh);
    const buttons = [fresh];
    const sessions = Array.isArray(view.res?.sessions) ? view.res.sessions : [];
    const rows = sessions.map((session) => sessionMenuRow(session, Date.now(), getLocale()));
    const list = el('div', 'cii-session-menu-list');
    // A refresh already has rows: cover them. Replacing the list with a one-line note changes the menu height.
    if (view.loading && !rows.length)
        list.append(el('div', 'cii-session-note', t('session.menu.loading')));
    else if (view.error && !rows.length) {
        list.append(el('div', 'cii-session-note', t('session.menu.error', { reason: view.error })));
        const retry = el('button', 'cii-session-retry', t('session.menu.retry'));
        retry.type = 'button';
        retry.addEventListener('click', () => hooks.onRefresh());
        list.append(retry);
    }
    else if (!rows.length) {
        const notice = view.res?.notice === 'ide-not-running'
            ? t('session.notice.ideNotRunning')
            : view.res?.notice === 'unsupported-format'
                ? t('session.notice.unsupportedFormat', { label: action.label })
                : t('session.menu.empty', { label: action.label });
        list.append(el('div', 'cii-session-empty', notice));
    }
    rows.forEach((row, index) => {
        const button = el('button', 'cii-session-row');
        button.type = 'button';
        button.disabled = row.disabled || hooks.busy === true;
        if (row.reasonKey)
            button.title = t(row.reasonKey);
        const markerClass = row.statusKey === 'session.status.working'
            ? 'cii-session-marker-working'
            : row.statusKey === 'session.status.waiting'
                ? 'cii-session-marker-waiting'
                : 'cii-session-marker-idle';
        const mark = row.id === hooks.selectedId ? '✓ ' : '';
        const titleTextRow = row.untitled ? t('session.untitled') : row.title;
        const top = el('div', 'cii-session-row-title', `${mark}${row.marker} ${titleTextRow}`);
        top.classList.add(markerClass);
        const place = row.locationKey ? t(row.locationKey) : row.locationText;
        button.append(top, el('div', 'cii-session-row-meta', `${t(row.statusKey)} · ${place} · ${row.relativeTime}`));
        button.addEventListener('click', () => hooks.onChoose(sessions[index], row));
        list.append(button);
        buttons.push(button);
    });
    if (view.loading && rows.length) {
        const cover = el('div', 'cii-session-loading', t('session.menu.loading'));
        cover.setAttribute('aria-busy', 'true');
        list.append(cover);
    }
    else if (view.error && rows.length)
        list.append(el('div', 'cii-session-note', t('session.menu.error', { reason: view.error })));
    menuEl.append(list);
    if (anchor)
        placeDropdownPanel(anchor, menuEl);
    menuEl.scrollTop = scrollTop;
    return { rows, buttons };
}
