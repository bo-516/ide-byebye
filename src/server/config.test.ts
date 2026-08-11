import assert from 'node:assert/strict';
import test from 'node:test';
import {
    coerceAgentConfig,
    normalizeArtifactPathStyle,
    normalizePathStyle,
    resolveOptions,
    resolvePromptPathStyleOptions,
} from './config.js';
import {
    DEFAULT_HOTKEY,
    DEFAULT_MAX_HTML_SNIPPET,
    DEFAULT_MAX_SOURCE_CONTEXT_LINES,
    DEFAULT_OUTPUT_DIR,
} from '../shared/constants.js';

test('normalizePathStyle only accepts absolute; everything else is relative', () => {
    assert.equal(normalizePathStyle('absolute'), 'absolute');
    assert.equal(normalizePathStyle('relative'), 'relative');
    assert.equal(normalizePathStyle(undefined), 'relative');
    assert.equal(normalizePathStyle('bogus'), 'relative');
    assert.equal(normalizePathStyle(1), 'relative');
});

test('normalizeArtifactPathStyle defaults to absolute; only relative opts out', () => {
    assert.equal(normalizeArtifactPathStyle(undefined), 'absolute');
    assert.equal(normalizeArtifactPathStyle('relative'), 'relative');
    assert.equal(normalizeArtifactPathStyle('absolute'), 'absolute');
    assert.equal(normalizeArtifactPathStyle('typo'), 'absolute');
    assert.equal(normalizeArtifactPathStyle(null), 'absolute');
});

test('resolvePromptPathStyleOptions combines source and artifact styles', () => {
    assert.deepEqual(resolvePromptPathStyleOptions({}), {
        pathStyle: 'relative',
        artifactPathStyle: 'absolute',
    });
    assert.deepEqual(resolvePromptPathStyleOptions({ pathStyle: 'absolute', artifactPathStyle: 'relative' }), {
        pathStyle: 'absolute',
        artifactPathStyle: 'relative',
    });
});

test('resolveOptions fills safe defaults and preserves explicit overrides', () => {
    const defaults = resolveOptions({});
    assert.equal(defaults.enabled, true);
    assert.equal(defaults.locale, null);
    assert.equal(defaults.hotkey, DEFAULT_HOTKEY);
    assert.equal(defaults.clickModifier, 'auto');
    assert.equal(defaults.defaultAgent, 'claude-app');
    assert.equal(defaults.outputDir, DEFAULT_OUTPUT_DIR);
    assert.equal(defaults.applyMode, 'prompt-only');
    assert.equal(defaults.maxSourceContextLines, DEFAULT_MAX_SOURCE_CONTEXT_LINES);
    assert.equal(defaults.maxDomSnippetLength, DEFAULT_MAX_HTML_SNIPPET);
    assert.equal(defaults.apiOrigin, null);
    assert.equal(defaults.pathStyle, 'relative');
    assert.equal(defaults.artifactPathStyle, 'absolute');
    assert.deepEqual(defaults.agents, {});
    assert.deepEqual(defaults.recording, {
        enabled: true,
        maxDurationMs: 30000,
        mask: { allInputs: false, blockClass: 'rr-block' },
    });

    const custom = resolveOptions({
        enabled: false,
        locale: 'zh-CN',
        hotkey: 'Ctrl+I',
        clickModifier: 'meta',
        defaultAgent: 'clipboard',
        outputDir: '.out',
        applyMode: 'agent-edit',
        maxSourceContextLines: 10,
        maxDomSnippetLength: 50,
        apiOrigin: 'http://127.0.0.1:9999/extra',
        pathStyle: 'absolute',
        artifactPathStyle: 'relative',
        agents: { clipboard: true },
        recording: { enabled: false, maxDurationMs: 5000, mask: { allInputs: true, blockClass: 'secret' } },
    });
    assert.equal(custom.enabled, false);
    assert.equal(custom.locale, 'zh');
    assert.equal(custom.hotkey, 'Ctrl+I');
    assert.equal(custom.clickModifier, 'meta');
    assert.equal(custom.defaultAgent, 'clipboard');
    assert.equal(custom.outputDir, '.out');
    assert.equal(custom.applyMode, 'agent-edit');
    assert.equal(custom.maxSourceContextLines, 10);
    assert.equal(custom.maxDomSnippetLength, 50);
    assert.equal(custom.apiOrigin, 'http://127.0.0.1:9999');
    assert.equal(custom.pathStyle, 'absolute');
    assert.equal(custom.artifactPathStyle, 'relative');
    assert.deepEqual(custom.agents, { clipboard: true });
    assert.deepEqual(custom.recording, {
        enabled: false,
        maxDurationMs: 5000,
        mask: { allInputs: true, blockClass: 'secret' },
    });
});

test('resolveOptions normalizes apiOrigin and recording edges', () => {
    assert.equal(resolveOptions({ apiOrigin: '   ' }).apiOrigin, null);
    assert.equal(resolveOptions({ apiOrigin: 42 }).apiOrigin, null);
    assert.equal(resolveOptions({ apiOrigin: 'ftp://x' }).apiOrigin, null);
    assert.equal(resolveOptions({ apiOrigin: 'not-a-url' }).apiOrigin, null);
    assert.equal(resolveOptions({ apiOrigin: 'https://example.com/' }).apiOrigin, 'https://example.com');

    assert.equal(resolveOptions({ recording: false }).recording.enabled, false);
    assert.equal(resolveOptions({ recording: { maxDurationMs: 999999 } }).recording.maxDurationMs, 300000);
    assert.equal(resolveOptions({ recording: { maxDurationMs: -1 } }).recording.maxDurationMs, 30000);
    assert.equal(resolveOptions({ recording: { enabled: false } }).recording.enabled, false);
    assert.equal(resolveOptions({ recording: { mask: { blockClass: '' } } }).recording.mask.blockClass, 'rr-block');
});

test('coerceAgentConfig maps boolean and object agent entries', () => {
    assert.deepEqual(coerceAgentConfig(true), { enabled: true });
    assert.equal(coerceAgentConfig(false), undefined);
    assert.equal(coerceAgentConfig(null), undefined);
    assert.equal(coerceAgentConfig(0), undefined);
    assert.equal(coerceAgentConfig('yes'), undefined);
    assert.deepEqual(coerceAgentConfig({ enabled: true, command: 'x' }), { enabled: true, command: 'x' });
    assert.equal(coerceAgentConfig({ enabled: false }), undefined);
    assert.deepEqual(coerceAgentConfig({ command: 'y' }), { command: 'y' });
});
