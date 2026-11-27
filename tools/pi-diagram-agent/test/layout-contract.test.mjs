import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMermaid} from '../src/parser.mjs';
import {hashLayoutIntent} from '../src/layout-intent.mjs';
import {LayoutContract} from '../src/layout-contract.mjs';
const source='flowchart LR\nsubgraph G[Group]\n A[start]\nend\n A --> B[end]\n';
const model=parseMermaid(source);
const plan=()=>({purpose:'Explain handoff',readingOrder:'Left to right',layoutGrammar:'Two source-specific stages with group retained',nodes:model.nodes.map(n=>({id:n.id,role:n.id==='A'?'origin':'result',layer:n.id==='A'?'start':'finish',peers:[],groupPath:n.groupPath})),relations:model.edges.map(({id,source,target})=>({id,source,target})),constraints:[{priority:'hard',reason:'Source containment',description:'Retain source groups and direction',nodeIds:['A','B']},{priority:'soft',reason:'Reading flow',description:'Prefer horizontal placement',nodeIds:['A','B']}],uncertainties:[]});
const make=(over={})=>new LayoutContract({required:true,sourceHash:'source-hash',rulesHash:'rules-hash',model,...over});
const FAILED_KEYS=['layout_contract_outcome','layout_contract_reason','name'];

test('require() throws only when required and not yet frozen',()=>{
 assert.throws(()=>make().require(),/LAYOUT_INTENT_REQUIRED: submit semantic plan through diagram_layout_intent before authoring/);
 assert.doesNotThrow(()=>make({required:false}).require());
 assert.doesNotThrow(()=>new LayoutContract().require());
 const c=make();c.submit({intent:plan()});
 assert.doesNotThrow(()=>c.require());
});

test('an unfrozen contract exposes empty state',()=>{
 const c=make();
 assert.equal(c.required,true);assert.equal(c.current,null);assert.equal(c.hash,null);assert.equal(c.revision,0);
 assert.deepEqual(c.history,[]);assert.deepEqual(c.events,[]);
 assert.equal(new LayoutContract().required,false);assert.equal(new LayoutContract().model,null);
});

test('submit accepts a valid plan and returns a record bound to source and rules',()=>{
 const c=make(),record=c.submit({intent:plan()});
 assert.equal(record.schema,'pi-layout-intent/1');assert.equal(record.sourceHash,'source-hash');assert.equal(record.rulesHash,'rules-hash');
 assert.equal(record.predecessorHash,null);assert.equal(record.reason,null);assert.deepEqual(record.intent,plan());
 assert.equal(record.hash,hashLayoutIntent(record));
 assert.equal(c.hash,record.hash);assert.equal(c.revision,1);assert.deepEqual(c.current,record);assert.deepEqual(c.history,[record]);
 assert.deepEqual(c.events,[{name:'magic_layout_intent_created',layout_intent_hash:record.hash,previous_layout_intent_hash:null,layout_intent_revision:1,layout_contract_outcome:'accepted',layout_node_count:2,layout_layer_count:2}]);
});

test('every read is a copy: callers cannot change the frozen contract',()=>{
 const c=make(),record=c.submit({intent:plan()}),hash=record.hash;
 record.intent.purpose='tampered';record.hash='tampered';
 assert.equal(c.hash,hash);assert.equal(c.current.intent.purpose,'Explain handoff');
 const cur=c.current;cur.intent.purpose='tampered';cur.hash='tampered';
 assert.equal(c.current.intent.purpose,'Explain handoff');assert.equal(c.hash,hash);
 const history=c.history;history[0].hash='tampered';history.push({});
 assert.equal(c.history.length,1);assert.equal(c.history[0].hash,hash);
 const events=c.events;events[0].name='tampered';events.push({});
 assert.equal(c.events.length,1);assert.equal(c.events[0].name,'magic_layout_intent_created');
 const passed=plan();c.submit({intent:passed,predecessorHash:hash,reason:'Revise'});passed.purpose='tampered after submit';
 assert.equal(c.current.intent.purpose,'Explain handoff');
});

