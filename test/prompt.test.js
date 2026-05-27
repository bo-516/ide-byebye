import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPrompt } from '../server/prompt.js';

test('codex dock plan mode asks for a plan without edits', () => {
    const prompt = buildPrompt({
        intent: 'Move the toolbar above the canvas',
        planMode: true,
    });

    assert.equal(prompt, 'Plan mode: do not edit files or run mutating commands. Return a concise implementation plan and wait for approval.\n\nMove the toolbar above the canvas\n');
});

test('normal prompts stay compact', () => {
    assert.equal(buildPrompt({ intent: 'Make it tighter' }), 'Make it tighter\n');
});
