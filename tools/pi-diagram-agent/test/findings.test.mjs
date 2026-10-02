import test from 'node:test';
import assert from 'node:assert/strict';
import {makeFinding,findingKey,createLedger,selectForAuthor,formatForAuthor,auditToFindings} from '../src/findings.mjs';

const f=(over={})=>makeFinding({source:'audit',severity:'blocking',rule:'routeCrossings',elements:['B->C','A->B'],region:null,evidence:{measured:'2 crossings',threshold:'0'},suggestion:'reroute',...over});

test('finding key is rule + sorted unique element ids, independent of order',()=>{
  assert.equal(findingKey('r',['b','a','b']),'r|a,b');
  assert.equal(f().key,f({elements:['A->B','B->C']}).key);
  assert.equal(f().key,'routeCrossings|A->B,B->C');
  assert.match(f().id,/^F-[0-9a-f]{8}$/);
  assert.notEqual(f().id,f({rule:'arrowShaft'}).id);
});

test('makeFinding validates the findings format',()=>{
  const x=f();
  for(const k of ['id','key','source','severity','rule','elements','region','evidence','suggestion'])assert.ok(k in x,k);
  assert.deepEqual(x.elements,['A->B','B->C']);
  assert.throws(()=>makeFinding({source:'nope',severity:'blocking',rule:'r',elements:[]}),/FINDING_SOURCE/);
  assert.throws(()=>makeFinding({source:'audit',severity:'huge',rule:'r',elements:[]}),/FINDING_SEVERITY/);
  assert.throws(()=>makeFinding({source:'audit',severity:'minor',rule:'',elements:[]}),/FINDING_RULE/);
});

test('ledger: open -> fixed -> regressed, oscillations counted',()=>{
  const L=createLedger();
  L.update(1,[f()],{sources:['audit']});
  assert.equal(L.get(f().key).state,'open');
  L.update(2,[],{sources:['audit']});
  assert.equal(L.get(f().key).state,'fixed');
  L.update(3,[f()],{sources:['audit']});
  const e=L.get(f().key);
  assert.equal(e.state,'regressed');assert.equal(e.oscillations,1);
  L.update(4,[f()],{sources:['audit']});
  assert.equal(L.get(f().key).state,'regressed');
  assert.deepEqual(L.get(f().key).history.map(h=>[h.round,h.state]),[[1,'open'],[2,'fixed'],[3,'regressed'],[4,'regressed']]);
});

test('ledger: a source that did not run this round cannot mark its findings fixed',()=>{
  const L=createLedger();
  const rev=f({source:'review',rule:'label-ownership',elements:['A->B']});
  L.update(1,[rev],{sources:['audit','review']});
  L.update(2,[f()],{sources:['audit']}); // audit failed, reviewer skipped
  assert.equal(L.get(rev.key).state,'open');
  L.update(3,[],{sources:['audit','review']});
  assert.equal(L.get(rev.key).state,'fixed');
  assert.equal(L.get(f().key).state,'fixed');
});

test('ledger: reviewer blocking marked fixed with an unchanged region signature is a false-block candidate',()=>{
  const L=createLedger();
  const rev=f({source:'review',rule:'detour',elements:['A->C']});
  L.update(1,[rev],{sources:['audit','review'],sigOf:()=>'sig-1'});
  L.update(2,[],{sources:['audit','review'],sigOf:()=>'sig-1'});
  assert.equal(L.get(rev.key).falseBlockCandidate,true);
  const L2=createLedger();
  L2.update(1,[rev],{sources:['audit','review'],sigOf:()=>'sig-1'});
  L2.update(2,[],{sources:['audit','review'],sigOf:()=>'sig-2'});
  assert.equal(L2.get(rev.key).falseBlockCandidate,false);
  const L3=createLedger(),aud=f();
  L3.update(1,[aud],{sources:['audit'],sigOf:()=>'s'});L3.update(2,[],{sources:['audit'],sigOf:()=>'s'});
  assert.equal(L3.get(aud.key).falseBlockCandidate,false); // audit findings are never "false blocks"
});