test('a second submit without predecessor and reason is rejected and recorded',()=>{
 const c=make(),first=c.submit({intent:plan()});
 assert.throws(()=>c.submit({intent:plan()}),/LAYOUT_INTENT_REVISION_REQUIRES_PREDECESSOR_AND_REASON/);
 assert.throws(()=>c.submit({intent:plan(),predecessorHash:first.hash}),/PREDECESSOR/);
 assert.throws(()=>c.submit({intent:plan(),predecessorHash:first.hash,reason:'   '}),/PREDECESSOR/);
 assert.throws(()=>c.submit({intent:plan(),predecessorHash:'stale',reason:'Revise'}),/PREDECESSOR/);
 assert.equal(c.hash,first.hash);assert.equal(c.revision,1);
 const failed=c.events.slice(1);assert.equal(failed.length,4);
 for(const e of failed){assert.deepEqual(Object.keys(e).sort(),FAILED_KEYS);assert.deepEqual(e,{name:'magic_layout_contract_failed',layout_contract_outcome:'rejected',layout_contract_reason:'LAYOUT_INTENT_REVISION_REQUIRES_PREDECESSOR_AND_REASON'})}
});

test('a revision names its predecessor and a reason, and yields a new hash',()=>{
 const c=make(),first=c.submit({intent:plan()}),p=plan();p.readingOrder='Top to bottom';
 const second=c.submit({intent:p,predecessorHash:first.hash,reason:'Reviewer requested clearer reading order'});
 assert.notEqual(second.hash,first.hash);assert.equal(second.predecessorHash,first.hash);assert.equal(second.reason,'Reviewer requested clearer reading order');
 assert.equal(second.hash,hashLayoutIntent(second));assert.equal(c.hash,second.hash);assert.equal(c.revision,2);
 assert.deepEqual(c.history.map(r=>r.hash),[first.hash,second.hash]);assert.deepEqual(c.current,second);
 assert.deepEqual(c.events.at(-1),{name:'magic_layout_intent_revised',layout_intent_hash:second.hash,previous_layout_intent_hash:first.hash,layout_intent_revision:2,layout_contract_outcome:'accepted',layout_node_count:2,layout_layer_count:2});
});

test('events follow created, failed, revised with exactly the documented keys',()=>{
 const c=make(),first=c.submit({intent:plan()});
 assert.throws(()=>c.submit({intent:plan()}),/PREDECESSOR/);
 const p=plan();p.readingOrder='Top to bottom';c.submit({intent:p,predecessorHash:first.hash,reason:'Reviewer feedback'});
 assert.deepEqual(c.events.map(e=>e.name),['magic_layout_intent_created','magic_layout_contract_failed','magic_layout_intent_revised']);
 assert.deepEqual(Object.keys(c.events[1]).sort(),FAILED_KEYS);
 assert.equal(c.events[1].layout_contract_outcome,'rejected');assert.equal(c.events[1].layout_contract_reason,'LAYOUT_INTENT_REVISION_REQUIRES_PREDECESSOR_AND_REASON');
});

test('an invalid plan is recorded with the failure code only and leaves state untouched',()=>{
 const c=make(),bad=plan();bad.nodes.pop();
 assert.throws(()=>c.submit({intent:bad}),/LAYOUT_CONTRACT_INVALID: missing source nodes/);
 assert.equal(c.current,null);assert.equal(c.revision,0);
 assert.deepEqual(c.events,[{name:'magic_layout_contract_failed',layout_contract_outcome:'rejected',layout_contract_reason:'LAYOUT_CONTRACT_INVALID'}]);
 const record=c.submit({intent:plan()});assert.equal(record.predecessorHash,null);assert.equal(c.revision,1);
});

test('a rejected revision keeps the frozen contract',()=>{
 const c=make(),first=c.submit({intent:plan()}),bad=plan();bad.nodes.pop();
 assert.throws(()=>c.submit({intent:bad,predecessorHash:first.hash,reason:'Try'}),/LAYOUT_CONTRACT_INVALID/);
 assert.equal(c.hash,first.hash);assert.equal(c.revision,1);assert.equal(c.events.at(-1).layout_contract_reason,'LAYOUT_CONTRACT_INVALID');
});

