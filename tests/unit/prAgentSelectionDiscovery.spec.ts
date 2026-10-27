import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { expect, it } from 'vitest';
import { SCENARIOS } from '../e2e-tests/config/product-impact.mjs';
import { hasPrCoverage } from '../e2e-tests/config/scenario-coverage.mjs';
import { catalog } from '../../scripts/test-selection/pr-decision.mjs';
import { resolveSelection } from '../../scripts/test-selection/resolve.mjs';
import { scopedPlan } from '../../scripts/test-selection/scoped-plan.mjs';
import { POLICY_VERSION, EXECUTION_SELECTOR_CATALOG_FINGERPRINT } from '../../scripts/test-selection/classify.mjs';
import { CATEGORIES, CATEGORY_VERSION } from '../e2e-tests/config/categories.mjs';
import { EXECUTION_SELECTOR_CATALOG_VERSION } from '../e2e-tests/config/impact-map.mjs';

const cwd = resolve('tests/e2e-tests');
// Collection only: no browsers, authentication, local secrets or model requests.
const discoveryEnv = { PATH: process.env.PATH, HOME: process.env.HOME, CI: 'true', APP: 'zenuml-lite@stg', ATLASSIAN_OTP: 'JBSWY3DPEHPK3PXP', DOTENV_CONFIG_PATH: join(tmpdir(), 'agent-discovery-no-local-env') };
const head = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim();
const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {encoding:'utf8'}).trim();
const paths = ['src/components/Mermaid.vue', 'tests/e2e-tests/tests/fullscreen/sequence-create.spec.ts', 'tests/e2e-tests/helpers/agentLink.ts'];
const inventories = new Map<string, any>();
function discover(scope: string) {
  if (!inventories.has(scope)) {
    const projects = scope === 'render' ? ['auth','pages','render'] : ['auth','insert','feedback','syntax-validation','fullscreen','agent-link','asyncapi'];
    inventories.set(scope, JSON.parse(execFileSync('pnpm', ['exec','playwright','test','--list','--reporter=json',...projects.map(project=>`--project=${project}`)], {cwd,env:discoveryEnv,encoding:'utf8',maxBuffer:16*1024*1024})));
  }
  return inventories.get(scope);
}
const pair = { feature:'create-diagram', interface:'editor' };
function selection(chosen: typeof pair[] = [pair]) {
  return {schema_version:1, ...catalog, decision_schema_version:2, scenarios:chosen, category_version:CATEGORY_VERSION, policy_version:POLICY_VERSION,
    selector_catalog_version:EXECUTION_SELECTOR_CATALOG_VERSION, selector_catalog_fingerprint:EXECUTION_SELECTOR_CATALOG_FINGERPRINT,
    head_sha:head, tested_tree:tree, pr_head_sha:head, base_sha:'c'.repeat(40), pr_number:42, decision_id:100,
    selection_scope:'pr', decision_source:'agent', source:'labeling', source_paths:paths, removed_paths:[],
    mode:'selected',execution_mode:'enabled',diff_complete:true,required:['smoke'],fallback_reason:null,
    request:{outcome:'not-requested'},model:null,categories:Object.fromEntries(CATEGORIES.map(c=>[c.id,{selected:false}]))};
}
function plan(raw: any, scope: string, overrides = {}) {
  const resolved = resolveSelection({selection:raw,files:paths,head,tree});
  return scopedPlan({discover:()=>discover(scope),selection:raw,resolved,head,tree,policy:POLICY_VERSION,variant:'lite',scope,shards:4,grep:resolved.grep,sourcePaths:paths,selectionScope:'pr',requireAgentDecision:true,...overrides});
}
const ids = (tests: any[]) => tests.map(test=>test.id).sort();

it('agent plans exact smoke, directly changed specs, helper dependencies and behavior dependencies from real Lite inventories', () => {
  const raw=selection();
  const resolved=resolveSelection({selection:raw,files:paths,head,tree});
  expect(resolved.agent_scenario_tags).toEqual(['@scenario:create-diagram:editor']);
  expect(resolved.agent_categories).toContain('@test:mermaid-render');
  for (const scope of ['all','render']) {
    const subset=plan(raw,scope);
    const full=plan({...raw,mode:'all',source:'triage',full_reason:'Inventory reference for a verified full decision.'},scope);
    const expected=full.tests.filter((test:any)=>test.tags.includes('@smoke') || resolved.direct_test_files.includes(test.file) || test.tags.some((tag:string)=>[...resolved.agent_categories, ...resolved.agent_scenario_tags].includes(tag)));
    expect(ids(subset.tests)).toEqual(ids(expected));
    expect(subset.tests.length).toBeGreaterThan(0);
    expect(subset.tests.length).toBeLessThan(full.tests.length);
    expect(subset.selection_metrics.missing_floor_ids).toEqual([]);
    expect(subset.selection_metrics.request.outcome).toBe('not-requested');
    if (scope==='all') {
      for (const file of ['fullscreen/sequence-create.spec.ts','agent-link/agent-link-e2e.spec.ts','agent-link/agent-link-multi-page-crosstalk.spec.ts']) {
        const required=full.tests.filter((test:any)=>test.file===file);
        expect(required.length,file).toBeGreaterThan(0);
        expect(ids(subset.tests)).toEqual(expect.arrayContaining(ids(required)));
      }
      expect(subset.dependencies).toContain('auth');
    } else expect(subset.dependencies).toEqual(expect.arrayContaining(['auth','pages']));
    console.info(`Lite ${scope}: selected ${subset.tests.length}/${full.tests.length}, required floor ${subset.selection_metrics.legacy_count}`);
  }
}, 15000);

