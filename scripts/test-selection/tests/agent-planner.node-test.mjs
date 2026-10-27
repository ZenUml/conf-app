import test from 'node:test';
import { createHash } from 'node:crypto';
import { SCENARIO_COVERAGE, API_LANES } from '../../../tests/e2e-tests/config/scenario-coverage.mjs';
import { PRODUCT_IMPACT_FINGERPRINT, scenarioTag } from '../../../tests/e2e-tests/config/product-impact.mjs';
import assert from 'node:assert/strict';
import { selectAgentFloor } from '../../e2e-select.mjs';
import { decisionError, resolveSelection } from '../resolve.mjs';
import { scopedPlan, metricsSummary } from '../scoped-plan.mjs';
import { CATEGORIES, CATEGORY_VERSION } from '../../../tests/e2e-tests/config/categories.mjs';
import { POLICY_VERSION, EXECUTION_SELECTOR_CATALOG_FINGERPRINT } from '../classify.mjs';
import { EXECUTION_SELECTOR_CATALOG_VERSION } from '../../../tests/e2e-tests/config/impact-map.mjs';
const head = 'a'.repeat(40), tree = 'b'.repeat(40);
const pair = { feature:'connect-mcp', interface:'connect-mcp-dialog' };
const names = CATEGORIES.slice(0, 3).map(c => c.id);
const files = ['src/model/Example.ts', 'tests/e2e-tests/tests/fullscreen/direct.spec.ts'];
function selection(overrides = {}) {
  return { schema_version: 1, category_version: CATEGORY_VERSION, policy_version: POLICY_VERSION,
    selector_catalog_version: EXECUTION_SELECTOR_CATALOG_VERSION, selector_catalog_fingerprint: EXECUTION_SELECTOR_CATALOG_FINGERPRINT,
    decision_schema_version: 2, product_impact_fingerprint: PRODUCT_IMPACT_FINGERPRINT, scenario_coverage_fingerprint: createHash('sha256').update(JSON.stringify({ browser: SCENARIO_COVERAGE, api: API_LANES })).digest('hex'), scenarios: [pair],
    selection_scope: 'pr', decision_source: 'agent', decision_id: 12, pr_number: 9, pr_head_sha: head, base_sha: 'c'.repeat(40),
    head_sha: head, tested_tree: tree, source: 'labeling', source_paths: files, removed_paths: [], mode: 'selected', execution_mode: 'enabled',
    categories: Object.fromEntries(CATEGORIES.map(c => [c.id, { selected: false }])),
    required: ['smoke'], diff_complete: true, fallback_reason: null, request: { outcome: 'not-requested' }, model: null, ...overrides };
}
function spec(id, file, category, smoke = false) {
  return { id, file, line: 1, title: id, tags: [`@test:${category}`, '@variant:lite', ...(smoke ? ['@smoke'] : [])], tests: [{ projectName: file.split('/')[0] }] };
}
const inventory = { config: { projects: [{name:'fullscreen',dependencies:['auth']}, {name:'render',dependencies:['pages']}] }, suites: [{title:'tests', specs: [
  spec('smoke', 'fullscreen/smoke.spec.ts', names[2], true),
  {...spec('chosen', 'fullscreen/chosen.spec.ts', names[0]), tags: [`@test:${names[0]}`, scenarioTag(pair), '@variant:lite']},
  spec('direct', 'fullscreen/direct.spec.ts', names[1]),
  spec('unrelated', 'fullscreen/unrelated.spec.ts', names[2]),
]}] };
const fixtureCoverage = [{file:'fullscreen/chosen.spec.ts',variants:['lite'],scenarios:[pair]}];
function plan(raw = selection(), overrides = {}) {
  const resolved = resolveSelection({ selection: raw, files: raw.source_paths, head, tree });
  return scopedPlan({discover: () => inventory, selection: raw, resolved, head, tree, policy: POLICY_VERSION, variant:'lite', scope:'all', shards:2, grep:resolved.grep, sourcePaths:raw.source_paths, selectionScope:'pr', requireAgentDecision:true, scenarioInventory:fixtureCoverage, ...overrides});
}

