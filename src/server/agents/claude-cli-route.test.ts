import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildClaudeCliDeepLink,
    CLAUDE_CLI_CWD_LIMIT,
    CLAUDE_CLI_QUERY_LIMIT,
    claudeCliLauncherArgs,
    claudeCliQueryProblem,
    claudeCliUnavailableMessage,
    isClaudeCliCwdAllowed,
    pickClaudeCliRoute,
    readClaudeCliLaunch,
} from './claude-cli-route.js';
import { buildPosixLauncherScript } from './launch-script.js';

/** Prompt with every character a query string can mangle: `+ & = # %`, a newline, and CJK text. */
const TRICKY_PROMPT = 'a+b & c=d #e %f\n中文 100%';

/**
 * Route for `auto` with the given detection results.
 *
 * @param {boolean} handlerRegistered Handler found. @param {boolean} fits Prompt and cwd accepted.
 * @param {boolean} cliAvailable CLI found.
 */
function auto(handlerRegistered: boolean, fits: boolean, cliAvailable: boolean) {
    return pickClaudeCliRoute({ launch: 'auto', handlerRegistered, cliAvailable, cwdAllowed: true, promptFits: fits });
}

test('auto follows the route table: deeplink first, Terminal next, a pointer deeplink last', () => {
    assert.deepEqual(auto(true, true, true), { route: 'deeplink', pointer: false });
    assert.deepEqual(auto(true, true, false), { route: 'deeplink', pointer: false });
    assert.deepEqual(auto(true, false, true), { route: 'terminal' });
    assert.deepEqual(auto(true, false, false), { route: 'deeplink', pointer: true });
    assert.deepEqual(auto(false, true, true), { route: 'terminal' });
    assert.deepEqual(auto(false, false, true), { route: 'terminal' });
    assert.deepEqual(auto(false, true, false), { route: 'unavailable', reason: 'missing' });
});

test('auto treats a rejected cwd like an oversized prompt, and fails when only the handler is left', () => {
    const base = { launch: 'auto' as const, handlerRegistered: true, cwdAllowed: false, promptFits: true };
    assert.deepEqual(pickClaudeCliRoute({ ...base, cliAvailable: true }), { route: 'terminal' });
    assert.deepEqual(pickClaudeCliRoute({ ...base, cliAvailable: false }), { route: 'unavailable', reason: 'cwd' });
});

test('launch deeplink never uses the launcher; launch terminal never opens a link', () => {
    const deeplink = { launch: 'deeplink' as const, cliAvailable: true, cwdAllowed: true };
    assert.deepEqual(pickClaudeCliRoute({ ...deeplink, handlerRegistered: true, promptFits: true }), { route: 'deeplink', pointer: false });
    assert.deepEqual(pickClaudeCliRoute({ ...deeplink, handlerRegistered: true, promptFits: false }), { route: 'deeplink', pointer: true });
    assert.deepEqual(pickClaudeCliRoute({ ...deeplink, handlerRegistered: false, promptFits: true }), { route: 'unavailable', reason: 'handler' });
    assert.deepEqual(pickClaudeCliRoute({ ...deeplink, handlerRegistered: true, promptFits: true, cwdAllowed: false }), { route: 'unavailable', reason: 'cwd' });
    const terminal = { launch: 'terminal' as const, handlerRegistered: true, cwdAllowed: true, promptFits: true };
    assert.deepEqual(pickClaudeCliRoute({ ...terminal, cliAvailable: true }), { route: 'terminal' });
    assert.deepEqual(pickClaudeCliRoute({ ...terminal, cliAvailable: false }), { route: 'unavailable', reason: 'cli' });
});

test('readClaudeCliLaunch keeps deeplink / terminal and maps everything else to auto', () => {
    assert.equal(readClaudeCliLaunch('deeplink'), 'deeplink');
    assert.equal(readClaudeCliLaunch('terminal'), 'terminal');
    for (const value of [undefined, 'auto', 'app', 1, null])
        assert.equal(readClaudeCliLaunch(value), 'auto');
});

