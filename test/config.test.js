import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveOptions } from '../server/config.js';

test('codex dock defaults to Command-click without changing disabled inspector defaults', () => {
    assert.equal(resolveOptions({}).clickModifier, null);

    const enabled = resolveOptions({ codexDock: true });
    assert.equal(enabled.codexDock.enabled, true);
    assert.equal(enabled.clickModifier, 'meta');
    assert.ok(enabled.codexDock.models.length > 1);

    const overridden = resolveOptions({ codexDock: true, clickModifier: 'alt' });
    assert.equal(overridden.clickModifier, 'alt');
});

test('codex dock accepts configured model options', () => {
    const resolved = resolveOptions({
        codexDock: {
            models: [
                { label: 'Local fast', value: 'codex-fast' },
                'codex-max',
            ],
        },
    });

    assert.deepEqual(resolved.codexDock.models, [
        { label: 'Local fast', value: 'codex-fast' },
        { label: 'codex-max', value: 'codex-max' },
    ]);
});
