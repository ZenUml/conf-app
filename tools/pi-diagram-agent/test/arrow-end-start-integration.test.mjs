import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAgentSvg} from '../src/agent-audit.mjs';
import {auditToFindings} from '../src/findings.mjs';
import {whyNotWaivable} from '../src/escalation.mjs';

// These fixtures are deliberately small and synthetic. Browser-backed checks are
// skipped without the explicitly supplied Playwright runtime.
const browserEnabled=!!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
const arrowSource=`flowchart LR
  A[Start] --> B[Center]
  B --> C[Finish]
`;
const sharedSource=`flowchart LR
  A[Start] --> T[Target]
  B[Other] --> T
`;
const sharedThirdSource=`flowchart LR
  A[Start] --> T[Target]
  B[Other] --> T
  T --> C[Third]
`;

// Keep the marker in the audit's supported geometry subset: no viewBox or
// transform, so the test exercises actual endpoint/head and shaft overlap.
const marker=`<defs><marker id="arrow" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="10" refX="10" refY="5"><path d="M0,0 L10,5 L0,10 Z" fill="black"/></marker></defs>`;
const node=(id,x,y,w,h,text)=>`<g data-node="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white" stroke="black"/><text data-role="label" x="${x+20}" y="${y+35}" font-size="14">${text}</text></g>`;
const edge=(source,target,d,attrs='')=>`<path data-edge="${source}-${target}" data-source="${source}" data-target="${target}" d="${d}" fill="none" stroke="black" stroke-width="1" marker-end="url(#arrow)"${attrs?` ${attrs}`:''}/>`;
const svg=(body)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 320">${marker}${body}</svg>`;

const arrowNodes=node('A',40,100,120,60,'Start')+node('B',300,100,120,60,'Center')+node('C',560,180,120,60,'Finish');
const samePort=svg(arrowNodes+
  edge('A','B','M160 130 L300 130')+
  // B->C leaves B through exactly the same left port where A->B ends.
  edge('B','C','M300 130 L250 130 L250 210 L560 210','data-route-points="300,160 300,210 560,210" data-waypoints="300,160 300,210 560,210"'));
const distinctPorts=svg(arrowNodes+
  edge('A','B','M160 130 L300 130')+
  // B->C leaves through B's bottom port, while A->B still ends at B's left port.
  edge('B','C','M360 160 L360 210 L560 210'));

const sharedNodes=node('A',20,10,100,40,'Start')+node('B',20,80,100,40,'Other')+node('T',400,150,100,60,'Target');
const sharedA='M120 30 L265 30 L265 175 Q265 180 270 180 L400 180';
const sharedB='M120 100 L225 100 L225 175 Q225 180 230 180 L400 180';
const sharedTrunk=svg(sharedNodes+
  edge('A','T',sharedA,'data-shared-trunk="trunk-1"')+
  edge('B','T',sharedB,'data-shared-trunk="trunk-1"'));
const sharedWithOutgoing=svg(sharedNodes+node('C',150,220,100,60,'Third')+
  edge('A','T',sharedA,'data-shared-trunk="trunk-1"')+
  edge('B','T',sharedB,'data-shared-trunk="trunk-1"')+
  // The third connector starts at T's same left port. Trunk metadata cannot
  // turn an incoming shared head into a valid outgoing start.
  edge('T','C','M400 180 L340 180 L340 250 L250 250','data-shared-trunk="trunk-1"'));

const arrowCheck=result=>{
  assert.ok(result.checks?.arrowEndStartClearance,'arrowEndStartClearance check missing');
  return result.checks.arrowEndStartClearance;
};

test('actual browser geometry rejects an end/start collision even when forged waypoint metadata claims distinct ports',{skip:!browserEnabled},async()=>{
  const result=await auditAgentSvg(arrowSource,samePort);
  const check=arrowCheck(result);
  assert.equal(check.status,'FAIL');
  assert.ok(Array.isArray(check.evidence?.violations)&&check.evidence.violations.length>0);
  assert.match(String(check.evidence?.method??''),/actual|browser|Chromium|getPointAtLength/i);
  assert.ok(check.evidence.violations.some(v=>v.edgeA==='A-B'&&v.edgeB==='B-C'||v.edgeA==='B-C'&&v.edgeB==='A-B'),'the incoming and outgoing routes should be named in the evidence');
});

test('actual browser geometry accepts distinct ports on the same node',{skip:!browserEnabled},async()=>{
  const result=await auditAgentSvg(arrowSource,distinctPorts);
  assert.equal(arrowCheck(result).status,'PASS');
});

test('declared shared terminal head is allowed, but a third outgoing start at that port still fails',{skip:!browserEnabled},async()=>{
  const shared=await auditAgentSvg(sharedSource,sharedTrunk);
  assert.equal(shared.checks.routePairClearance.status,'PASS');
  assert.equal(arrowCheck(shared).status,'PASS');
  const third=await auditAgentSvg(sharedThirdSource,sharedWithOutgoing);
  assert.equal(arrowCheck(third).status,'FAIL');
  assert.ok(third.checks.arrowEndStartClearance.evidence.violations.length>0);
});

test('arrow-end/start failures remain blocking and cannot be waived in relaxed mode',()=>{
  const audit={status:'FAIL',checks:{arrowEndStartClearance:{status:'FAIL',evidence:{
    method:'Chromium actual SVG path endpoints and first shafts; optional metadata ignored',
    violations:[{edgeA:'A->B',edgeB:'B->C',nodeId:'B',point:{x:300,y:130},kind:'end-start port collision'}],
  }}}};
  const findings=auditToFindings(audit,{relaxed:true});
  assert.equal(findings.length,1);
  assert.equal(findings[0].rule,'arrowEndStartClearance');
  assert.equal(findings[0].severity,'blocking');
  assert.match(String(whyNotWaivable(findings[0],audit)),/not waivable/i);
});