test('agent subset keeps smoke, direct changes and project dependencies without all fallback for shared code', () => {
  const result = plan();
  assert.deepEqual(result.tests.map(t => t.id), ['smoke','chosen','direct']);
  assert.deepEqual(result.dependencies, ['auth']);
  assert.equal(result.selection_metrics.decision_source, 'agent');
  assert.equal(result.selection_metrics.request.outcome, 'not-requested');
  assert.equal(result.selection_metrics.model, null);
  assert.match(metricsSummary(result.selection_metrics), /No model API request/);
});
test('agent floor keeps explicit helper-dependent specs even beside shared paths', () => {
  const floor = selectAgentFloor(['src/model/Example.ts', 'tests/e2e-tests/helpers/agentLink.ts']);
  assert.deepEqual(floor.tags, ['@smoke']);
  assert.deepEqual(floor.direct_test_files, ['agent-link/agent-link-e2e.spec.ts', 'agent-link/agent-link-multi-page-crosstalk.spec.ts']);
  assert.deepEqual(floor.review_paths, ['src/model/Example.ts']);
  assert.ok(floor.reasons.some(reason=>reason.includes('explicit agent impact review required')));
  assert.ok(floor.reasons.every(reason=>!/(runs everything|Jev)/.test(reason)));
});
test('zero selected categories retains only mandatory coverage', () => {
  const raw = selection({scenarios:[]});
  assert.deepEqual(plan(raw).tests.map(t => t.id), ['smoke','direct']);
});
test('triage-approved full selection retains full inventory', () => {
  const result = plan(selection({mode:'all',source:'triage',full_reason:'Shared persistence contract affects all app entrypoints.'}));
  assert.equal(result.tests.length, 4);
  assert.equal(result.selection_metrics.mode, 'all');
  assert.equal(result.fallback_reason, null);
});
test('full from labeling or missing explanation is blocked', () => {
  assert.throws(() => plan(selection({mode:'all'})), /full-requires-triage/);
  assert.throws(() => plan(selection({mode:'all',source:'triage'})), /full-requires-triage/);
});
test('missing or stale resolved artifacts block instead of widening', () => {
  assert.throws(() => plan(selection(), {resolved:null}), /blocked/);
  assert.throws(() => plan(selection(), {resolved:{mode:'all'}}), /blocked/);
  assert.throws(() => plan(selection(), {head:'d'.repeat(40)}), /blocked/);
});
test('required PR authorization rejects missing raw artifact', () => {
  assert.throws(() => scopedPlan({selection:null, requireAgentDecision:true, selectionScope:'pr'}), /missing agent authorization/);
});
test('unknown or malformed categories cannot authorize a subset', () => {
  assert.throws(() => plan(selection({categories:{unknown:{selected:true}}})), /invalid-agent-categories/);
  assert.equal(decisionError({selection:selection({categories:null}),head,tree}), 'invalid-agent-categories');
});
test('direct changed specs absent from inventory block', () => {
  assert.throws(() => plan(selection({source_paths:['tests/e2e-tests/tests/fullscreen/missing.spec.ts']})), /directly changed spec absent/);
});
test('artifact path list and grep cannot be changed independently of authorization', () => {
  assert.throws(() => plan(selection(), {sourcePaths:['src/components/Sequence.vue']}), /changed paths differ/);
  assert.throws(() => plan(selection(), {grep:'@smoke'}), /blocked/);
});
test('empty auxiliary render subset remains empty rather than becoming full', () => {
  const raw = selection({source_paths:['src/components/Sequence.vue'], scenarios:[]});
  const renderInventory = {config:{projects:[]}, suites:[{title:'tests',specs:[spec('render-other','render/other.spec.ts',names[2])]}]};
  const result = plan(raw, {scope:'render',discover:()=>renderInventory});
  assert.deepEqual(result.tests, []);
  assert.deepEqual(result.shards, []);
  assert.equal(result.selection_metrics.mode, 'selected');
});
test('raw decision identity rejects missing comment ID, draft-shaped required string and wrong source scope', () => {
  for (const overrides of [{decision_id:0},{required:'smoke'},{selection_scope:'main'}]) assert.throws(() => plan(selection(overrides)), /blocked/);
});

