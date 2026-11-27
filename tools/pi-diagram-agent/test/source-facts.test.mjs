import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseMermaid} from '../src/parser.mjs';
import {formatSourceFacts} from '../src/source-facts.mjs';
import {prepareAgentTask,buildSourceFacts,composePrompt,createAgentVisualInspector} from '../src/agent-led.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const f3=fs.readFileSync(path.join(here,'..','bench','fixtures','f3-groups.mmd'),'utf8');
const browser=!!process.env.PI_DIAGRAM_MERMAID_BUNDLE&&!!process.env.PI_DIAGRAM_PLAYWRIGHT_MODULE;
const layout={canvas:{w:569,h:353},
  nodes:{A:{x:12,y:30,w:140,h:54},B:{x:200,y:30,w:140,h:54},C:{x:12,y:200,w:140,h:54},D:{x:200,y:200,w:140,h:54},E:{x:400,y:120,w:140,h:54}},
  groups:{INTAKE:{x:0,y:0,w:360,h:110},REVIEW:{x:0,y:170,w:360,h:110}},
  renderedGroups:{A:['INTAKE'],B:['INTAKE'],C:['REVIEW'],D:['REVIEW'],E:[]}};

test('source facts list parser nodes, edges, groups, rendered membership and original positions, labelled reference only',()=>{
  const text=formatSourceFacts(parseMermaid(f3),layout);
  assert.match(text,/^<source-facts>/);assert.match(text,/<\/source-facts>$/);
  assert.match(text,/reference only/i);assert.match(text,/do not copy this layout/i);
  assert.match(text,/canvas 569x353/);
  assert.match(text,/A \| "Collect request" \| rect \| neutral \| INTAKE \| INTAKE \| 12,30,140,54/);
  assert.match(text,/E \| "Notify requester" \| rect \| neutral \| - \| - \| 400,120,140,54/);
  assert.match(text,/INTAKE "Intake"/);assert.match(text,/REVIEW "Review"/);
  assert.match(text,/e1 \| A -> B \| - \| solid/);assert.match(text,/e4 \| D -> E \| - \| solid/);
  assert.doesNotMatch(text,/conflict/i);
});
test('a declared-versus-rendered group conflict is flagged',()=>{
  const l=structuredClone(layout);l.renderedGroups.B=['REVIEW'];
  const text=formatSourceFacts(parseMermaid(f3),l);
  assert.match(text,/B \| "Check request" \| rect \| neutral \| INTAKE \| REVIEW \|/);
  assert.match(text,/conflict.*B.*declared INTAKE.*rendered REVIEW/i);
});
test('labels, dashed edges and palette roles appear',()=>{
  const src='flowchart LR\n  A[One] -- "go" --> B[(Two)]\n  B -.-> C[Three]\n  classDef warm fill:#fee,stroke:#a00,color:#300\n  class A warm\n';
  const m=parseMermaid(src);
  const text=formatSourceFacts(m,{canvas:{w:10,h:10},nodes:{},groups:{},renderedGroups:{}});
  assert.match(text,/e1 \| A -> B \| "go" \| solid/);assert.match(text,/e2 \| B -> C \| - \| dashed/);
  assert.match(text,/A \| "One" \| rect \| warm \|/);assert.match(text,/warm: fill #fee stroke #a00 text #300/);
  assert.match(text,/B \| "Two" \| cylinder/);
});

const withJob=fn=>async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-facts-test-')),input=path.join(root,'f3.mmd');
  fs.writeFileSync(input,f3);const job=prepareAgentTask(input);
  try{await fn(job,root)}finally{fs.rmSync(job.runDir,{recursive:true,force:true});fs.rmSync(root,{recursive:true,force:true})}
};
test('buildSourceFacts renders the original once, binds its hash, and the inspector reuses that render',{skip:!browser},withJob(async job=>{
  const text=await buildSourceFacts(job,{mermaidBundlePath:process.env.PI_DIAGRAM_MERMAID_BUNDLE});
  for(const id of ['A','B','C','D','E'])assert.match(text,new RegExp(`^${id} \\| .* \\| \\d+(\\.\\d+)?,\\d+(\\.\\d+)?,\\d+(\\.\\d+)?,\\d+(\\.\\d+)?$`,'m'),`node ${id} has a position`);
  assert.match(text,/^A \| "Collect request" \| rect \| neutral \| INTAKE \| INTAKE \|/m);
  assert.match(text,/^C \| "Assess request" \| rect \| neutral \| REVIEW \| REVIEW \|/m);
  assert.match(text,/^E \| "Notify requester" \| rect \| neutral \| - \| - \|/m);
  const originals=()=>fs.readdirSync(job.runDir).filter(f=>/^source\.original\..*\.svg$/.test(f));
  assert.equal(originals().length,1);
  await buildSourceFacts(job,{mermaidBundlePath:process.env.PI_DIAGRAM_MERMAID_BUNDLE});
  assert.equal(originals().length,1,'second call reuses the memoised original');
  fs.writeFileSync(job.outputPath,'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="#fff"/><text x="10" y="20">x</text></svg>');
  const inspect=createAgentVisualInspector(job,{mermaidBundlePath:process.env.PI_DIAGRAM_MERMAID_BUNDLE});
  const r=await inspect();
  assert.equal(originals().length,1,'inspection did not re-render the original');
  assert.ok(r.details.original.originalSvgHash);
}));