test('setModel rejects unresolved source facts',()=>{
 const c=make({model:null});
 for(const facts of [undefined,null,{},{nodes:[]},{...model,nodes:[]},{...model,conflicts:[{}]},{...model,membershipConflicts:['A']}])assert.throws(()=>c.setModel(facts),/LAYOUT_SOURCE_FACTS_UNRESOLVED/);
 assert.equal(c.model,null);
});

test('setModel stores and returns a copy, then the contract can be planned',()=>{
 const c=make({model:null}),facts=JSON.parse(JSON.stringify(model)),stored=c.setModel(facts);
 assert.deepEqual(stored,facts);assert.notEqual(stored,facts);assert.equal(c.model,stored);
 facts.nodes.pop();assert.equal(c.model.nodes.length,2);
 assert.equal(c.submit({intent:plan()}).hash,c.hash);
});

test('setModel is refused once a contract is frozen',()=>{
 const c=make();c.submit({intent:plan()});
 assert.throws(()=>c.setModel(model),/LAYOUT_INTENT_ALREADY_FROZEN/);
 assert.throws(()=>c.setModel({nodes:[]}),/LAYOUT_SOURCE_FACTS_UNRESOLVED/);
});

test('the constructor copies the model it is given',()=>{
 const own=JSON.parse(JSON.stringify(model)),c=make({model:own});
 own.nodes.pop();assert.equal(c.model.nodes.length,2);
 assert.equal(c.submit({intent:plan()}).intent.nodes.length,2);
});

test('submit without source facts fails with the validator code',()=>{
 const c=make({model:null});
 assert.throws(()=>c.submit({intent:plan()}),/LAYOUT_CONTRACT_INVALID: source facts unavailable/);
 assert.deepEqual(c.events,[{name:'magic_layout_contract_failed',layout_contract_outcome:'rejected',layout_contract_reason:'LAYOUT_CONTRACT_INVALID'}]);
 assert.equal(c.current,null);
});

test('noteSemanticConflict records the review-side failure against the frozen contract',()=>{
 const c=make();c.noteSemanticConflict({round:1});assert.deepEqual(c.events,[]);
 const record=c.submit({intent:plan()});c.noteSemanticConflict({round:3});
 assert.deepEqual(c.events.at(-1),{name:'magic_layout_contract_failed',layout_intent_hash:record.hash,layout_intent_revision:1,layout_contract_outcome:'rejected',layout_contract_reason:'SEMANTIC_LAYOUT_CONFLICT',round:3});
 assert.deepEqual(Object.keys(c.events.at(-1)),['name','layout_intent_hash','layout_intent_revision','layout_contract_outcome','layout_contract_reason','round']);
});

test('manifestFields keeps the sealed key order and survives a JSON round trip',()=>{
 const fresh=make().manifestFields();
 assert.deepEqual(Object.keys(fresh),['layoutIntentRequired','layoutIntent','layoutIntentHistory','layoutIntentEvents']);
 assert.deepEqual(fresh,{layoutIntentRequired:true,layoutIntent:null,layoutIntentHistory:[],layoutIntentEvents:[]});
 const c=make(),first=c.submit({intent:plan()});assert.throws(()=>c.submit({intent:plan()}),/PREDECESSOR/);
 const p=plan();p.readingOrder='Top to bottom';c.submit({intent:p,predecessorHash:first.hash,reason:'Reviewer feedback'});c.noteSemanticConflict({round:2});
 const fields=c.manifestFields();
 assert.deepEqual(Object.keys(fields),['layoutIntentRequired','layoutIntent','layoutIntentHistory','layoutIntentEvents']);
 assert.equal(fields.layoutIntentRequired,true);assert.deepEqual(fields.layoutIntent,c.current);assert.equal(fields.layoutIntentHistory.length,2);assert.equal(fields.layoutIntentEvents.length,4);
 assert.deepEqual(JSON.parse(JSON.stringify(fields)),fields);
 fields.layoutIntent.hash='tampered';fields.layoutIntentHistory.pop();fields.layoutIntentEvents.pop();
 assert.equal(c.manifestFields().layoutIntent.hash,c.hash);assert.equal(c.revision,2);assert.equal(c.events.length,4);
});

test('the required flag is reported as given',()=>{
 assert.deepEqual(make({required:false}).manifestFields().layoutIntentRequired,false);
 assert.equal(make({required:false}).required,false);
});
