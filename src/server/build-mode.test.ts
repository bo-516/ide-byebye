import assert from 'node:assert/strict';
import test from 'node:test';
import { isEsbuildProductionBuild, isFarmProductionBuild, isProductionNodeEnv } from './build-mode.js';

test('isProductionNodeEnv is true only for NODE_ENV=production', () => {
    assert.equal(isProductionNodeEnv({ NODE_ENV: 'production' }), true);
    assert.equal(isProductionNodeEnv({ NODE_ENV: 'development' }), false);
    assert.equal(isProductionNodeEnv({ NODE_ENV: 'test' }), false);
    assert.equal(isProductionNodeEnv({}), false);
});

test('isEsbuildProductionBuild reads NODE_ENV or the process.env.NODE_ENV define', () => {
    assert.equal(isEsbuildProductionBuild({}, { NODE_ENV: 'production' }), true);
    assert.equal(isEsbuildProductionBuild({ define: { 'process.env.NODE_ENV': '"production"' } }, {}), true);
    assert.equal(isEsbuildProductionBuild({ define: { 'process.env.NODE_ENV': JSON.stringify('production') } }, {}), true);
    assert.equal(isEsbuildProductionBuild({ define: { 'process.env.NODE_ENV': '"development"' } }, {}), false);
    // An unquoted identifier is not the string `production`.
    assert.equal(isEsbuildProductionBuild({ define: { 'process.env.NODE_ENV': 'production' } }, {}), false);
    assert.equal(isEsbuildProductionBuild({ define: null }, {}), false);
    assert.equal(isEsbuildProductionBuild({}, {}), false);
});

test('isFarmProductionBuild reads compilation.mode', () => {
    assert.equal(isFarmProductionBuild({ compilation: { mode: 'production' } }), true);
    assert.equal(isFarmProductionBuild({ compilation: { mode: 'development' } }), false);
    assert.equal(isFarmProductionBuild({ compilation: {} }), false);
    assert.equal(isFarmProductionBuild({}), false);
    assert.equal(isFarmProductionBuild(undefined), false);
});