test('the deeplink round-trips + & = # %, newlines and CJK through both decoders (AC-9)', () => {
    const cwd = '/Users/me/my shop+1';
    const url = buildClaudeCliDeepLink({ cwd, prompt: TRICKY_PROMPT });
    assert.ok(url.startsWith('claude-cli://open?cwd=%2FUsers%2Fme%2Fmy%20shop%2B1&q='));
    assert.ok(!url.includes('+'), 'a raw + would decode to a space in URLSearchParams');
    const parsed = new URL(url);
    assert.equal(parsed.hostname, 'open');
    assert.equal(parsed.searchParams.get('q'), TRICKY_PROMPT);
    assert.equal(parsed.searchParams.get('cwd'), cwd);
    const rawQuery = url.slice(url.indexOf('&q=') + 3);
    assert.equal(decodeURIComponent(rawQuery), TRICKY_PROMPT);
});

test('claudeCliQueryProblem mirrors the handler: 5000 cleaned characters, no stray control characters', () => {
    assert.equal(claudeCliQueryProblem('x'.repeat(CLAUDE_CLI_QUERY_LIMIT)), null);
    assert.equal(claudeCliQueryProblem('x'.repeat(CLAUDE_CLI_QUERY_LIMIT + 1)), 'length');
    // Trimmed whitespace and stripped zero-width characters do not count.
    assert.equal(claudeCliQueryProblem(`  ${'x'.repeat(CLAUDE_CLI_QUERY_LIMIT)}\n\n`), null);
    assert.equal(claudeCliQueryProblem(`${'x'.repeat(CLAUDE_CLI_QUERY_LIMIT)}\u200b\u200b`), null);
    // NFKC can lengthen text: each "ﬁ" ligature becomes "fi".
    assert.equal(claudeCliQueryProblem('\ufb01'.repeat(2600)), 'length');
    assert.equal(claudeCliQueryProblem('tab\tnewline\ncrlf\r\nend'), null);
    assert.equal(claudeCliQueryProblem('bell\u0007'), 'control');
    assert.equal(claudeCliQueryProblem('c1\u0085'), 'control');
});

test('isClaudeCliCwdAllowed accepts absolute local folders and rejects what the handler rejects', () => {
    assert.equal(isClaudeCliCwdAllowed('/Users/me/shop'), true);
    assert.equal(isClaudeCliCwdAllowed('/Users/me/项目 1'), true);
    assert.equal(isClaudeCliCwdAllowed('C:\\Users\\me\\shop'), true);
    for (const cwd of [
        '',
        'relative/dir',
        '/Users/me/../etc',
        'C:\\repo\\..\\x',
        '\\\\server\\share',
        '//server/share',
        '/tmp/line\nbreak',
        '/tmp/zero\u200bwidth',
        '/tmp/bidi\u202eevil',
        `/${'a'.repeat(CLAUDE_CLI_CWD_LIMIT)}`,
    ])
        assert.equal(isClaudeCliCwdAllowed(cwd), false, JSON.stringify(cwd));
});

test('the Terminal launcher ends options with -- and adds the permission mode when set', () => {
    const script = (permissionMode: unknown) => buildPosixLauncherScript({
        command: '/Users/me/.local/bin/claude',
        cwd: '/Users/me/shop',
        promptPath: '/Users/me/shop/.intent-inspector/launches/a.claude.prompt.txt',
        args: claudeCliLauncherArgs(permissionMode),
    });
    assert.match(script(undefined), /\nexec '\/Users\/me\/\.local\/bin\/claude' -- "\$\(cat '\/Users\/me\/shop\/\.intent-inspector\/launches\/a\.claude\.prompt\.txt'\)"\n$/);
    assert.match(script(' plan '), /exec '\/Users\/me\/\.local\/bin\/claude' --permission-mode 'plan' -- "\$\(cat /);
    assert.doesNotMatch(script('   '), /--permission-mode/);
});

test('the not-found reason tells the user how to get either route (AC-3)', () => {
    assert.match(claudeCliUnavailableMessage('missing'), /run "claude" once/);
    assert.match(claudeCliUnavailableMessage('missing'), /https:\/\/code\.claude\.com/);
    assert.match(claudeCliUnavailableMessage('cwd', '/odd/path'), /\/odd\/path/);
});
