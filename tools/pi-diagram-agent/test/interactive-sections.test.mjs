import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveSharedSections} from '../src/interactive-sections.mjs';

const IDENTITY={a:1,b:0,c:0,d:1,e:0,f:0};
const STYLE={dash:'none',width:2,stroke:'black',markerEnd:'url(#arrow)',linecap:'round',linejoin:'round'};
const fact=(id,path,extra={})=>({id,source:`${id}-source`,target:'T',trunk:'family-a',path,rootTransform:IDENTITY,style:STYLE,...extra});
const threePaths=[
  ['A','M0 0 L100 0 L100 100 L500 100'],
  ['B','M0 50 L150 50 L150 100 L500 100'],
  ['C','M0 200 L200 200 L200 100 L500 100'],
];

test('partitions a proved three-edge shared suffix into exact two-member and three-member portions',()=>{
  const sections=deriveSharedSections(threePaths.map(([id,path])=>fact(id,path)));
  assert.deepEqual(sections.map(section=>({members:section.members,points:section.points})),[
    {members:['A','B'],points:[[150,100],[200,100]]},
    {members:['A','B','C'],points:[[200,100],[500,100]]},
  ]);
  assert.ok(sections.every(section=>section.family==='family-a'&&section.id.startsWith('shared:')));
});

test('does not merge different targets, families, computed styles, or marker-end geometry',()=>{
  const base=fact('A','M0 0 L100 0 L100 100 L500 100');
  const same=fact('B','M0 50 L150 50 L150 100 L500 100');
  const wrongTarget=fact('C','M0 200 L200 200 L200 100 L500 100',{target:'Other'});
  const wrongFamily=fact('D','M0 250 L250 250 L250 100 L500 100',{trunk:'other-family'});
  const wrongStyle=fact('E','M0 300 L300 300 L300 100 L500 100',{style:{...STYLE,width:3}});
  const wrongMarker=fact('F','M0 350 L350 350 L350 100 L500 100',{style:{...STYLE,markerEnd:'url(#different)'}});
  const sections=deriveSharedSections([base,same,wrongTarget,wrongFamily,wrongStyle,wrongMarker]);
  assert.ok(sections.length>0);
  assert.ok(sections.every(section=>section.members.every(id=>['A','B'].includes(id))));
  assert.deepEqual([...new Set(sections.flatMap(section=>section.members))],['A','B']);
});

test('keeps only the continuous suffix after a split and rejoin, excluding an earlier shared prefix',()=>{
  const sections=deriveSharedSections([
    fact('A','M0 0 L100 0 L100 100 L500 100'),
    fact('B','M0 0 L100 0 L100 50 L200 50 L200 100 L500 100'),
  ]);
  assert.deepEqual(sections.map(section=>section.points),[[[200,100],[500,100]]]);
  assert.ok(!sections.some(section=>section.points[0][0]===0&&section.points[1][0]===100));
});

test('intersects suffix proofs with actual L spans so quadratic fillet regions are excluded',()=>{
  const fillet='M0 0 L100 0 Q105 0 105 5 L105 100 L500 100';
  const sections=deriveSharedSections([fact('A',fillet),fact('B',fillet)]);
  assert.deepEqual(sections.map(section=>section.points).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),[
    [[0,0],[100,0]],
    [[105,100],[500,100]],
    [[105,5],[105,100]],
  ]);
  assert.ok(sections.every(section=>!section.points.some(([x,y])=>x>100&&x<105&&y<5)));
});

test('supports translated uniform root transforms and rejects rotation or nonuniform scale',()=>{
  const translated=deriveSharedSections([
    fact('A','M10 20 L110 20 Q120 20 120 30 L120 120 L510 120'),
    fact('B','M0 0 L50 0 Q55 0 55 5 L55 50 L250 50',{rootTransform:{a:2,b:0,c:0,d:2,e:10,f:20},style:{...STYLE,width:1}}),
  ]);
  assert.ok(translated.length>0);
  assert.ok(translated.every(section=>section.points.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y))));
  const rotated=deriveSharedSections([
    fact('R1','M0 0 L100 0 L100 100 L500 100',{rootTransform:{a:0,b:1,c:-1,d:0,e:500,f:0}}),
    fact('R2','M0 50 L150 50 L150 100 L500 100',{rootTransform:{a:0,b:1,c:-1,d:0,e:500,f:0}}),
  ]);
  const nonuniform=deriveSharedSections([
    fact('N1','M0 0 L100 0 L100 100 L500 100',{rootTransform:{a:2,b:0,c:0,d:3,e:0,f:0}}),
    fact('N2','M0 50 L150 50 L150 100 L500 100',{rootTransform:{a:2,b:0,c:0,d:3,e:0,f:0}}),
  ]);
  assert.deepEqual(rotated,[]);
  assert.deepEqual(nonuniform,[]);
});

test('normalizes local stroke appearance and fillet trim into root space before merging',()=>{
  const local=fact('local','M0 0 L50 0 Q55 0 55 5 L55 50 L250 50',{
    rootTransform:{a:2,b:0,c:0,d:2,e:10,f:20},
    style:{...STYLE,width:1,dash:'4 2'},
  });
  const root=fact('root','M10 20 L110 20 Q120 20 120 30 L120 120 L510 120',{
    style:{...STYLE,width:2,dash:'8 4'},
  });
  const normalized=deriveSharedSections([local,root]);
  assert.ok(normalized.length>0);
  assert.ok(normalized.every(section=>section.points.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y))));

  const wrongWidth={...root,id:'root-width-mismatch',style:{...root.style,width:3}};
  assert.deepEqual(deriveSharedSections([local,wrongWidth]),[]);

  const wrongTrim=fact('root-trim-mismatch','M10 20 L115 20 Q120 20 120 25 L120 120 L510 120',{
    style:{...STYLE,width:2,dash:'8 4'},
  });
  assert.deepEqual(deriveSharedSections([local,wrongTrim]),[]);
});

test('fails closed for duplicate ids and oversized fact collections',()=>{
  const a=fact('duplicate','M0 0 L100 0 L100 100 L500 100');
  const b=fact('duplicate','M0 50 L150 50 L150 100 L500 100');
  assert.deepEqual(deriveSharedSections([a,b]),[]);

  const oversized=Array.from({length:301},(_,index)=>fact(`edge-${index}`,'M0 0 L100 0 L100 100 L500 100'));
  assert.deepEqual(deriveSharedSections(oversized),[]);
});

test('rejects non-scaling vector effects while accepting ordinary strokes',()=>{
  const pathA='M0 0 L100 0 L100 100 L500 100';
  const pathB='M0 50 L150 50 L150 100 L500 100';
  const unsupported=deriveSharedSections([
    fact('non-scaling-a',pathA,{style:{...STYLE,vectorEffect:'non-scaling-stroke'}}),
    fact('non-scaling-b',pathB,{style:{...STYLE,'vector-effect':'non-scaling-stroke'}}),
  ]);
  assert.deepEqual(unsupported,[]);

  const ordinary=deriveSharedSections([
    fact('ordinary-a',pathA,{style:{...STYLE,vectorEffect:'none'}}),
    fact('ordinary-b',pathB,{style:{...STYLE,vectorEffect:'none'}}),
  ]);
  assert.ok(ordinary.length>0);
});
