import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ALL_AGENT_NAMES,
    CLIENT_CONFIG_GLOBAL,
    DEFAULT_HOTKEY,
    DEFAULT_OUTPUT_DIR,
    ENDPOINTS,
    INSP_PATH_ATTR,
    PLUGIN_NODE_ATTR,
    ROUTE_PREFIX,
    TOKEN_HEADER,
} from './constants.js';

test('shared constants expose stable route and attribute surface', () => {
    assert.equal(ROUTE_PREFIX, '/__intent-inspector');
    assert.equal(ENDPOINTS.client, '/__intent-inspector/client.js');
    assert.equal(ENDPOINTS.agents, '/__intent-inspector/agents');
    assert.equal(ENDPOINTS.resolve, '/__intent-inspector/resolve');
    assert.equal(ENDPOINTS.send, '/__intent-inspector/send');
    assert.equal(ENDPOINTS.vendor, '/__intent-inspector/vendor');
    assert.equal(TOKEN_HEADER, 'x-intent-inspector-token');
    assert.equal(CLIENT_CONFIG_GLOBAL, '__CODE_INTENT_INSPECTOR__');
    assert.equal(PLUGIN_NODE_ATTR, 'data-intent-inspector-ui');
    assert.equal(INSP_PATH_ATTR, 'data-insp-path');
    assert.equal(DEFAULT_HOTKEY, 'Alt+Shift+I');
    assert.equal(DEFAULT_OUTPUT_DIR, '.intent-inspector');
});

test('ALL_AGENT_NAMES lists the shipped agent identifiers in stable order', () => {
    assert.deepEqual(ALL_AGENT_NAMES, [
        'clipboard',
        'file',
        'codex-app',
        'claude-app',
        'cursor-app',
        'grok-build',
    ]);
});
