import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAgentSvg} from '../src/agent-audit.mjs';
import {auditToFindings} from '../src/findings.mjs';
import {auditGateReasons} from '../src/gate.mjs';
import {validateWaivers,whyNotWaivable} from '../src/escalation.mjs';
import {renderSpec} from '../src/spec-render.mjs';
import {denseRelationThreshold,denseInfo,DENSE_RELATIONS_DEFAULT} from '../src/dense.mjs';

const enabled=!!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
const withEnv=async(value,fn)=>{
  const before=process.env.PI_DIAGRAM_DENSE_RELATIONS;
  if(value===undefined)delete process.env.PI_DIAGRAM_DENSE_RELATIONS;else process.env.PI_DIAGRAM_DENSE_RELATIONS=value;
  try{return await fn()}finally{if(before===undefined)delete process.env.PI_DIAGRAM_DENSE_RELATIONS;else process.env.PI_DIAGRAM_DENSE_RELATIONS=before}
};

// Synthetic fixture: n-1 vertical relations Si->Ti plus one horizontal relation U->V that crosses every vertical one (n relations, n-1 crossings).
const defs='<defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="5"><path d="M0,0 L10,5 L0,10 Z" fill="black"/></marker></defs>';
const node=(id,x,y,w,h)=>`<g data-node="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="black"/><text x="${x+w/2-4}" y="${y+h/2+4}">N</text></g>`;
const edge=(s,t,d)=>`<path data-source="${s}" data-target="${t}" d="${d}" stroke="black" fill="none" marker-end="url(#arrow)"/>`;
const fixture=n=>{
  const cols=n-1,last=140+(cols-1)*60+50+30;
  const src=['flowchart LR'],parts=[];
  for(let i=0;i<cols;i++){
    const x=140+60*i;src.push(`  S${i}[N] --> T${i}[N]`);
    parts.push(node(`S${i}`,x,50,50,40),node(`T${i}`,x,300,50,40),edge(`S${i}`,`T${i}`,`M${x+25} 90 L${x+25} 300`));
  }
  src.push('  U[N] --> V[N]');
  parts.push(node('U',10,170,60,40),node('V',last,170,60,40),edge('U','V',`M70 190 L${last} 190`));
  return {source:src.join('\n')+'\n',svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${last+120} 400">${defs}${parts.join('')}</svg>`,crossings:cols};
};
const specFixture=n=>{
  const cols=n-1,last=140+(cols-1)*70+60+30;
  const nodes=[],edges=[];
  for(let i=0;i<cols;i++){
    const x=140+70*i;
    nodes.push({id:`S${i}`,shape:'rect',rect:[x,50,60,40],text:'N',role:'p'},{id:`T${i}`,shape:'rect',rect:[x,300,60,40],text:'N',role:'p'});
    edges.push({id:`e${i}`,source:`S${i}`,target:`T${i}`,points:[[x+30,90],[x+30,300]]});
  }
  nodes.push({id:'U',shape:'rect',rect:[10,170,60,40],text:'N',role:'p'},{id:'V',shape:'rect',rect:[last,170,60,40],text:'N',role:'p'});
  edges.push({id:'eh',source:'U',target:'V',points:[[70,190],[last,190]]});
  return {canvas:{w:last+120,h:400},palette:{p:{fill:'#e8f1fb',stroke:'#2563a8',text:'#12355b',meaning:'Step'}},nodes,edges};
};

test('dense threshold: 20 by default, PI_DIAGRAM_DENSE_RELATIONS overrides, junk falls back to the default',()=>{
  assert.equal(DENSE_RELATIONS_DEFAULT,20);
  assert.equal(denseRelationThreshold({}),20);
  assert.equal(denseRelationThreshold({PI_DIAGRAM_DENSE_RELATIONS:'12'}),12);
  for(const junk of ['','0','-3','abc','1.5'])assert.equal(denseRelationThreshold({PI_DIAGRAM_DENSE_RELATIONS:junk}),20,junk);
  assert.deepEqual(denseInfo(27,{}),{relations:27,threshold:20,reason:'dense: 27 relations >= 20'});
  assert.equal(denseInfo(19,{}),null);
  assert.equal(denseInfo(20,{}).reason,'dense: 20 relations >= 20');
  assert.equal(denseInfo(10,{PI_DIAGRAM_DENSE_RELATIONS:'10'}).threshold,10);
});

test('auditor: a 20-relation source with crossings gives minor findings, no blocking routeCrossings, and the gate is not blocked by it',{skip:!enabled},async()=>{
  await withEnv(undefined,async()=>{
    const {source,svg,crossings}=fixture(20);
    const r=await auditAgentSvg(source,svg);
    const c=r.checks.routeCrossings;
    assert.equal(c.status,'PASS',JSON.stringify(c.evidence).slice(0,400));
    assert.equal(c.evidence.relationCount,20);
    assert.equal(c.evidence.denseThreshold,20);
    assert.equal(c.evidence.dense.reason,'dense: 20 relations >= 20');
    assert.equal(c.evidence.crossings,crossings);
    assert.equal(c.evidence.minorFindings.length,crossings);
    assert.deepEqual(c.evidence.violations,[]);
    const findings=auditToFindings(r).filter(f=>f.rule==='routeCrossings');
    assert.ok(findings.length>0);
    assert.ok(findings.every(f=>f.severity==='minor'));
    assert.match(findings[0].evidence.measured,/dense: 20 relations >= 20/);
    assert.match(findings[0].evidence.threshold,/non-blocking/);
    const gate=auditGateReasons({audit:r,forbidden:[]});
    assert.ok(!gate.some(x=>x.code==='AUDIT_FAIL'&&/routeCrossings/.test(x.detail)),JSON.stringify(gate));
  });
});

test('auditor: a 19-relation source with the same crossing stays blocking, with the count reported',{skip:!enabled},async()=>{
  await withEnv(undefined,async()=>{
    const {source,svg,crossings}=fixture(19);
    const r=await auditAgentSvg(source,svg);
    const c=r.checks.routeCrossings;
    assert.equal(c.status,'FAIL');
    assert.equal(c.evidence.relationCount,19);
    assert.equal(c.evidence.denseThreshold,20);
    assert.equal(c.evidence.dense??null,null);
    assert.equal(c.evidence.violations.length,crossings);
    const findings=auditToFindings(r).filter(f=>f.rule==='routeCrossings');
    assert.equal(findings.length,1);
    assert.equal(findings[0].severity,'blocking');
    assert.match(auditGateReasons({audit:r,forbidden:[]}).find(x=>x.code==='AUDIT_FAIL').detail,/routeCrossings/);
  });
});

test('auditor: PI_DIAGRAM_DENSE_RELATIONS moves the threshold both ways',{skip:!enabled},async()=>{
  const nineteen=fixture(19),twenty=fixture(20);
  await withEnv('19',async()=>{
    const r=await auditAgentSvg(nineteen.source,nineteen.svg);
    assert.equal(r.checks.routeCrossings.status,'PASS');
    assert.equal(r.checks.routeCrossings.evidence.dense.reason,'dense: 19 relations >= 19');
  });
  await withEnv('25',async()=>{
    const r=await auditAgentSvg(twenty.source,twenty.svg);
    assert.equal(r.checks.routeCrossings.status,'FAIL');
    assert.equal(r.checks.routeCrossings.evidence.denseThreshold,25);
  });
});

test('escalation: a dense (minor) crossing is never a blocking finding, so it never needs or receives a waiver; below the threshold the old waiver rules stand',{skip:!enabled},async()=>{
  await withEnv(undefined,async()=>{
    const dense=fixture(20),sparse=fixture(19);
    const dAudit=await auditAgentSvg(dense.source,dense.svg),sAudit=await auditAgentSvg(sparse.source,sparse.svg);
    const blockingD=auditToFindings(dAudit).filter(f=>f.severity==='blocking');
    assert.ok(!blockingD.some(f=>f.rule==='routeCrossings'));
    assert.deepEqual(validateWaivers(blockingD.filter(f=>f.rule==='routeCrossings'),[],dAudit),{accepted:[],rejected:[]});
    const crossing=auditToFindings(sAudit).find(f=>f.rule==='routeCrossings'&&f.severity==='blocking');
    assert.ok(crossing);
    // the sparse crossings still carry a hint or a move, or are waivable only through the unchanged code rule
    assert.equal(typeof (whyNotWaivable(crossing,sAudit)??'waivable'),'string');
  });
});

test('spec renderer: crossings are minor at 20 source relations, blocking at 19, and the override works',async()=>{
  await withEnv(undefined,async()=>{
    const dense=renderSpec(specFixture(20)),sparse=renderSpec(specFixture(19));
    const d=dense.findings.filter(f=>f.rule==='crossing'),s=sparse.findings.filter(f=>f.rule==='crossing');
    assert.equal(d.length,19);assert.ok(d.every(f=>f.severity==='minor'));
    assert.match(d[0].measured,/dense: 20 relations >= 20/);
    assert.equal(s.length,18);assert.ok(s.every(f=>f.severity==='blocking'));
    assert.doesNotMatch(s[0].measured,/dense/);
  });
  await withEnv('19',async()=>{assert.ok(renderSpec(specFixture(19)).findings.filter(f=>f.rule==='crossing').every(f=>f.severity==='minor'))});
  await withEnv('25',async()=>{assert.ok(renderSpec(specFixture(20)).findings.filter(f=>f.rule==='crossing').every(f=>f.severity==='blocking'))});
});

test('spec renderer: the source relation count comes from the parsed model when supplied',async()=>{
  await withEnv(undefined,async()=>{
    const spec=specFixture(19);
    const model={nodes:spec.nodes.map(n=>({id:n.id})),edges:[...spec.edges.map(e=>({source:e.source,target:e.target})),{source:'U',target:'V'}],groups:[]};
    const r=renderSpec(spec,{model});
    const crossing=r.findings.filter(f=>f.rule==='crossing');
    assert.ok(crossing.length&&crossing.every(f=>f.severity==='minor'),JSON.stringify(crossing[0]));
    assert.match(crossing[0].measured,/dense: 20 relations >= 20/);
  });
});
