import test from 'node:test';
import assert from 'node:assert/strict';
import {auditAgentSvg} from '../src/agent-audit.mjs';
import {auditToFindings,formatForAuthor,selectForAuthor,createLedger} from '../src/findings.mjs';

const enabled=!!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
const defs='<defs><marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="5"><path d="M0,0 L10,5 L0,10 Z" fill="black"/></marker></defs>';
const node=(id,x,y,w,h)=>`<g data-node="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="black"/><text x="${x+14}" y="${y+h/2+4}">N</text></g>`;
const edge=(s,t,d)=>`<path data-source="${s}" data-target="${t}" d="${d}" stroke="black" fill="none" marker-end="url(#arrow)"/>`;
const doc=(...parts)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900">${defs}${parts.join('')}</svg>`;
const src='flowchart LR\n A[N] --> B[N]\n C[N] --> D[N]\n';
const pathOf=pts=>pts.map((p,i)=>`${i?'L':'M'}${p[0]} ${p[1]}`).join(' ');

// A->B runs straight across the page; C above and D below are joined by a vertical edge that crosses it. The plane around is open.
const open=()=>[node('A',60,300,100,60),node('B',450,300,100,60),node('C',250,100,100,60),node('D',250,500,100,60)];
const openEdges=()=>[edge('A','B','M160 330 L450 330'),edge('C','D','M300 160 L300 500')];

test('routeCrossings carries a repairHint: a crossing-free route for one of the two edges with every other route fixed',{skip:!enabled},async()=>{
  const r=await auditAgentSvg(src,doc(...open(),...openEdges()));
  const c=r.checks.routeCrossings;
  assert.equal(c.status,'FAIL');
  const [v]=c.evidence.violations;
  assert.ok(v.repairHint,`expected a repairHint, got ${JSON.stringify(v)}`);
  assert.ok([v.edgeA,v.edgeB].includes(v.repairHint.edge));
  assert.equal(v.repairHint.bends,v.repairHint.points.length-2);
  assert.ok(v.repairHint.length>0);
  // re-validate: draw the hint with the other edge unchanged; the auditor must now accept the geometry
  const other=v.repairHint.edge==='A->B'?edge('C','D','M300 160 L300 500'):edge('A','B','M160 330 L450 330');
  const [s,t]=v.repairHint.edge.split('->');
  const fixed=await auditAgentSvg(src,doc(...open(),edge(s,t,pathOf(v.repairHint.points)),other));
  for(const k of ['routeCrossings','routeNodeIntrusion','routePairClearance','arrowShaft','routeUnrelatedContainerTransit','routeHeadingClearance'])assert.equal(fixed.checks[k].status,'PASS',`${k}: ${JSON.stringify(fixed.checks[k].evidence).slice(0,300)}`);
});

test('routeCrossings repairHint is null with a reason when no route exists for either edge with the others fixed',{skip:!enabled},async()=>{
  // C and D are wide bars forming a corridor; walls close both ends. Any A->B route and any C->D route must use the corridor and cross.
  const walls=[node('WL',0,200,62,260),node('WR',558,200,62,260)];
  const nodes=[node('C',62,200,496,80),node('D',62,380,496,80),node('A',62,300,60,60),node('B',498,300,60,60),...walls];
  // The canvas ends at the walls (620x460), so there is no way round them either.
  const tight=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 460">${defs}${nodes.join('')}${edge('A','B','M122 330 L498 330')}${edge('C','D','M300 280 L300 380')}</svg>`;
  const r=await auditAgentSvg(src,tight);
  const c=r.checks.routeCrossings;
  assert.equal(c.status,'FAIL');
  const [v]=c.evidence.violations;
  assert.equal(v.repairHint,null);
  assert.match(v.reason,/node move/);
});

// ---- findings text (no browser) ----
const audit=violation=>({checks:{routeCrossings:{status:'FAIL',evidence:{method:'m',violations:[violation],checkedEdges:2}}}});
test('auditToFindings puts the repair hint into the author-facing text and keeps it structured',()=>{
  const hint={edge:'REC->CHG',points:[[100,200],[100,40],[400,40],[400,120]],bends:2,length:480};
  const [f]=auditToFindings(audit({edgeA:'APP->EVT',edgeB:'REC->CHG',x:300,y:552,repairHint:hint}));
  assert.match(f.suggestion,/reroute REC->CHG via \(100,40\)/);
  assert.match(f.suggestion,/2 bends/);
  assert.deepEqual(f.repairHints,[hint]);
  const sent=formatForAuthor(selectForAuthor((()=>{const l=createLedger();l.update(1,[f]);return l})())).findings[0];
  assert.deepEqual(sent.repairHints,[hint]);
});
test('auditToFindings says a node move is likely needed when the hint is null',()=>{
  const [f]=auditToFindings(audit({edgeA:'A->B',edgeB:'C->D',x:1,y:2,repairHint:null,reason:'no crossing-free route for either edge with the other routes fixed; a node move is likely needed'}));
  assert.match(f.suggestion,/node move is likely needed/);
});