test('selectForAuthor sends at most 5 blocking findings, regressed then audit then review, minors excluded',()=>{
  const L=createLedger();
  const mk=(i,over)=>f({rule:`rule${i}`,elements:[`n${i}`],...over});
  const fs=[mk(1,{source:'review'}),mk(2,{source:'review'}),mk(3),mk(4),mk(5),mk(6,{source:'review'}),mk(7,{severity:'minor'})];
  L.update(1,[mk(2,{source:'review'})],{sources:['audit','review']});
  L.update(2,[],{sources:['audit','review']});
  L.update(3,fs,{sources:['audit','review']});
  const sel=selectForAuthor(L,{max:5});
  assert.equal(sel.sent.length,5);
  assert.equal(sel.omittedBlocking,1);
  assert.equal(sel.sent[0].rule,'rule2'); // regressed first
  assert.deepEqual(sel.sent.slice(1,4).map(x=>x.source),['audit','audit','audit']);
  assert.ok(sel.sent.every(x=>x.severity==='blocking'));
  assert.equal(sel.minorCount,1);
});

test('formatForAuthor is structured: every finding names rule, elements, region, measured vs threshold, direction',()=>{
  const L=createLedger();
  L.update(1,[f({region:{x:1,y:2,w:3,h:4}})],{sources:['audit']});
  const out=formatForAuthor(selectForAuthor(L));
  assert.equal(out.findings.length,1);
  const x=out.findings[0];
  assert.deepEqual(Object.keys(x).sort(),['elements','evidence','id','region','rule','severity','source','state','suggestion']);
  assert.equal(x.evidence.measured,'2 crossings');assert.equal(x.evidence.threshold,'0');
  assert.equal(x.state,'open');
});

const audit=(checks)=>({status:'FAIL',checks:Object.fromEntries(Object.entries(checks).map(([k,v])=>[k,v]))});
test('auditToFindings: FAIL checks become blocking findings with ids, measured and threshold; PASS and NOT-CHECKABLE do not',()=>{
  const a=audit({
    nodeIdentity:{status:'FAIL',evidence:{expected:3,drawn:2,missing:['C'],extra:[]}},
    routeCrossings:{status:'FAIL',evidence:{method:'exact interior intersections among straight spans',violations:[{edgeA:'A->B',edgeB:'B->C',x:10,y:20}],checkedEdges:2}},
    textFit:{status:'FAIL',evidence:{method:'getBBox vs outline',overflows:[{nodeId:'B',left:0,top:0,right:3.5,bottom:0}],checkedNodes:3}},
    arrowShaft:{status:'PASS',evidence:{method:'m',failures:[]}},
    routeGeometry:{status:'NOT-CHECKABLE',evidence:'x'},
  });
  const out=auditToFindings(a);
  assert.deepEqual(out.map(x=>x.rule).sort(),['nodeIdentity','routeCrossings','textFit']);
  const by=Object.fromEntries(out.map(x=>[x.rule,x]));
  assert.deepEqual(by.nodeIdentity.elements,['C']);
  assert.deepEqual(by.routeCrossings.elements,['A->B','B->C']);
  assert.deepEqual(by.textFit.elements,['B']);
  for(const x of out){assert.equal(x.source,'audit');assert.equal(x.severity,'blocking');assert.ok(x.evidence.measured);assert.ok(x.evidence.threshold);assert.ok(x.suggestion.length>10)}
  assert.match(by.routeCrossings.evidence.threshold,/straight spans/);
});

test('auditToFindings: svgWellFormed failure and an unparseable audit still produce an actionable finding',()=>{
  const out=auditToFindings({status:'FAIL',checks:{svgWellFormed:{status:'FAIL',evidence:'SVG XML parser rejected source'}}});
  assert.equal(out.length,1);assert.equal(out[0].rule,'svgWellFormed');assert.match(out[0].evidence.measured,/rejected/);
  assert.deepEqual(auditToFindings(null),[]);
});

test('a source definition conflict finding tells the author what Mermaid draws and that the source needs the user',()=>{
  const [f]=auditToFindings({checks:{sourceDefinitionConflicts:{status:'FAIL',evidence:{nodeIds:['A'],conflicts:[]}}}});
  assert.deepEqual(f.elements,['A']);
  assert.match(f.suggestion,/last definition/);assert.match(f.suggestion,/user/);
});