test('human full flag cannot override an agent subset decision', () => {
  const raw = selection();
  const resolved = resolveSelection({selection:raw,files,head,tree,humanFull:true});
  assert.equal(resolved.mode, 'selected');
  assert.notEqual(resolved.grep, '');
});


test('removed and renamed-away specs require evidence but are not executable floor tests', () => {
  const previous = 'tests/e2e-tests/tests/fullscreen/previous.spec.ts';
  const raw = selection({source_paths:[...files,previous],removed_paths:[previous]});
  assert.deepEqual(plan(raw).tests.map(t=>t.id), ['smoke','chosen','direct']);
  const full = plan({...raw,mode:'all',source:'triage',full_reason:'All persistence and viewer entrypoints changed.'});
  assert.equal(full.tests.length,4);
});
test('removed-path metadata cannot exclude a different path from direct coverage', () => {
  assert.throws(()=>plan(selection({removed_paths:['not-a-changed-path.spec.ts']})), /invalid-agent-decision/);
});
test('direct render specs belong only to the render inventory even when regression keeps legacy all scope', () => {
  const renderPath = 'tests/e2e-tests/tests/render/changed.spec.ts';
  const raw = selection({source_paths:[renderPath]});
  const regression = plan(raw,{inventoryProjects:['auth','fullscreen']});
  assert.deepEqual(regression.selection_metrics.direct_test_files,[]);
  assert.ok(regression.tests.some(test=>test.id==='smoke'));
  const full = plan({...raw,mode:'all',source:'triage',full_reason:'Full staging coverage is required.'},{inventoryProjects:['auth','fullscreen']});
  assert.equal(full.tests.length,4);
  assert.throws(()=>plan(raw,{inventoryProjects:['auth','render','fullscreen']}),/directly changed spec absent/);
});


test('direct specs explicitly targeting another variant do not block selected or full Lite plans', () => {
  const path='tests/e2e-tests/tests/asyncapi/changed.spec.ts';
  const other=spec('async-only','asyncapi/changed.spec.ts',names[1]);
  other.tags=other.tags.map(tag=>tag==='@variant:lite'?'@variant:asyncapi':tag);
  const mixed={...inventory,suites:[...inventory.suites,{title:'asyncapi',specs:[other]}]};
  const raw=selection({source_paths:[path]});
  for (const current of [raw,{...raw,mode:'all',source:'triage',full_reason:'Full Lite coverage is required.'}]) {
    const result=plan(current,{discover:()=>mixed,inventoryProjects:['auth','fullscreen','asyncapi']});
    assert.deepEqual(result.selection_metrics.direct_test_files,[]);
    assert.ok(result.tests.length>0);
    assert.ok(result.tests.every(test=>test.tags.includes('@variant:lite')));
  }
  const invalid={...other,tags:other.tags.filter(tag=>!tag.startsWith('@variant:'))};
  const missingMetadata={...inventory,suites:[...inventory.suites,{title:'asyncapi',specs:[invalid]}]};
  assert.throws(()=>plan(raw,{discover:()=>missingMetadata}),/Invalid or missing variant/);
  assert.throws(()=>plan(raw),/directly changed spec absent/);
});

test('scenario grep matches atomic tokens and rejects prefixes and cross-pairs', () => {
  const raw = selection();
  const resolved = resolveSelection({ selection: raw, files, head, tree });
  const regex = new RegExp(resolved.agent_grep);
  assert.match(`case ${scenarioTag(pair)} @variant:lite`, regex);
  assert.doesNotMatch(`case ${scenarioTag(pair)}-extra`, regex);
  assert.doesNotMatch('case @scenario:connect-mcp:editor', regex);
  assert.deepEqual(resolved.agent_scenarios, [pair]);
  assert.deepEqual(resolved.agent_scenario_tags, [scenarioTag(pair)]);
  assert.throws(() => resolveSelection({selection:selection({product_impact_fingerprint:'stale'}),files,head,tree}), /invalid-agent-decision/);
});