test('a repairHint never leaves the canvas (8-unit margin inside the root viewBox)',{skip:!enabled},async()=>{
  // Bars close the gaps above and below, so the only free routes run outside the canvas; none may be proposed. The shortest escapes for C->D run outside the 600x640 canvas (left of A at x<4, right of B at x>600), so the hint must take another way.
  const nodes=[node('A',4,300,100,60),node('B',500,300,100,60),node('C',250,100,100,60),node('D',250,500,100,60),node('TOP',0,10,600,88),node('BOT',0,562,600,60)];
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 640">${defs}${nodes.join('')}${edge('A','B','M104 330 L500 330')}${edge('C','D','M300 160 L300 500')}</svg>`;
  const [v]=(await auditAgentSvg(src,svg)).checks.routeCrossings.evidence.violations;
  for(const [x,y] of v.repairHint?.points??[]){assert.ok(x>=8&&x<=592&&y>=8&&y<=632,`point ${x},${y} outside the canvas margin`)}
});

// ---- node-move hints: a crossing that is topological (no reroute of either edge helps) ----
// Bars close the plane above and below the A->B line, so C->D must cross it while C is above and D below. Moving C beside D (C->D straight) removes the crossing.
const moveNodes=(pos={})=>[node('A',4,300,100,60),node('B',500,300,100,60),node('C',250,100,100,60),node('D',420,500,100,60),node('TOP',0,10,600,88),node('BOT',0,562,600,60)].map(n=>{const id=/data-node="(\w+)"/.exec(n)[1];return pos[id]?node(id,...pos[id]):n});
const moveSvg=(pos,route)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 640">${defs}${moveNodes(pos).join('')}${edge('A','B','M104 330 L500 330')}${edge('C','D',route)}</svg>`;
test('routeCrossings carries a moveHint when repairHint is null: one node translation plus re-routes of its edges, fewer crossings',{skip:!enabled},async()=>{
  const r=await auditAgentSvg(src,moveSvg({},'M300 160 L300 530 L420 530'));
  const c=r.checks.routeCrossings;
  assert.equal(c.status,'FAIL');
  const [v]=c.evidence.violations;
  assert.equal(v.repairHint,null);
  assert.ok(v.moveHint,`expected a moveHint, got ${JSON.stringify(v)}`);
  const m=v.moveHint;
  // either end of C->D can move to the other side of the A->B line (C beside D, or D beside C)
  assert.ok(['C','D'].includes(m.node));
  assert.equal(Math.abs(m.dy),400);   // dx may slide along the aligned axis to shorten the straight reroute
  assert.equal(m.crossingsBefore,1);
  assert.equal(m.crossingsAfter,0);
  assert.deepEqual(m.reroutes.map(x=>x.edge),['C->D']);
  // re-validate: draw the move + reroute; the auditor must accept it
  const moved=m.node==='C'?{C:[250+m.dx,100+m.dy,100,60]}:{D:[420+m.dx,500+m.dy,100,60]};
  const fixed=await auditAgentSvg(src,moveSvg(moved,pathOf(m.reroutes[0].points)));
  for(const k of ['routeCrossings','routeNodeIntrusion','routePairClearance','arrowShaft'])assert.equal(fixed.checks[k].status,'PASS',`${k}: ${JSON.stringify(fixed.checks[k].evidence).slice(0,300)}`);
});
test('moveHint is null with a reason when no single-node move helps',{skip:!enabled},async()=>{
  const walls=[node('WL',0,200,62,260),node('WR',558,200,62,260)];
  const nodes=[node('C',62,200,496,80),node('D',62,380,496,80),node('A',62,300,60,60),node('B',498,300,60,60),...walls];
  const tight=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 460">${defs}${nodes.join('')}${edge('A','B','M122 330 L498 330')}${edge('C','D','M300 280 L300 380')}</svg>`;
  const [v]=(await auditAgentSvg(src,tight)).checks.routeCrossings.evidence.violations;
  assert.equal(v.repairHint,null);
  assert.equal(v.moveHint,null);
  assert.match(v.moveHintReason,/no single-node move|candidate/);
});
test('auditToFindings puts the move hint into the author-facing text and keeps it structured',()=>{
  const mh={node:'C',dx:0,dy:400,reroutes:[{edge:'C->D',points:[[300,530],[420,530]]}],crossingsBefore:1,crossingsAfter:0};
  const [f]=auditToFindings(audit({edgeA:'A->B',edgeB:'C->D',x:300,y:330,repairHint:null,reason:'a node move is likely needed',moveHint:mh}));
  assert.match(f.suggestion,/move C by \(0,400\)/);
  assert.match(f.suggestion,/crossings 1 -> 0/);
  assert.deepEqual(f.moveHints,[mh]);
  const sent=formatForAuthor(selectForAuthor((()=>{const l=createLedger();l.update(1,[f]);return l})())).findings[0];
  assert.deepEqual(sent.moveHints,[mh]);
});
