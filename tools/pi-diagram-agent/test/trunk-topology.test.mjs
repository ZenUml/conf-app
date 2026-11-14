import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedSuffix,isAcceptedTrunkOverlap,isSharedTrunkJoin,checkTrunkSemantics,earlyMergeAdvisories} from '../src/trunk.mjs';
import {checkRouteLowerBend} from '../src/route-lower-bend.mjs';
const spans=pts=>pts.slice(1).map((b,i)=>{const a=pts[i],axis=a[1]===b[1]?'h':'v',k=axis==='h'?0:1;return {axis,fixed:a[1-k],start:a[k],end:b[k],lo:Math.min(a[k],b[k]),hi:Math.max(a[k],b[k]),dir:Math.sign(b[k]-a[k]),corner:b[k]}});
const route=(edge,points,patch={})=>({edge,trunk:'f',source:edge,target:'T',points,spans:spans(points),style:{dash:'none',width:1,stroke:'black'},...patch});
const A=route('A',[[0,0],[100,0],[100,100],[200,100],[200,200],[300,200]]);
const B=route('B',[[0,40],[100,40],[100,80],[100,100],[200,100],[200,200],[300,200]]);
const C=route('C',[[300,80],[200,80],[200,200],[300,200]]);
test('incremental continuous multi-bend suffix includes partial span and subdivisions',()=>{
 const s=sharedSuffix(A,B);assert.deepEqual(s.join,[100,40]);assert.equal(s.sections.length,4);assert.equal(s.length,360);
 assert.equal(isAcceptedTrunkOverlap(A,B,A.spans[1],B.spans[1]),true);
 assert.deepEqual(sharedSuffix(A,C).join,[200,100]);
 assert.equal(isSharedTrunkJoin(A,B,{x:100,y:40}),true);
 assert.equal(isSharedTrunkJoin(A,B,{x:50,y:0}),false);
 assert.deepEqual(checkTrunkSemantics({routes:[A,B,C]}),[]);
});
test('no disconnected earlier sharing, reversed suffix, wrong target or mixed style exemption',()=>{
 const split=route('split',[[0,0],[100,0],[100,50],[50,50],[50,100],[200,100],[200,200],[300,200]]);
 assert.equal(isAcceptedTrunkOverlap(A,split,A.spans[0],split.spans[0]),false);
 assert.equal(sharedSuffix(A,{...B,target:'U'}),null);
 const near=route('near',B.points.map(p=>[p[0]+0.1,p[1]]));assert.equal(sharedSuffix(A,near),null);
 assert.equal(sharedSuffix({...A,trim:5},{...B,trim:3}),null);
 assert.equal(sharedSuffix(A,{...B,style:{...B.style,dash:'4 4'}}),null);
 const reversed=route('reversed',[[400,200],[300,200]]);assert.equal(sharedSuffix(A,reversed),null);
 assert.ok(checkTrunkSemantics({routes:[A,{...B,target:'U'}]}).some(v=>v.kind==='mixed-target trunk'));
});
test('all shared sections protect labels and near lanes stay advisory only',()=>{
 const labels=checkTrunkSemantics({routes:[A,B],labelBoxes:[{label:'generic',box:{x:96,y:60,w:8,h:10}}]});assert.ok(labels.some(v=>v.kind==='label on shared trunk'));
 const a=route('a',[[0,0],[100,0],[100,150],[200,150]]),b=route('b',[[0,20],[120,20],[120,150],[200,150]]);
 const advice=earlyMergeAdvisories({routes:[a,b]});assert.ok(advice.some(v=>v.reason==='long duplicate premerge parallel lanes'));
 assert.equal(checkTrunkSemantics({routes:[a,b]}).length,0);
 const separate=route('separate',[[0,20],[100,20],[100,170],[200,170]]);assert.ok(earlyMergeAdvisories({routes:[a,separate]}).length);
});
const node=(id,x,y,w=20,h=20)=>({id,kind:'rect',outline:{x,y,w,h},bbox:{x,y,w,h},cornerRadius:0});
const path=points=>'M'+points[0].join(' ')+' '+points.slice(1).map(p=>'L'+p.join(' ')).join(' ');
const inputEdge=(r,source)=>({...r,source,tag:'path',path:path(r.points),axialLength:0,hulls:[]});
test('witness preserves multi-bend suffix instead of independent direct route',()=>{
 const a=route('A',[[20,10],[70,10],[70,80],[120,80],[120,150],[200,150]]),b=route('B',[[20,50],[70,50],[70,80],[120,80],[120,150],[200,150]]);
 const result=checkRouteLowerBend({nodes:[node('A',0,0),node('B',0,40),node('T',200,140)],groups:[],edges:[inputEdge(a,'A'),inputEdge(b,'B')]},{mode:'hint',hintEdges:['A->T']});
 const h=result.hints['A->T'].hint;assert.ok(h,result.hints['A->T'].reason);assert.deepEqual(h.preservedSuffix,[[70,50],[70,80],[120,80],[120,150],[200,150]]);
 assert.ok(h.points.some(p=>p[0]===120&&p[1]===80));assert.ok(h.points.some(p=>p[0]===120&&p[1]===150));
});
test('headings no longer obstruct a straight witness but ancestor border does',()=>{
 const r=route('A',[[20,10],[50,10],[50,60],[100,60]],{trunk:null,target:'T'}),input={nodes:[node('A',0,0),node('T',100,50)],groups:[{id:'g',outline:'rect',box:{x:-10,y:-10,w:150,h:100},headings:[{x:45,y:0,w:30,h:80}]}],edges:[inputEdge(r,'A')]};
 const result=checkRouteLowerBend(input,{mode:'hint',hintEdges:['A->T']});assert.ok(result.hints['A->T'].hint);
 const border=checkRouteLowerBend({...input,groups:[{id:'g',outline:'rect',box:{x:20,y:-10,w:80,h:100},headings:[]}]},{mode:'hint',hintEdges:['A->T']});
 const hint=border.hints['A->T'].hint;if(hint)assert.ok(hint.points.slice(1).every((p,i)=>!(p[0]===20&&hint.points[i][0]===20&&p[1]!==hint.points[i][1])));
});

