import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { hasString, setLocale } from '../lib/i18n.js';
import {
    SESSION_COPY_KEYS,
    applySessionMenuKey,
    applySessionSendResult,
    formatSessionAge,
    payloadTargetId,
    readSessionTargets,
    sessionLoadingView,
    sessionMenuRow,
    withSessionTarget,
    writeSessionTargets,
    type SessionMenuState,
} from './dialog-session-model.js';

/** In-memory stand-in for the target map. Only the methods the model calls are implemented. */
function memoryStore() {
    const map = new Map<string, string>();
    return {
        // `!` erases. A stored entry is returned as-is; `?? null` would turn a stored undefined into null.
        getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
        setItem: (key: string, value: string) => { map.set(key, String(value)); },
        removeItem: (key: string) => { map.delete(key); },
    };
}

test('a refresh keeps the previous session list instead of collapsing to a loading note', () => {
    const previous = { sessions: [{ id: 'a', title: 'Buttons' }] };
    const again = sessionLoadingView(previous);
    assert.equal(again.overlay, true);
    assert.equal(again.res, previous);
    assert.deepEqual(sessionLoadingView(null), { loading: true });
    assert.deepEqual(sessionLoadingView({ sessions: [] }), { loading: true });
});

test('ArrowDown twice then Enter selects the second session; Escape closes the menu only', () => {
    const sessions = [
        { id: 'first', disabled: false },
        { id: 'second', disabled: false },
    ];
    let state: SessionMenuState = { open: true, index: 0, sessions };
    state = applySessionMenuKey(state, 'ArrowDown');
    state = applySessionMenuKey(state, 'ArrowDown');
    state = applySessionMenuKey(state, 'Enter');
    assert.equal(state.action, 'select');
    assert.equal(state.sessionId, 'second');
    const closed = applySessionMenuKey({ open: true, index: 1, sessions }, 'Escape');
    assert.equal(closed.action, 'close-menu');
    assert.equal(closed.open, false);
    assert.equal(closed.sessionId, undefined);
});

test('a stored target survives a fresh read and target-missing clears only that agent', () => {
    const store = memoryStore();
    writeSessionTargets(store, withSessionTarget({}, 'codex-app', { id: 'abc', title: 'Hello' }));
    writeSessionTargets(store, withSessionTarget(readSessionTargets(store), 'grok-build', { id: 'def', title: 'Grok' }));
    const fresh = readSessionTargets(store);
    assert.deepEqual(fresh['codex-app'], { id: 'abc', title: 'Hello' });
    const cleared = applySessionSendResult(fresh, 'codex-app', { code: 'target-missing' });
    assert.equal(cleared['codex-app'], undefined);
    assert.equal(cleared['grok-build'].id, 'def');
    const kept = applySessionSendResult(fresh, 'grok-build', { code: 'target-busy' });
    assert.equal(kept['grok-build'].id, 'def');
});

test('payload carries targetSessionId only for the agent that has a target', () => {
    const targets = {
        'codex-app': { id: 'aaa', title: 'A' },
        'grok-build': { id: 'bbb', title: 'B' },
    };
    assert.equal(payloadTargetId(targets, 'codex-app'), 'aaa');
    assert.equal(payloadTargetId(targets, 'cursor-app'), undefined);
    assert.equal(payloadTargetId({}, 'codex-app'), undefined);
});

test('ancestor locations show the directory name and relative time is stable', () => {
    const row = sessionMenuRow({
        id: '1',
        title: '',
        projectName: 'project',
        location: '..',
        status: 'idle',
        live: false,
        targetable: true,
        updatedAt: '2026-09-27T00:00:00.000Z',
    }, Date.parse('2026-09-27T00:03:00.000Z'), 'zh');
    assert.equal(row.locationText, 'project');
    assert.equal(row.statusKey, 'session.status.closed');
    assert.equal(row.marker, '○');
    const child = sessionMenuRow({
        id: '2',
        title: 'Buttons',
        projectName: 'ai-inspector',
        location: '.',
        status: 'working',
        live: true,
        targetable: true,
        updatedAt: '2026-09-27T00:00:00.000Z',
    }, Date.parse('2026-09-27T00:03:00.000Z'), 'zh');
    assert.equal(child.locationText, 'ai-inspector');
    assert.equal(child.marker, '●');
    assert.equal(formatSessionAge('2026-09-27T00:00:00.000Z', Date.parse('2026-09-27T00:03:00.000Z'), 'zh'), '3 分钟前');
    assert.equal(formatSessionAge('2026-09-27T00:00:00.000Z', Date.parse('2026-09-27T00:03:00.000Z'), 'en'), '3 min ago');
    assert.equal(formatSessionAge('2026-09-20T12:00:00.000Z', Date.parse('2026-09-27T12:00:00.000Z'), 'zh'), '09-20');
    const blocked = sessionMenuRow({
        id: '3',
        title: 'Open',
        projectName: 'app',
        location: '.',
        status: 'working',
        live: true,
        targetable: false,
        reason: 'open-in-terminal',
        updatedAt: '2026-09-27T00:00:00.000Z',
    });
    assert.equal(blocked.disabled, true);
    assert.equal(blocked.marker, '◌');
    assert.equal(blocked.reasonKey, 'session.reason.openInTerminal');
});

test('every session copy key exists in zh and en', () => {
    for (const key of SESSION_COPY_KEYS) {
        assert.equal(hasString(key, 'zh'), true, key);
        assert.equal(hasString(key, 'en'), true, key);
        setLocale('zh');
        assert.notEqual(hasString(key, 'zh') && key, '');
    }
});

test('dialog source wires the destination picker, session menu, and Esc-closes-menus-first', () => {
    // `dialog.ts` is split into layers; the wiring assertions read the concatenated dialog sources.
    const dialog = ['dialog.ts', 'dialog-shell.ts', 'dialog-pins.ts', 'dialog-send.ts', 'dialog-clipboard.ts', 'dialog-layout.ts']
        .map((name) => fs.readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'))
        .join('\n');
    const sessions = fs.readFileSync(new URL('./dialog-session-picker.ts', import.meta.url), 'utf8');
    const picker = fs.readFileSync(new URL('./dialog-agent-picker.ts', import.meta.url), 'utf8');
    const menu = fs.readFileSync(new URL('./dialog-session-menu.ts', import.meta.url), 'utf8');
    assert.match(dialog, /new DialogAgentPicker\(/);
    assert.match(dialog, /targetSessionId/);
    assert.match(dialog, /consumeEscape\(/);
    const escape = dialog.slice(dialog.indexOf('closeFromEscape(event)'), dialog.indexOf('setState(state'));
    // Menus (session, then destination, then tool dropdowns) take Escape before the dialog does.
    assert.match(escape, /sessions\?\.consumeEscape\(\)[\s\S]*picker\?\.consumeEscape\(\)[\s\S]*this\.close\(/);
    // The destination picker opens a session menu anchored at its own trigger, with a way back to the agent list.
    assert.match(picker, /sessions\?\.openMenu\([^)]*this\.triggerEl, \(\) => this\.open\(\)\)/);
    assert.match(menu, /cii-session-menu|cii-session-back/);
    assert.match(sessions, /applyAgentList/);
});
