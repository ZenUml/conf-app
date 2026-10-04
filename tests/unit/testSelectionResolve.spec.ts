import { describe, it, expect } from 'vitest';
import { createPlan } from '../../scripts/test-selection/plan.mjs';
import { resolveSelection } from '../../scripts/test-selection/resolve.mjs';
import { POLICY_VERSION } from '../../scripts/test-selection/classify.mjs';
import { CATEGORIES, CATEGORY_VERSION } from '../e2e-tests/config/categories.mjs';
const head = 'a'.repeat(40), tree = 'b'.repeat(40);
const selected = CATEGORIES[0].id;
const selection = { schema_version: 1, head_sha: head, tested_tree: tree, policy_version: POLICY_VERSION, category_version: CATEGORY_VERSION, mode: 'selected', execution_mode: 'enabled', diff_complete: true, required: ['smoke'], request: { outcome: 'success' }, categories: Object.fromEntries(CATEGORIES.map(c => [c.id, { probability: c.id === selected ? 0.4 : 0.02, selected: c.id === selected }])) };
const input = { selection, files: ['src/components/Mermaid.vue'], head, tree };
describe('guarded Jev execution resolver', () => {
  it('runs smoke, Jev decisions and all previous deterministic tags', () => {
    const r = resolveSelection(input);
    expect(r.mode).toBe('selected');
    expect(r.tags).toEqual(expect.arrayContaining(['@smoke', '@mermaid', '@viewer', '@editor', '@viewport', `@test:${selected}`]));
    expect(r.grep).toContain(`@test:${selected}`);
  });
  it('retains deterministic-only and widened auxiliary tests in the exact plan', () => {
    const discovery = { suites: [{title:'tests', specs:[
      {id:'smoke',file:'insert/example.spec.ts',title:'smoke',tags:['@smoke','@variant:lite',`@test:${selected}`],tests:[{projectName:'insert'}]},
      {id:'floor',file:'insert/example.spec.ts',title:'floor',tags:['@mermaid','@variant:lite',`@test:${CATEGORIES[1].id}`],tests:[{projectName:'insert'}]},
    ]}]};
    const plan = createPlan({selection,discovery,variant:'lite',tree,policy:POLICY_VERSION,scope:'insert',legacyGrep:resolveSelection(input).grep});
    expect(plan.tests.map(t => t.id)).toEqual(['smoke','floor']);
    expect(plan.coverage).toBe('selected');
    const auxiliary = {...discovery,suites:[{title:'tests',specs:[discovery.suites[0].specs[1]]}]};
    expect(createPlan({selection,discovery:auxiliary,variant:'lite',tree,policy:POLICY_VERSION,scope:'render'}).tests.map(t => t.id)).toEqual(['floor']);
  });
  it.each([null, {...selection, tested_tree: 'stale'}, {...selection, head_sha: 'stale'}, {...selection, policy_version: 'v1-uncalibrated'}, {...selection, execution_mode: 'observe'}, {...selection, categories: {}}, {...selection, fallback_reason: 'api-http-error'}, {...selection, request: {outcome:'failed'}}, {...selection, required: []}, {...selection, required: {}}])('fails full for missing or invalid decisions', s => expect(resolveSelection({...input,selection:s}).mode).toBe('all'));
  it('never overrides shared, unmapped or human full coverage', () => {
    for (const files of [['src/model/Diagram/Diagram.ts'], ['unknown/path']]) expect(resolveSelection({...input, files}).mode).toBe('all');
    expect(resolveSelection({...input, humanFull:true}).mode).toBe('all');
  });
  it('rejects inconsistent probability and selected fields', () => expect(resolveSelection({...input,selection:{...selection,categories:{...selection.categories,[selected]:{probability:0.02,selected:true}}}}).mode).toBe('all'));
});