test('exact pair union excludes crossed combinations and selects a multi-pair test once', () => {
  const a = {feature:'create-diagram',interface:'editor'};
  const b = {feature:'publishing',interface:'fullscreen-editor'};
  const raw = selection({source_paths:['src/Workspace.vue'],scenarios:[a,b]});
  const tagged = (id, pairs, extra=[]) => ({...spec(id, `fullscreen/${id}.spec.ts`, names[0]), tags:[
    `@test:${names[0]}`, '@variant:lite', ...pairs.map(p=>`@scenario:${p.feature}:${p.interface}`), ...extra,
  ]});
  const data={config:{projects:[]},suites:[{title:'tests',specs:[
    tagged('required',[],['@smoke']), tagged('a',[a]), tagged('b',[b]), tagged('shared',[a,b]),
    tagged('wrong-cross-a',[{feature:'create-diagram',interface:'fullscreen-editor'}]),
    tagged('wrong-cross-b',[{feature:'publishing',interface:'editor'}]),
  ]}]};
  const result=plan(raw,{discover:()=>data,scenarioInventory:[{file:'fullscreen/a.spec.ts',variants:['lite'],scenarios:[a]},{file:'fullscreen/b.spec.ts',variants:['lite'],scenarios:[b]}]});
  assert.deepEqual(result.tests.map(t=>t.id),['required','a','b','shared']);
  assert.equal(result.tests.filter(t=>t.id==='shared').length,1);
});

test('manual full survives candidate product catalog drift while selected fails closed', () => {
  const stale = { product_impact_fingerprint: 'e'.repeat(64), scenario_coverage_fingerprint: 'f'.repeat(64), scenarios: [{feature:'removed-feature',interface:'removed-interface'}] };
  assert.throws(() => plan(selection(stale)), /invalid-agent-decision/);
  const full = selection({...stale, mode:'all', source:'triage', full_reason:'Catalog maintenance requires the full candidate inventory.'});
  const resolved = resolveSelection({selection:full,files,head,tree});
  assert.equal(resolved.mode, 'all');
  assert.equal(resolved.product_impact_fingerprint, stale.product_impact_fingerprint);
  assert.equal(resolved.scenario_coverage_fingerprint, stale.scenario_coverage_fingerprint);
  assert.deepEqual(resolved.agent_scenario_tags, []);
  assert.deepEqual(resolved.agent_categories, []);
  assert.equal(plan(full).tests.length, 4);
  assert.throws(() => plan({...full, product_impact_fingerprint:'bad'}), /invalid-agent-decision/);
});

test('directly changed sequence edit spec retains rendering dependency', () => {
  const raw = selection({scenarios:[], source_paths:['tests/e2e-tests/tests/fullscreen/sequence-edit.spec.ts']});
  const resolved = resolveSelection({selection:raw,files:raw.source_paths,head,tree});
  assert.ok(resolved.agent_categories.includes('@test:sequence-render'));
});

test('registered runnable scenario missing from actual discovery blocks instead of silently running smoke', () => {
  const missing=structuredClone(inventory);
  for (const test of missing.suites[0].specs) test.tags=test.tags.filter(tag=>!tag.startsWith('@scenario:'));
  assert.throws(()=>plan(selection(),{discover:()=>missing}),/scenario absent from inventory/);
});

test('partial scenario inventory loss blocks when another file still matches the same pair', () => {
  assert.throws(()=>plan(selection(),{scenarioInventory:[...fixtureCoverage,{file:'fullscreen/missing.spec.ts',variants:['lite'],scenarios:[pair]}]}),/scenario absent from inventory.*missing/);
});
