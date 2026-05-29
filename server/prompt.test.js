import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPrompt } from './prompt.js';

test('buildPrompt ignores stale plan-only flags', () => {
    const prompt = buildPrompt({
        intent: 'Update the dock',
        planMode: true,
    });

    assert.equal(prompt, 'Update the dock\n');
});
