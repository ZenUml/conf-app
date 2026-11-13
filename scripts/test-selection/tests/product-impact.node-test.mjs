import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURES, INTERFACES, SCENARIOS, parseProductImpact, validScenarios, scenarioTag } from '../../../tests/e2e-tests/config/product-impact.mjs';
import { dependencyTagsForScenarios } from '../../../tests/e2e-tests/config/scenario-dependencies.mjs';
const document = readFileSync(new URL('../../../IMPACT-MAP.md', import.meta.url), 'utf8');

test('document registry and both matrix views produce typed known pairs', () => {
  assert.ok(FEATURES.includes('editing'));
  assert.ok(INTERFACES.includes('editor'));
  assert.ok(validScenarios([{feature:'editing',interface:'editor'}]));
  assert.ok(validScenarios([{feature:'document-export',interface:'document-export'}]));
  assert.equal(scenarioTag({feature:'editing',interface:'editor'}),'@scenario:editing:editor');
  assert.ok(SCENARIOS.length > FEATURES.length);
});
test('unknown, duplicate, unpaired and extra-field scenarios are rejected', () => {
  for (const pairs of [null, ['editing'], [{feature:'editing'}], [{feature:'no-such-feature',interface:'editor'}],
    [{feature:'editing',interface:'page-banner'}], [{feature:'editing',interface:'editor',reason:'extra'}],
    [{feature:'editing',interface:'editor'},{feature:'editing',interface:'editor'}]]) assert.equal(validScenarios(pairs),false);
});
test('a matrix edit without its contract cannot silently authorize a new pair', () => {
  const bad = document.replace(/(\| \[F02 [^\n]*?\|) · \|/, '$1 ● |');
  assert.notEqual(bad,document);
  assert.throws(()=>parseProductImpact(bad), /disagree/);
  assert.throws(()=>parseProductImpact('no registry'),/registry/);
});
test('known dependencies remain a floor without selecting unrelated parent categories', () => {
  assert.deepEqual(dependencyTagsForScenarios([]),[]);
  const tags=dependencyTagsForScenarios([{feature:'copy-for-ai',interface:'inline-viewer'}]);
  assert.ok(tags.every(tag=>tag.startsWith('@test:')));
  assert.throws(()=>dependencyTagsForScenarios([{feature:'unknown',interface:'editor'}]),/Invalid/);
});


test('opt-in byline activation stays mapped but cannot authorize default PR coverage', async () => {
  const { hasPrCoverage, SCENARIO_TESTS } = await import('../../../tests/e2e-tests/config/scenario-coverage.mjs');
  const { optInTestIgnores, isDefaultPrSpec } = await import('../../../tests/e2e-tests/config/test-discovery-policy.mjs');
  assert.equal(validScenarios([{feature:'prepared-diagram-activation',interface:'byline-activation'}]),true);
  assert.equal(hasPrCoverage({feature:'prepared-diagram-activation',interface:'byline-activation'}),false);
  assert.ok(SCENARIO_TESTS.some(t=>t.file==='insert/byline-activation.spec.ts'&&t.execution.includes('@execution:opt-in')));
  assert.deepEqual(optInTestIgnores({}),['**/byline-activation.spec.ts']);
  assert.deepEqual(optInTestIgnores({BYLINE_ACTIVATION_LIVE:'1'}),[]);
  assert.equal(isDefaultPrSpec('insert/byline-activation.spec.ts'),false);
});