test('same-family premerge crossing is advice rather than a declared join',()=>{
 const a=route('a',[[0,0],[100,0],[100,100],[200,100]]),b=route('b',[[50,-50],[50,50],[100,50],[100,100],[200,100]]);
 assert.equal(isSharedTrunkJoin(a,b,{x:50,y:0}),false);
 assert.ok(earlyMergeAdvisories({routes:[a,b]}).some(v=>v.reason==='same-family premerge crossing'));
});

test('mixed measured fillet radii are safely unresolved, never a crashed or independent witness',()=>{
 const a=route('A',[[20,10],[70,10],[70,80],[120,80],[120,150],[200,150]]),b=route('B',[[20,50],[70,50],[70,80],[120,80],[120,150],[200,150]]);
 const rounded=(pts,r)=>`M${pts[0].join(' ')} `+pts.slice(1,-1).map((p,i)=>{const prev=pts[i],next=pts[i+2],before=Math.hypot(p[0]-prev[0],p[1]-prev[1]),after=Math.hypot(next[0]-p[0],next[1]-p[1]);const enter=p.map((v,k)=>v+(prev[k]-v)*r/before),leave=p.map((v,k)=>v+(next[k]-v)*r/after);return `L${enter.join(' ')} Q${p.join(' ')} ${leave.join(' ')}`}).join(' ')+` L${pts.at(-1).join(' ')}`;
 const edges=[inputEdge(a,'A'),inputEdge(b,'B')];edges[0].path=rounded(a.points,5);edges[1].path=rounded(b.points,3);
 const result=checkRouteLowerBend({nodes:[node('A',0,0),node('B',0,40),node('T',200,140)],groups:[],edges});
 assert.ok(result.evidence.relations.every(r=>r.status==='NOT-CHECKABLE'));assert.ok(result.evidence.relations.every(r=>/fillet radii/.test(r.reason)));
 edges[1].path=rounded(b.points,5);edges[1].style={...edges[1].style,dash:'4 4'};const mixed=checkRouteLowerBend({nodes:[node('A',0,0),node('B',0,40),node('T',200,140)],groups:[],edges});assert.ok(mixed.evidence.relations.every(r=>r.status==='NOT-CHECKABLE'));assert.equal(mixed.evidence.violations.length,0);
});
