import test from 'node:test';
import assert from 'node:assert/strict';
import {geometryMeasurements,geometryFindings,rectDistance,polylineGap,AMBIGUITY_MARGIN} from '../src/geometry.mjs';
import {checkNodeHeadingClearance,HEADING_CLEARANCE} from '../src/node-heading-clearance.mjs';
import {derivePorts} from '../src/shape-ports.mjs';

// Bounding-box prefilters must be invisible: every result below is compared with the exhaustive per-point computation.
const prng=seed=>()=>((seed=Math.imul(seed^(seed>>>15),2246822507)+0x9e3779b9|0)>>>0)/4294967296;
const round=v=>Math.round(v*10)/10;
const strictlyInside=([x,y],r)=>x>r.x&&x<r.x+r.w&&y>r.y&&y<r.y+r.h;

function scene(rand){
  const int=(n)=>Math.floor(rand()*n),box=()=>({x:int(40)*10,y:int(30)*10,w:20+int(8)*10,h:20+int(6)*10});
  const nodes=Array.from({length:3+int(6)},(_,i)=>({id:`n${i}`,box:box()}));
  const groups=Array.from({length:int(3)},(_,i)=>({id:`g${i}`,box:{...box(),w:80+int(10)*20,h:80+int(6)*20}}));
  const edges=[],labels=[],modelEdges=[];
  for(let i=0;i<nodes.length;i++)for(let j=0;j<nodes.length;j++){
    if(i===j||rand()>0.35)continue;
    const points=[];let x=int(40)*10,y=int(30)*10;
    for(let k=0,n=2+int(30);k<n;k++){points.push([x,y]);if(rand()<0.5)x+=int(5)*5-10;else y+=int(5)*5-10}
    const id=`n${i}->n${j}`;
    edges.push({id,source:`n${i}`,target:`n${j}`,points:rand()<0.05?[]:points});
    modelEdges.push({source:`n${i}`,target:`n${j}`,label:'x'});
    if(rand()<0.8)labels.push({source:`n${i}`,target:`n${j}`,box:{x:int(40)*10+int(2)*5,y:int(30)*10,w:10+int(5)*10,h:10+int(3)*10}});
  }
  return {g:{nodes,groups,edges,labels,untaggedLabels:[]},model:{edges:modelEdges}};
}

test('geometryMeasurements and label-ambiguous findings equal the exhaustive computation',()=>{
  const rand=prng(20261003);
  let ambiguous=0,nearest=0;
  for(let n=0;n<300;n++){
    const {g,model}=scene(rand);
    const m=geometryMeasurements(g,model);
    // Reference: the original per-point loops.
    const byId=new Map(g.edges.map(e=>[e.id,e]));
    const containsBox=(o,i)=>i.x>=o.x-1&&i.y>=o.y-1&&i.x+i.w<=o.x+o.w+1&&i.y+i.h<=o.y+o.h+1;
    const refClear=g.edges.map(e=>{
      const ends=[e.source,e.target],endBoxes=g.nodes.filter(x=>ends.includes(x.id)).map(x=>x.box);
      const borders=[...g.nodes.filter(x=>!ends.includes(x.id)).map(x=>({id:x.id,kind:'node',box:x.box})),...g.groups.filter(gr=>!endBoxes.some(b=>containsBox(gr.box,b))).map(gr=>({id:gr.id,kind:'group',box:gr.box}))];
      let best=null;
      for(const b of borders){
        if(e.points.some(p=>strictlyInside(p,b.box)))continue;
        let d=Infinity;for(const p of e.points)d=Math.min(d,rectDistance(p,b.box));
        if(d<Infinity&&(!best||d<best.dist))best={id:b.id,kind:b.kind,dist:round(d)};
      }
      return {edge:e.id,nearest:best};
    });
    assert.deepEqual(m.clearances,refClear);
    nearest+=refClear.filter(c=>c.nearest).length;
    const refAmbiguous=[];
    for(const l of m.labels){
      if(l.gap===null||!Number.isFinite(l.gap))continue;
      let other=null;
      for(const e of g.edges){if(e.id===l.edge||!e.points?.length)continue;const d=polylineGap(l.box,e.points);if(d<l.gap-AMBIGUITY_MARGIN&&(!other||d<other.gap))other={id:e.id,gap:round(d)}}
      if(other&&byId.has(l.edge))refAmbiguous.push({elements:[l.edge,other.id].sort(),measured:`the label of ${l.edge} is ${l.gap} units from its own route but ${other.gap} units from the route of ${other.id}`});
    }
    const found=geometryFindings(g,model).filter(f=>f.rule==='label-ambiguous').map(f=>({elements:f.elements,measured:f.evidence.measured}));
    assert.deepEqual(found,refAmbiguous);
    ambiguous+=refAmbiguous.length;
  }
  assert.ok(ambiguous>10&&nearest>100,`scenes must exercise both outcomes (ambiguous ${ambiguous}, nearest ${nearest})`);
});

