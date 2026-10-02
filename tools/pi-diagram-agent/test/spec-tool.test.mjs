import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {register} from 'node:module';

const here=path.dirname(fileURLToPath(import.meta.url));
const stub=name=>pathToFileURL(path.join(here,'stubs',name)).href;
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,n){
  if(s==='@earendil-works/pi-ai')return {url:${JSON.stringify(stub('pi-ai.mjs'))},shortCircuit:true};
  if(s==='@earendil-works/pi-coding-agent')return {url:${JSON.stringify(stub('pi-coding-agent.mjs'))},shortCircuit:true};
  return n(s,c)}`));
const ext=(await import('../pi-extension.ts')).default;

const SRC='flowchart LR\n  A[Start] --> B[Finish]\n';
const layout={canvas:{w:420,h:200,title:'t'},palette:{p:{fill:'#e8f1fb',stroke:'#2563a8',text:'#12355b',meaning:'Step'}},
  nodes:[{id:'A',shape:'rect',rect:[20,60,120,64],text:'Start',role:'p'},{id:'B',shape:'rect',rect:[260,60,120,64],text:'Finish',role:'p'}],
  edges:[{source:'A',target:'B',points:[[140,92],[260,92]]}]};

function fakePi(){
  const tools=new Map(),commands=new Map(),sent=[],notes=[];
  const pi={registerTool:t=>tools.set(t.name,t),registerCommand:(n,c)=>commands.set(n,c),setModel:async()=>true,setThinkingLevel(){},sendUserMessage:(m)=>sent.push(m)};
  const ctx={cwd:os.tmpdir(),model:undefined,modelRegistry:{getAvailable:()=>[{provider:'openai-codex',id:'x',input:['image']}]},ui:{notify:(m,l)=>notes.push([m,l])}};
  return {pi,tools,commands,sent,notes,ctx};
}
const withEnv=async(env,fn)=>{const old={};for(const k of Object.keys(env)){old[k]=process.env[k];if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k]}
  try{return await fn()}finally{for(const k of Object.keys(old)){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k]}}};

test('diagram_render_spec is registered only in spec mode; diagram_inspect always',async()=>{
  await withEnv({PI_DIAGRAM_SPEC_MODE:undefined,PI_DIAGRAM_SOURCE_FACTS:undefined},()=>{const f=fakePi();ext(f.pi);
    assert.ok(f.tools.has('diagram_inspect'));assert.equal(f.tools.has('diagram_render_spec'),false);assert.ok(f.commands.has('magic'))});
  await withEnv({PI_DIAGRAM_SPEC_MODE:'1'},()=>{const f=fakePi();ext(f.pi);
    const t=f.tools.get('diagram_render_spec');assert.ok(t);assert.deepEqual(Object.keys(t.parameters.properties),['jobId']);
    assert.match(t.description,/layout\.json/);assert.match(t.description,/never moves|does not move/i);assert.ok(f.tools.has('diagram_inspect'))});
});

test('/magic in spec mode sends the schema paragraph; the tool renders layout.json to candidate.svg and returns text findings only',async()=>{
  await withEnv({PI_DIAGRAM_SPEC_MODE:'1',PI_DIAGRAM_SOURCE_FACTS:undefined,PI_DIAGRAM_CODEX_MODEL:undefined},async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-spec-tool-')),input=path.join(root,'s.mmd');fs.writeFileSync(input,SRC);
    const f=fakePi();ext(f.pi);
    await f.commands.get('magic').handler(input,f.ctx);
    const runDir=/private work directory: (\S+)/.exec(f.notes.map(n=>n[0]).join('\n'))[1];
    try{
      assert.equal(f.sent.length,1);
      const jobId=/job ID: ([0-9a-f-]{36})/.exec(f.sent[0])[1];
      assert.match(f.sent[0],/layout\.json/);assert.match(f.sent[0],/diagram_render_spec/);
      assert.ok(f.notes.some(n=>/spec mode/i.test(n[0])));
      const tool=f.tools.get('diagram_render_spec');
      let r=await tool.execute('c1',{jobId});
      assert.equal(r.content.length,1);assert.equal(r.content[0].type,'text');assert.match(r.content[0].text,/layout\.json.*(?:not found|missing)/i);
      fs.writeFileSync(path.join(runDir,'layout.json'),JSON.stringify(layout));
      r=await tool.execute('c2',{jobId});
      assert.equal(r.content.length,1);assert.equal(r.content[0].type,'text');
      assert.match(r.content[0].text,/Rendered candidate\.svg.*2 nodes, 1 edges/);assert.match(r.content[0].text,/0 findings/);
      const svg=fs.readFileSync(path.join(runDir,'candidate.svg'),'utf8');assert.match(svg,/data-source="A" data-target="B"/);
      layout.edges[0].points=[[140,92],[255,100]];
      fs.writeFileSync(path.join(runDir,'layout.json'),JSON.stringify(layout));
      r=await tool.execute('c3',{jobId});assert.match(r.content[0].text,/\[blocking\] orthogonal e1/);
      fs.writeFileSync(path.join(runDir,'layout.json'),'{"canvas":');
      const before=fs.readFileSync(path.join(runDir,'candidate.svg'),'utf8');
      r=await tool.execute('c4',{jobId});assert.match(r.content[0].text,/SCHEMA|invalid JSON/);assert.match(r.content[0].text,/\$:/);
      assert.equal(fs.readFileSync(path.join(runDir,'candidate.svg'),'utf8'),before,'a schema error leaves candidate.svg untouched');
      await assert.rejects(tool.execute('c5',{jobId:'nope'}),/UNKNOWN_DIAGRAM_JOB/);
    }finally{fs.rmSync(runDir,{recursive:true,force:true});fs.rmSync(root,{recursive:true,force:true})}
  });
});
test('/magic without the env flags sends the unchanged prompt',async()=>{
  await withEnv({PI_DIAGRAM_SPEC_MODE:undefined,PI_DIAGRAM_SOURCE_FACTS:undefined,PI_DIAGRAM_CODEX_MODEL:undefined},async()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-spec-tool-')),input=path.join(root,'s.mmd');fs.writeFileSync(input,SRC);
    const f=fakePi();ext(f.pi);await f.commands.get('magic').handler(input,f.ctx);
    const runDir=/private work directory: (\S+)/.exec(f.notes.map(n=>n[0]).join('\n'))[1];
    try{assert.doesNotMatch(f.sent[0],/layout\.json|diagram_render_spec|source-facts/)}finally{fs.rmSync(runDir,{recursive:true,force:true});fs.rmSync(root,{recursive:true,force:true})}
  });
});