test('composePrompt: default is the unchanged script-mode message',withJob(async job=>{
  const p=composePrompt(job,{jobId:'J1'});
  assert.ok(p.startsWith(job.prompt));
  assert.match(p,/Visual inspection job ID: J1\. Call diagram_inspect with this ID after each candidate/);
  assert.doesNotMatch(p,/layout\.json|diagram_render_spec|source-facts/);
}));
test('composePrompt: spec mode adds the schema summary and keeps the model in charge of every coordinate',withJob(async job=>{
  const p=composePrompt(job,{jobId:'J1',specMode:true});
  assert.ok(p.startsWith(job.prompt));
  assert.match(p,/layout\.json/);assert.ok(p.includes(path.join(job.runDir,'layout.json')));
  assert.match(p,/diagram_render_spec/);assert.match(p,/J1/);
  assert.match(p,/you (?:still )?decide every coordinate/i);
  assert.match(p,/never moves|does not move|never repairs/i);
  for(const k of ['canvas','palette','groups','nodes','edges','points','legend','tier'])assert.ok(p.includes(k),k);
  // 5000 -> 5250 (2026-10-04): the edges line now says a group id is a valid endpoint and node-to-group relations must be drawn (r111 redrew them to member nodes).
  assert.ok(p.length-job.prompt.length<5250,`spec paragraph is short (${p.length-job.prompt.length} chars)`);
}));
test('composePrompt: source facts block is appended after the source and labelled reference only',withJob(async job=>{
  const p=composePrompt(job,{jobId:'J1',factsText:'<source-facts>\nreference only\n</source-facts>'});
  assert.ok(p.indexOf('</untrusted-mermaid-source>')<p.indexOf('<source-facts>'));
}));

test('nested groups: the membership path is listed and a matching rendered path is not a conflict',()=>{
  const m=parseMermaid('flowchart TB\n  subgraph OUTER\n    subgraph INNER\n      A[Deep]\n    end\n    B[Shallow]\n  end\n  C[Free]');
  const l={canvas:{w:10,h:10},nodes:{},groups:{},renderedGroups:{A:['OUTER','INNER'],B:['OUTER'],C:[]}};
  const text=formatSourceFacts(m,l);
  assert.match(text,/^A \| "Deep" \| rect \| neutral \| OUTER>INNER \| OUTER\+INNER \|/m);
  assert.match(text,/^B \| "Shallow" \| rect \| neutral \| OUTER \| OUTER \|/m);
  assert.match(text,/^C \| "Free" \| rect \| neutral \| - \| - \|/m);
  assert.doesNotMatch(text,/conflict/i);
  const l2=structuredClone(l);l2.renderedGroups.A=['OUTER'];
  assert.match(formatSourceFacts(m,l2),/conflict.*A: declared OUTER>INNER, rendered OUTER/i);
});
test('group-endpoint edges, layout links, markup and a not-checkable note are listed',()=>{
  const m=parseMermaid('flowchart TB\n  subgraph S\n    A["<b>Bold</b>"]\n  end\n  A --> S\n  S --- B\n  A ~~~ B');
  const text=formatSourceFacts(m,{canvas:{w:10,h:10},nodes:{},groups:{},renderedGroups:{A:['S']}});
  assert.match(text,/group edges: .*g1 \| A -> S \(group\)/s);
  assert.match(text,/layout links \(invisible, not relations\): A ~~~ B/);
  assert.doesNotMatch(text,/not checkable by the auditor: .*group-endpoint edge/);
  assert.match(text,/group edges: .*every one must be drawn/s);
  assert.match(text,/^A \| "Bold" \| rect \|.*markup b/m);
});

test('source facts list conflicting node definitions and ignored statements, so nothing is dropped without trace',()=>{
  const m=parseMermaid('flowchart LR\n  A[one] --> B\n  A[two]\n  style B fill:#f00\n');
  const text=formatSourceFacts(m,{canvas:{w:100,h:100},nodes:{},groups:{},renderedGroups:{}});
  assert.match(text,/conflicting definitions[^\n]*A: "one" \(line 2\), "two" \(line 3\)/);
  assert.match(text,/ignored statements[^\n]*style \(line 4\)/);
});
test('reviewer facts carry definition conflicts only when present',async()=>{
  const {buildReviewerFacts}=await import('../src/reviewer.mjs');
  assert.deepEqual(buildReviewerFacts(parseMermaid('flowchart LR\n  A[one] --> B\n  A[two]')).conflicts,[{nodeId:'A',kinds:['text'],lines:[2,3],texts:['one','two'],shapes:['rect','rect']}]);
  assert.equal(buildReviewerFacts(parseMermaid('flowchart LR\n  A --> B')).conflicts,undefined);
});

const V2={maxRounds:4,maxInspectionsPerRound:3,twoPhase:true,maxChecksPerRound:6,maxChecksPerRun:16,runDir:'/run/x'};
test('composePrompt: spec mode required makes layout.json the normal loop and forbids make.py and a hand-written candidate.svg',withJob(async job=>{
  const p=composePrompt(job,{jobId:'J1',specMode:'required',v2:V2});
  assert.match(p,/Normal loop: write \/run\/x\/layout\.json/);
  assert.match(p,/positions and routes chosen by you/);
  assert.match(p,/diagram_build_check[^.]*renders it with our renderer/);
  assert.match(p,/do not write make\.py/i);assert.match(p,/do not (?:write|hand-write)[^.]*candidate\.svg/i);
  assert.match(p,/overrides[^.]*script/i);
  assert.doesNotMatch(p,/edit your generator/);
  assert.match(p,/you (?:still )?decide every coordinate/i);
  assert.match(p,/Phase 1 \(binding\)/);
}));
test('composePrompt: spec mode offered (1) keeps the make.py normal loop',withJob(async job=>{
  const p=composePrompt(job,{jobId:'J1',specMode:true,v2:V2});
  assert.match(p,/edit your generator \/run\/x\/make\.py/);assert.doesNotMatch(p,/do not write make\.py/i);
}));