it('triage-approved full plans retain complete real regression and render inventories', () => {
  for (const scope of ['all','render']) {
    const full=plan({...selection(),mode:'all',source:'triage',full_reason:'Cross-surface contract requires the complete Lite inventory.'},scope);
    expect(full.tests.length).toBe(full.selection_metrics.full_count);
    expect(full.tests.length).toBeGreaterThan(0);
    expect(full.coverage).toBe('full');
    expect(full.selection_metrics.mode).toBe('all');
    expect(full.fallback_reason).toBeNull();
  }
});

it('zero-scenario render keeps direct-spec dependencies and stale or missing authorization blocks', () => {
  const raw=selection([]);
  const empty=plan(raw,'render');
  expect(empty.tests.length).toBeGreaterThan(0);
  expect(empty.tests.every((test:any)=>test.tags.includes('@test:sequence-render'))).toBe(true);
  expect(empty.selection_metrics.full_count).toBeGreaterThan(0);
  expect(()=>plan(raw,'all',{resolved:null})).toThrow(/blocked/);
  expect(()=>plan(raw,'all',{head:'d'.repeat(40)})).toThrow(/blocked/);
});


it('prepare-plan assigns a directly changed render spec to render and lets regression retain its own inventory', () => {
  const temp=mkdtempSync(join(tmpdir(),'agent-render-direct-'));
  const changed=['tests/e2e-tests/tests/render/mermaid.spec.ts'];
  try {
    for (const mode of ['selected','all']) {
      const raw={...selection([]),source_paths:changed,mode,source:mode==='all'?'triage':'labeling',full_reason:mode==='all'?'Cross-surface rendering changes require full coverage.':null};
      const resolved=resolveSelection({selection:raw,files:changed,head,tree});
      writeFileSync(join(temp,'selection.json'),JSON.stringify(raw));
      writeFileSync(join(temp,'resolved.json'),JSON.stringify(resolved));
      writeFileSync(join(temp,'paths.txt'),changed.join('\n')+'\n');
      for (const suite of ['regression','render']) {
        execFileSync('node',['../../scripts/test-selection/prepare-plan.mjs'],{cwd,env:{...discoveryEnv,TEST_SUITE:suite,REQUIRE_PR_DECISION:'true',SELECTION_SCOPE:'pr',LEGACY_GREP:resolved.grep,SELECTION_PATH:join(temp,'selection.json'),RESOLVED_SELECTION_PATH:join(temp,'resolved.json'),CHANGED_FILES_PATH:join(temp,'paths.txt'),PLAN_PATH:join(temp,'plan.json'),METRICS_PATH:join(temp,'metrics.json')},encoding:'utf8'});
        const planned=JSON.parse(readFileSync(join(temp,'plan.json'),'utf8'));
        expect(planned.tests.length).toBeGreaterThan(0);
        expect(planned.selection_metrics.mode).toBe(mode);
        expect(planned.selection_metrics.direct_test_files).toEqual(suite==='render'?['render/mermaid.spec.ts']:[]);
        if (suite==='render') expect(planned.tests.some((test:any)=>test.file==='render/mermaid.spec.ts')).toBe(true);
        else expect(planned.tests.every((test:any)=>test.project!=='render')).toBe(true);
      }
    }
  } finally {rmSync(temp,{recursive:true,force:true});}
},15000);


it('real AsyncAPI-only direct specs do not block Lite selected or triage-approved full plans', () => {
  const changed=['tests/e2e-tests/tests/asyncapi/create-edit.spec.ts'];
  for (const mode of ['selected','all']) {
    const raw={...selection([]),source_paths:changed,mode,source:mode==='all'?'triage':'labeling',full_reason:mode==='all'?'Full Lite validation remains required.':null};
    const resolved=resolveSelection({selection:raw,files:changed,head,tree});
    const planned=scopedPlan({discover:()=>discover('all'),selection:raw,resolved,head,tree,policy:POLICY_VERSION,variant:'lite',scope:'all',shards:4,grep:resolved.grep,sourcePaths:changed,selectionScope:'pr',requireAgentDecision:true,inventoryProjects:['auth','insert','feedback','syntax-validation','fullscreen','agent-link','asyncapi']});
    expect(planned.tests.length).toBeGreaterThan(0);
    expect(planned.selection_metrics.mode).toBe(mode);
    expect(planned.selection_metrics.direct_test_files).toEqual([]);
    expect(planned.tests.every((test:any)=>test.tags.includes('@variant:lite'))).toBe(true);
  }
});


it('every advertised default PR pair is present in actual configured test inventories', () => {
  for (const scenario of SCENARIOS.filter(hasPrCoverage)) {
    for (const scope of ['all','render']) {
      const planned = plan(selection([scenario]), scope, {inventoryProjects:scope === 'all' ? ['auth','insert','feedback','syntax-validation','fullscreen','agent-link','asyncapi'] : ['auth','pages','render']});
      expect(planned.selection_metrics.mode).toBe('selected');
      expect(planned.selection_metrics.missing_floor_ids).toEqual([]);
      expect(new Set(planned.tests.map((test: any) => test.id)).size).toBe(planned.tests.length);
    }
  }
  expect(() => plan(selection([{feature:'prepared-diagram-activation',interface:'byline-activation'}]),'all')).toThrow(/scenario-without-e2e-coverage/);
},15000);
