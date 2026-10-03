import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {prepareAgentTask} from '../src/agent-led.mjs';
import {createBuildStep,GENERATOR_TIMEOUT_S,tailOutput} from '../src/build-step.mjs';

const SOURCE='flowchart LR\n  A[Start] --> B[Finish]\n';
function setup(opts={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pi-build-test-')),input=path.join(root,'s.mmd');fs.writeFileSync(input,SOURCE);
  const job=prepareAgentTask(input);
  const calls=[];
  // Stand-in for Pi's ctx.executeTool('bash', ...): really runs the command, like the bash tool (non-zero exit = isError).
  const ctx={executeTool:async(name,args)=>{
    calls.push({name,args});
    if(opts.timeout)return {isError:true,result:{content:[{type:'text',text:'Command timed out after 60 seconds\ntimeout:60'}]}};
    const r=spawnSync('bash',['-c',args.command],{encoding:'utf8',timeout:20000});
    return {isError:r.status!==0,result:{content:[{type:'text',text:`${r.stdout}${r.stderr}`}]}};
  }};
  const build=createBuildStep(job,opts);
  return {job,ctx,calls,build,write:(name,text)=>fs.writeFileSync(path.join(job.runDir,name),text),cleanup:()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(job.runDir,{recursive:true,force:true})}};
}

test('make.py present: run through ctx.executeTool(bash) in the run directory with a 60 s timeout, then candidate.svg is the output',async()=>{
  const t=setup();try{
    t.write('make.py','open("candidate.svg","w").write("<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 1 1\\"/>")\n');
    const r=await t.build(t.ctx);
    assert.equal(r.ok,true);assert.equal(r.source,'make.py');
    assert.equal(t.calls.length,1);assert.equal(t.calls[0].name,'bash');assert.equal(t.calls[0].args.timeout,GENERATOR_TIMEOUT_S);assert.equal(GENERATOR_TIMEOUT_S,60);
    assert.match(t.calls[0].args.command,/python3 make\.py/);assert.ok(t.calls[0].args.command.includes(t.job.runDir));
    assert.match(fs.readFileSync(t.job.outputPath,'utf8'),/<svg/);
  }finally{t.cleanup()}
});

test('generator traceback is returned as a short actionable message, not thrown',async()=>{
  const t=setup();try{
    t.write('make.py','x = 1\nraise ValueError("edge A->B has no points")\n');
    const r=await t.build(t.ctx);
    assert.equal(r.ok,false);assert.equal(r.source,'make.py');
    assert.match(r.message,/make\.py failed/);assert.match(r.message,/ValueError: edge A->B has no points/);assert.ok(r.message.length<2000);
  }finally{t.cleanup()}
});

test('generator timeout becomes an actionable message',async()=>{
  const t=setup({timeout:true});try{
    t.write('make.py','while True: pass\n');
    const r=await t.build(t.ctx);
    assert.equal(r.ok,false);assert.match(r.message,/timed out after 60 s/);
  }finally{t.cleanup()}
});

test('generator output is bounded to its tail (a traceback ends with the useful line)',()=>{
  const long='noise\n'.repeat(5000)+'ValueError: the real problem';
  const t=tailOutput(long);
  assert.ok(t.length<=1500);assert.match(t,/the real problem$/);
});

test('the generator may write only candidate.svg: any other new or changed file in the run directory is an error',async()=>{
  const t=setup();try{
    t.write('make.py','open("candidate.svg","w").write("<svg xmlns=\\"http://www.w3.org/2000/svg\\"/>")\nopen("scratch.json","w").write("{}")\n');
    const r=await t.build(t.ctx);
    assert.equal(r.ok,false);assert.match(r.message,/GENERATOR_WROTE_OTHER_FILES/);assert.match(r.message,/scratch\.json/);
    // A file that already existed and was not touched is fine.
    const u=setup();try{
      u.write('notes.txt','keep');u.write('make.py','open("candidate.svg","w").write("<svg xmlns=\\"http://www.w3.org/2000/svg\\"/>")\n');
      assert.equal((await u.build(u.ctx)).ok,true);
    }finally{u.cleanup()}
  }finally{t.cleanup()}
});

test('no make.py: candidate.svg as written is used and no tool is run; layout.json is rendered only in spec mode',async()=>{
  const t=setup();try{
    t.write('layout.json','{}');
    assert.deepEqual({...(await t.build(t.ctx)),ms:0},{ok:true,source:'candidate.svg',ms:0});assert.equal(t.calls.length,0);
  }finally{t.cleanup()}
  const rendered=[];
  const s=setup({specMode:true,renderSpec:async()=>{rendered.push(1);return {content:[{type:'text',text:'RENDERED'}],details:{status:'RENDERED'}}}});try{
    s.write('layout.json','{}');
    const r=await s.build(s.ctx);
    assert.equal(r.ok,true);assert.equal(r.source,'layout.json');assert.equal(rendered.length,1);assert.equal(s.calls.length,0);
  }finally{s.cleanup()}
  const e=setup({specMode:true,renderSpec:async()=>({content:[{type:'text',text:'SCHEMA_ERROR: layout.json was not rendered\n- nodes[0].rect: missing'}],details:{status:'SCHEMA_ERROR'}})});try{
    e.write('layout.json','{}');
    const r=await e.build(e.ctx);
    assert.equal(r.ok,false);assert.match(r.message,/nodes\[0\]\.rect/);
  }finally{e.cleanup()}
});

test('a symlinked make.py is not run; a missing ctx.executeTool with a generator present is a genuine failure (throws)',async()=>{
  const t=setup();try{
    fs.symlinkSync('/etc/hosts',path.join(t.job.runDir,'make.py'));
    assert.equal((await t.build(t.ctx)).source,'candidate.svg');
    fs.rmSync(path.join(t.job.runDir,'make.py'));t.write('make.py','pass\n');
    await assert.rejects(()=>t.build({}),/GENERATOR_EXECUTION_UNAVAILABLE/);
  }finally{t.cleanup()}
});
