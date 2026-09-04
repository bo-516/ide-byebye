import assert from 'node:assert/strict';
import test from 'node:test';
import { deliverPromptToClient, resolveDeliveryWindow } from './dialog-delivery.js';

/** Build a fake page window plus the embedder windows a delivery may address. */
function makeWindows() {
    const posted = [];
    const parent: any = { postMessage: (data, origin) => posted.push({ target: 'parent', data, origin }) };
    const top: any = { postMessage: (data, origin) => posted.push({ target: 'top', data, origin }) };
    const win: any = { parent, top, opener: null };
    return { win, parent, top, posted };
}

test('resolveDeliveryWindow picks the requested embedder and defaults to parent', () => {
    const { win, parent, top } = makeWindows();
    assert.equal(resolveDeliveryWindow('parent', win), parent);
    assert.equal(resolveDeliveryWindow('top', win), top);
    assert.equal(resolveDeliveryWindow(undefined, win), parent);
});

test('resolveDeliveryWindow refuses the page itself and a missing opener', () => {
    const standalone: any = { opener: null };
    standalone.parent = standalone;
    standalone.top = standalone;
    assert.equal(resolveDeliveryWindow('parent', standalone), null);
    assert.equal(resolveDeliveryWindow('opener', standalone), null);
});

test('deliverPromptToClient posts the payload to the embedding window', () => {
    const { win, posted } = makeWindows();
    const payload = { type: 'ide-byebye:prompt', prompt: 'PROMPT\n' };
    const result = deliverPromptToClient({ windowTarget: 'parent', targetOrigin: 'http://localhost:1420', payload }, win);
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(posted, [{ target: 'parent', data: payload, origin: 'http://localhost:1420' }]);
});

test('deliverPromptToClient falls back to a wildcard origin', () => {
    const { win, posted } = makeWindows();
    deliverPromptToClient({ windowTarget: 'parent', payload: { prompt: 'x' } }, win);
    assert.equal(posted[0].origin, '*');
});

test('deliverPromptToClient reports an un-embedded page instead of posting to itself', () => {
    const standalone: any = { opener: null };
    standalone.parent = standalone;
    standalone.postMessage = () => assert.fail('must not post to the page itself');
    assert.deepEqual(deliverPromptToClient({ windowTarget: 'parent', payload: {} }, standalone), {
        ok: false,
        reason: 'no-window',
    });
});

test('deliverPromptToClient reports a rejected post', () => {
    const win: any = {
        parent: {
            postMessage: () => {
                throw new Error('blocked by origin');
            },
        },
    };
    assert.deepEqual(deliverPromptToClient({ windowTarget: 'parent', payload: {} }, win), {
        ok: false,
        reason: 'post-failed',
        error: 'blocked by origin',
    });
});
