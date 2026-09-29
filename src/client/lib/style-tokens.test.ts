import assert from 'node:assert/strict';
import test from 'node:test';
import { DARK_TOKENS, THEME_ATTR, TOKENS_STYLE } from './style-tokens.js';

/**
 * Custom property names declared in a CSS fragment.
 * @param {string} css Fragment. @returns {string[]} `--cii-*` names in order of appearance.
 */
function tokenNames(css) {
    return [...css.matchAll(/(--cii-[a-z0-9-]+)\s*:/g)].map((match) => match[1]);
}

test('dark tokens apply for theme "dark" and, inside the dark media query, for theme "auto"', () => {
    const dark = TOKENS_STYLE.indexOf(`:host([${THEME_ATTR}="dark"]) {${DARK_TOKENS}}`);
    const media = TOKENS_STYLE.indexOf('@media (prefers-color-scheme: dark) {');
    const auto = TOKENS_STYLE.indexOf(`:host([${THEME_ATTR}="auto"]) {${DARK_TOKENS}}`);
    assert.ok(dark > 0, 'dark rule missing');
    assert.ok(media > dark && auto > media, '"auto" must be scoped to the dark media query');
    assert.equal(TOKENS_STYLE.split('@media').length, 2, 'only "auto" may depend on the OS setting');
});

test('the light theme is the unconditional :host block, so a host without the attribute renders light', () => {
    assert.ok(TOKENS_STYLE.trimStart().startsWith(':host {'));
    assert.ok(!TOKENS_STYLE.includes(`:host([${THEME_ATTR}="light"])`), 'light needs no rule of its own');
});

test('every dark token overrides a token the light theme declares', () => {
    const light = new Set(tokenNames(TOKENS_STYLE.slice(0, TOKENS_STYLE.indexOf(`:host([${THEME_ATTR}`))));
    const dark = tokenNames(DARK_TOKENS);
    assert.ok(dark.length > 20);
    for (const name of dark)
        assert.ok(light.has(name), `${name} has no light value`);
});
