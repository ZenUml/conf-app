import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAgentSvg} from '../src/agent-audit.mjs';
import {syntheticDiagram} from './stubs/synthetic-svg.mjs';

const enabled=!!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
const strip=result=>{const {timing,...rest}=result;return JSON.stringify(rest)};

test('a 40-node, 35-label diagram with rounded outlines audits within the time bound',{skip:!enabled,timeout:60000},async()=>{
  const {source,svg}=syntheticDiagram({cols:8,rows:5,kinds:['round']});
  const start=performance.now();
  const result=await auditAgentSvg(source,svg,{timing:true});
  const elapsed=performance.now()-start;
  assert.equal(result.checks.labelClearance.evidence.checkedLabels,35);
  assert.ok(elapsed<5000,`audit took ${Math.round(elapsed)} ms; per-check timing ${JSON.stringify(result.timing)}`);
  assert.equal(typeof result.timing['browser.labelClearance'],'number');
});

// Label offsets (relative to the right edge of the source node; the next node starts 40 units later and the label is 26 wide)
// straddle every boundary: clear, a sub-unit gap, touching, crossing either outline, and fully inside a node.
const offsets=[-30,-6,-1.2,-0.7,-0.2,0.2,0.9,1.4,6,13.2,13.9,14.25,14.8,16,30];
const variants={
  rounded:{kinds:['round']},
  mixed:{kinds:['round','ellipse','diamond','path','rect']},
  thick:{kinds:['round','path'],sw:6},
  hairline:{kinds:['round','ellipse'],sw:0},
  rotated:{kinds:['round','diamond'],rotate:true},
  vertical:{kinds:['round','ellipse','path'],labelY:[-30,-20,-8,0,8,20,30]},
};

for(const [name,options] of Object.entries(variants)){
  test(`prefilter leaves the audit JSON byte-identical: ${name}`,{skip:!enabled,timeout:120000},async()=>{
    const {source,svg}=syntheticDiagram({cols:6,rows:5,labelDx:offsets,...options});
    const filtered=await auditAgentSvg(source,svg);
    const exhaustive=await auditAgentSvg(source,svg,{prefilter:false});
    assert.equal(strip(filtered),strip(exhaustive));
    const {violations}=filtered.checks.labelClearance.evidence;
    assert.ok(Array.isArray(violations),'labelClearance reports violations');
    if(name!=='hairline')assert.ok(violations.length>0,'the offsets must produce real label/outline hits');
  });
}
