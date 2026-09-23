import assert from 'node:assert/strict';
import test from 'node:test';
import { Dialog } from './dialog.js';

// `flashCopied` touches only `setState`, `actionButtons` and `copyResetTimer`, so it runs against a stand-in `this`.
const flashCopied = Dialog.prototype.flashCopied;

/**
 * A stand-in Copy button whose text is a plain property, so a test can see whether the flash rewrote it — rewriting the
 * text is what resized the real button and re-wrapped the footer's action row.
 */
function makeCopyDialog() {
    const classes = new Set();
    const button = {
        textContent: 'Copy prompt✓ Copied',
        classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
    };
    const dialog = { actionButtons: new Map([['clipboard', button]]), copyResetTimer: null, setState() { } };
    return { dialog, button, isCopied: () => classes.has('cii-agent-copied') };
}

test('flashCopied only toggles the copied class and never rewrites the button text, so the button cannot resize', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { dialog, button, isCopied } = makeCopyDialog();
    flashCopied.call(dialog);
    assert.equal(isCopied(), true);
    assert.equal(button.textContent, 'Copy prompt✓ Copied');
    t.mock.timers.tick(1800);
    assert.equal(isCopied(), false);
    assert.equal(button.textContent, 'Copy prompt✓ Copied');
});

test('a repeat copy inside the flash window restarts the delay instead of resetting early', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { dialog, isCopied } = makeCopyDialog();
    flashCopied.call(dialog);
    t.mock.timers.tick(1000);
    flashCopied.call(dialog);
    t.mock.timers.tick(1000); // 2000ms after the first copy, only 1000ms after the second
    assert.equal(isCopied(), true);
    t.mock.timers.tick(800);
    assert.equal(isCopied(), false);
});

/**
 * A dialog running the real `send` / `setState`, with payload building, the network call and result rendering
 * stubbed. `api.send` stays pending until `respond()`, so a test can inspect the dialog while a send is in flight.
 * Every lockable control (agent buttons, footer tools, editor) records its `disabled` flag.
 */
function makeSendingDialog() {
    const control = () => {
        const c = { disabled: false, setDisabled: (disabled) => { c.disabled = disabled; } };
        return c;
    };
    const sends = [];
    let respond;
    const dialog = Object.assign(Object.create(Dialog.prototype), {
        state: 'idle',
        selection: { inspPath: 'src/App.tsx:1:1' },
        config: { enabledAgents: ['clipboard', 'codex-app'] },
        availability: [],
        actionButtons: new Map([['clipboard', control()], ['codex-app', control()]]),
        references: control(),
        screenshots: control(),
        recordings: control(),
        styles: control(),
        editor: control(),
        api: { send: (payload) => new Promise((resolve) => { sends.push(payload); respond = resolve; }) },
        buildPayload: async (agent) => ({ agent }),
        beginEagerClipboardWrite: () => null,
        rememberAgent() { },
        renderResult() { },
    });
    const controls = [...dialog.actionButtons.values(), dialog.references, dialog.screenshots, dialog.recordings,
        dialog.styles, dialog.editor];
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    return {
        dialog,
        sends,
        lockedCount: () => controls.filter((c) => c.disabled).length,
        controlCount: controls.length,
        respond: async (result) => { await flush(); respond(result); },
        flush,
    };
}

test('Copy leaves every control enabled while the prompt round-trips, yet still refuses a second send', async () => {
    const { dialog, sends, lockedCount, respond, flush } = makeSendingDialog();
    const copying = dialog.send('clipboard');
    assert.equal(dialog.state, 'sending');
    // Nothing is disabled, so nothing dims — the whole dialog no longer fades out and back when the copy settles.
    assert.equal(lockedCount(), 0);
    await dialog.send('codex-app'); // a click or Enter on an app agent mid-copy
    await flush();
    assert.deepEqual(sends.map((payload) => payload.agent), ['clipboard']);
    await respond({ ok: true, agent: 'clipboard', output: 'prompt' });
    await copying;
});

test('an app handoff still locks every control and the editor while it is in flight', async () => {
    const { dialog, lockedCount, controlCount, respond } = makeSendingDialog();
    const sending = dialog.send('codex-app');
    assert.equal(dialog.state, 'sending');
    assert.equal(lockedCount(), controlCount);
    await respond({ ok: true, agent: 'codex-app' });
    await sending;
});