test('nodeHeadingClearance equals the exhaustive per-sample gap',()=>{
  const rand=prng(77),int=n=>Math.floor(rand()*n);
  let violations=0;
  for(let n=0;n<200;n++){
    const nodes=Array.from({length:4},(_,i)=>{
      const cx=int(60)*10,cy=int(40)*10,rx=15+int(4)*5,ry=10+int(3)*5;
      const samples=Array.from({length:120},(_,k)=>[cx+rx*Math.cos(k/120*2*Math.PI),cy+ry*Math.sin(k/120*2*Math.PI)]);
      return i%2?{id:`s${i}`,kind:'shape',samples}:{id:`r${i}`,kind:'rect',outline:{x:cx-rx,y:cy-ry,w:2*rx,h:2*ry}};
    });
    const groups=Array.from({length:3},(_,i)=>({id:`g${i}`,isNode:false,outline:'rect',box:{x:int(30)*10,y:int(20)*10,w:200,h:150},headings:[{x:int(60)*10+0.5,y:int(40)*10,w:30+int(5)*10,h:14}]}));
    const out=checkNodeHeadingClearance({nodes,groups}).evidence.violations.filter(v=>v.kind==='heading');
    const ref=[];
    const gap=(node,box)=>{
      if(node.kind==='rect'){const o=node.outline;return Math.hypot(Math.max(o.x-(box.x+box.w),0,box.x-(o.x+o.w)),Math.max(o.y-(box.y+box.h),0,box.y-(o.y+o.h)))}
      return Math.min(...node.samples.map(p=>Math.hypot(Math.max(box.x-p[0],0,p[0]-(box.x+box.w)),Math.max(box.y-p[1],0,p[1]-(box.y+box.h)))));
    };
    for(const node of nodes)for(const g of groups)for(const h of g.headings){const d=gap(node,h);if(d<HEADING_CLEARANCE)ref.push({kind:'heading',nodeId:node.id,groupId:g.id,gap:Math.round(d*100)/100,required:HEADING_CLEARANCE,heading:{x:Math.round(h.x*100)/100,y:Math.round(h.y*100)/100,w:h.w,h:h.h}})}
    assert.deepEqual(out,ref);
    violations+=ref.length;
  }
  assert.ok(violations>20,`scenes must produce violations (${violations})`);
});

test('derivePorts accepts a convex outline and rejects a dented one (hull early exit keeps the verdict)',()=>{
  const ring=(f)=>Array.from({length:200},(_,k)=>{const a=k/200*2*Math.PI,r=f(a);return [100+60*r*Math.cos(a),100+30*r*Math.sin(a)]});
  assert.ok(derivePorts(ring(()=>1)).faces);
  assert.match(derivePorts(ring(a=>1-0.45*Math.exp(-((a-1)**2)/0.02))).error,/non-convex/);
});
