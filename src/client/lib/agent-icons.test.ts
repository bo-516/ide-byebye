import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENT_ACTIONS } from '../dialog/dialog-utils.js';
import { AGENT_ICONS_STYLE, AGENT_MARK_BRANDS, agentIconsStyle } from './agent-icons.js';
import { AGENT_MARKS } from './agent-marks.js';

/**
 * Check that an SVG document's tags nest and close, since a broken mark renders as nothing without any error.
 * @param {string} svg Document. @returns {boolean} True when every opened tag is closed in order.
 */
function tagsBalance(svg) {
    const stack = [];
    for (const [, closing, name, selfClosing] of svg.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
        if (selfClosing)
            continue;
        if (!closing)
            stack.push(name);
        else if (stack.pop() !== name)
            return false;
    }
    return stack.length === 0;
}

test('every built-in destination has a brand mark', () => {
    for (const { name } of AGENT_ACTIONS) {
        const brand = AGENT_MARK_BRANDS[name];
        assert.ok(brand, `${name} has no brand`);
        assert.ok(AGENT_MARKS[brand], `no mark for ${brand}`);
    }
    assert.deepEqual(Object.keys(AGENT_MARK_BRANDS).sort(), AGENT_ACTIONS.map((action) => action.name).sort());
});

test('marks are standalone SVG documents that can sit inside a double-quoted CSS url()', () => {
    for (const [brand, mark] of Object.entries(AGENT_MARKS)) {
        const svg = mark.image ?? mark.mask;
        assert.match(svg, /^<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg' viewBox='0 0 24 24'>/, brand);
        assert.ok(!svg.includes('"'), `${brand} contains a double quote`);
        assert.ok(tagsBalance(svg), `${brand} has unbalanced tags`);
    }
});

test('agentIconsStyle paints full-colour marks as backgrounds and single-colour marks as text-coloured masks', () => {
    const css = agentIconsStyle({
        codex: { image: "<svg a='1'/>" },
        cursor: { mask: "<svg b='2'/>" },
        unused: { image: "<svg d='4'/>" },
    });
    assert.match(css, /^:host\{--cii-mark-codex:url\("data:image\/svg\+xml,%3Csvg a='1'\/%3E"\) center\/contain no-repeat;/);
    assert.ok(css.includes('.cii-agent-kind[data-agent="codex-app"]{-webkit-mask:none;mask:none;background:var(--cii-mark-codex)}'));
    assert.ok(css.includes('.cii-agent-kind[data-agent="cursor-app"]{-webkit-mask:var(--cii-mark-cursor);mask:var(--cii-mark-cursor);background:var(--cii-text)}'));
    assert.ok(css.includes('@media (forced-colors:active){.cii-agent-kind[data-agent="cursor-app"]{background:CanvasText}}'));
    assert.ok(css.includes('--cii-mark-unused:'), 'an unused brand still declares its property');
    assert.ok(!css.includes('var(--cii-mark-unused)'), 'but gets no rule');
});

test('agentIconsStyle groups destinations that share a brand and omits the forced-colours block without masks', () => {
    const css = agentIconsStyle({ antigravity: { image: '<svg/>' } });
    assert.ok(css.includes('.cii-agent-kind[data-agent="antigravity-ide"],.cii-agent-kind[data-agent="antigravity"]{'));
    assert.ok(!css.includes('forced-colors'));
});

test('the shipped stylesheet is built from the vendor marks', () => {
    assert.equal(AGENT_ICONS_STYLE, agentIconsStyle(AGENT_MARKS));
});
