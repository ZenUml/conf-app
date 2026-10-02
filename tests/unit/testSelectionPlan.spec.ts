import {describe,it,expect} from 'vitest';
import {createPlan} from '../../scripts/test-selection/plan.mjs';
import {createEvidence,canReuse} from '../../scripts/test-selection/evidence.mjs';
const selection={schema_version:1,tested_tree:'tree',category_version:'v1',policy_version:'v1',mode:'selected',execution_mode:'enabled',categories:{'mermaid-render':{selected:true}}};
const spec=(id:string,tags:string[],file='a.ts')=>({id,file,title:id,tags,line:1,tests:[{projectName:'render'}]});
const discovery={config:{projects:[{name:'render',dependencies:['pages']},{name:'pages',dependencies:['auth']},{name:'auth'}]},suites:[{title:'a.ts',specs:[spec('smoke',['@smoke','@test:sequence-render','@variant:lite'],'s.ts'),spec('mermaid',['@test:mermaid-render','@variant:lite']),spec('other',['@test:graph-render','@variant:lite']),spec('async',['@smoke','@test:asyncapi-dashboard-loads','@variant:asyncapi'])]}]};
const plan=(overrides={})=>createPlan({selection,discovery,variant:'lite',tree:'tree',policy:'v1',shards:8,...overrides});
describe('concrete test planning',()=>{
 it('selects behavior plus smoke and transitive auth dependencies',()=>{const p=plan();expect(p.tests.map(t=>t.id)).toEqual(['smoke','mermaid']);expect(p.dependencies).toEqual(['auth','pages']);expect(p.shards.every(s=>s.test_ids.length)).toBe(true);});
 it('full mode runs applicable inventory',()=>expect(plan({selection:{...selection,mode:'all'}}).tests).toHaveLength(3));
 it('unknown category and stale tree fail full',()=>{expect(plan({selection:{...selection,categories:{unknown:{selected:true}}}}).coverage).toBe('full');expect(plan({tree:'new'}).coverage).toBe('full');});
 it('empty selection retains mandatory smoke',()=>expect(plan({selection:{...selection,categories:{}}}).tests.map(t=>t.id)).toEqual(['smoke']));
 it('variant excludes other inventory',()=>expect(plan({variant:'asyncapi'}).tests.map(t=>t.id)).toEqual(['async']));
 it('does not split file serial groups',()=>{const p=plan({selection:{...selection,mode:'all'}});expect(p.shards.find(s=>s.test_ids.includes('mermaid'))?.test_ids).toContain('other');});
 it('rejects absent smoke',()=>expect(()=>plan({discovery:{...discovery,suites:[]}})).toThrow('smoke'));
 it('reuse requires complete concrete success and identical fingerprints',()=>{const p=plan();const e=createEvidence(p,p.tests.map(t=>({id:t.id,status:'passed'})));expect(canReuse(e,p)).toBe(true);expect(canReuse(e,{...p,tested_tree:'new'})).toBe(false);expect(createEvidence(p,[]).complete).toBe(false);expect(createEvidence(p,[{id:'smoke',status:'skipped'}]).complete).toBe(false);});
});
