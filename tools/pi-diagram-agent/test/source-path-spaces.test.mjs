import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import extension from '../pi-extension.ts';
const root=fileURLToPath(new URL('..',import.meta.url));

test('RPC source paths with spaces and quoted magic options reach the real command parser intact',async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pi source spaces '));
  try{
    const source=path.join(temp,'input diagram.mmd'),out=path.join(temp,'output files'),capture=path.join(temp,'captured.json');
    fs.writeFileSync(source,'flowchart LR\n A[Start] --> B[Done]\n');
    const fakePi=path.join(temp,'fake-pi.mjs');
    fs.writeFileSync(fakePi,`#!/usr/bin/env node\nimport fs from 'node:fs';let buffer='';process.stdin.on('data',chunk=>{buffer+=chunk;const i=buffer.indexOf('\\n');if(i<0)return;fs.writeFileSync(process.env.PI_PROMPT_CAPTURE,buffer.slice(0,i));console.log(JSON.stringify({type:'agent_settled'}))});\n`);fs.chmodSync(fakePi,0o755);
    const options='--feedback "/tmp/review notes.txt" --reference "/tmp/reference drawing.svg"';
    const result=spawnSync(process.execPath,[path.join(root,'bench/run-bench.mjs'),'--package',root,'--fixtures',source,'--out',out,'--model','synthetic-no-call','--pi-bin',fakePi,'--magic-options',options,'--env','PI_DIAGRAM_V2=0'],{encoding:'utf8',timeout:20000,env:{...process.env,PI_PROMPT_CAPTURE:capture}});
    assert.equal(result.status,0,result.stderr);
    const {message}=JSON.parse(fs.readFileSync(capture,'utf8'));
    assert.equal(message,'/magic '+JSON.stringify(source)+' '+options);
    const commands=new Map(),notes=[];
    extension({registerCommand:(name,command)=>commands.set(name,command),registerTool(){},on(){}});
    const ctx={modelRegistry:{getAvailable:()=>[]},ui:{notify:message=>notes.push(message)}};
    for(const args of [message.slice('/magic '.length),`'${source}' ${options}`]){
      notes.length=0;await commands.get('magic').handler(args,ctx);
      assert.match(notes[0],/native openai-codex vision model is unavailable/);
      assert.doesNotMatch(notes[0],/^Usage:/);
    }
  }finally{fs.rmSync(temp,{recursive:true,force:true})}
});
