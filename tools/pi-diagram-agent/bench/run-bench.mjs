#!/usr/bin/env node
// Benchmark harness for the Pi diagram agent. CALLS THE REAL MODEL (subscription quota). See README.md.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {reduceEvents,summariseAudit,aggregate,renderMarkdown,eventIsRateLimit,createRunTracker} from './bench-lib.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const worktreePkg=path.resolve(here,'..');
const ENV_DEFAULTS={
  PI_DIAGRAM_CODEX_MODEL:'gpt-5.6-sol',
  PI_DIAGRAM_PLAYWRIGHT_MODULE:'/Users/pengxiao/.npm/_npx/9833c18b2d85bc59/node_modules/playwright',
  PI_DIAGRAM_CHROMIUM_EXECUTABLE:'/Users/pengxiao/Library/Caches/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-mac-arm64/chrome-headless-shell',
  PI_DIAGRAM_MERMAID_BUNDLE:'/Users/pengxiao/.codex/worktrees/magic-prepared-diagram/conf-app/node_modules/mermaid/dist/mermaid.min.js'
};

for(const [k,v] of Object.entries(ENV_DEFAULTS))process.env[k]??=v; // the in-process auditor reads these too

function parseArgs(argv){
  const o={env:{},reps:1,concurrency:1,timeoutMin:15,magicOptions:'',piBin:'pi',auditor:path.join(worktreePkg,'src/agent-audit.mjs')};
  for(let i=0;i<argv.length;i++){
    const a=argv[i],next=()=>{if(i+1>=argv.length)throw Error(`missing value for ${a}`);return argv[++i]};
    if(a==='--package')o.package=next();
    else if(a==='--fixtures')o.fixtures=next();
    else if(a==='--reps')o.reps=Number(next());
    else if(a==='--concurrency')o.concurrency=Number(next());
    else if(a==='--out')o.out=next();
    else if(a==='--magic-options')o.magicOptions=next();
    else if(a==='--timeout-min')o.timeoutMin=Number(next());
    else if(a==='--pi-bin')o.piBin=next();
    else if(a==='--auditor')o.auditor=next();
    else if(a==='--env'){const kv=next(),i=kv.indexOf('=');if(i<1)throw Error('--env expects KEY=VALUE');o.env[kv.slice(0,i)]=kv.slice(i+1)}
    else throw Error(`unknown argument ${a}`);
  }
  if(!o.package||!o.out)throw Error('usage: run-bench.mjs --package <pkg root> --fixtures <glob|list> --reps N --concurrency K --out <dir outside repo> [--magic-options "..."] [--pi-bin <path>] [--timeout-min 15] [--env KEY=VALUE]...');
  if(!(o.reps>=1)||!(o.concurrency>=1))throw Error('--reps and --concurrency must be >= 1');
  return o;
}

function resolveFixtures(spec){
  const items=(spec??path.join(here,'fixtures/*.mmd')).split(',').map(s=>s.trim()).filter(Boolean);
  const out=[];
  for(const item of items){
    if(/[*?]/.test(item))out.push(...fs.globSync(item).map(f=>path.resolve(f)));
    else if(fs.existsSync(item))out.push(path.resolve(item));
    else{const f=path.join(here,'fixtures',item.endsWith('.mmd')?item:item+'.mmd');if(!fs.existsSync(f))throw Error(`fixture not found: ${item}`);out.push(f)}
  }
  const uniq=[...new Set(out)].sort();
  if(!uniq.length)throw Error('no fixtures matched');
  return uniq;
}

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Spawn `pi --mode rpc` exactly like driver-control.mjs and log events to eventFile. Resolves with the run's reduced events. */
function runPi({pkg,source,eventFile,magicOptions,timeoutMs,piBin='pi',extraEnv={}}){
  return new Promise(resolve=>{
    const args=['--mode','rpc','--provider','openai-codex','--model','gpt-5.6-sol','--thinking','high','--no-session','--no-skills','--no-context-files','--no-prompt-templates','--no-extensions','--extension',pkg+'/pi-extension.ts'];
    const env={...process.env,...extraEnv};
    const child=spawn(piBin,args,{cwd:pkg,env});
    const events=[];const started=Date.now();const tracker=createRunTracker();let graceTimer=null;let buffer='',n=0,toolCalls=0,inspections=0,finished=false;
    const log=x=>{x.tMs=Date.now()-started;events.push(x);fs.appendFileSync(eventFile,JSON.stringify(x)+'\n')};
    const finish=reason=>{if(finished)return;finished=true;clearTimeout(timer);clearTimeout(graceTimer);log({kind:'done',reason,elapsedMs:Date.now()-started,events:n,toolCalls,inspections});child.kill('SIGTERM');resolve(events)};
    const timer=setTimeout(()=>finish('TIME_LIMIT'),timeoutMs);
    child.stdout.on('data',chunk=>{
      buffer+=chunk.toString('utf8');let i;
      while((i=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;
        let e;try{e=JSON.parse(line)}catch{log({kind:'non-json'});continue}
        n++;
        if(e.type==='response')log({kind:'response',command:e.command,success:e.success,error:e.error});
        if(e.type==='extension_ui_request'&&e.method==='notify')log({kind:'notify',text:e.message});
        if(e.type==='tool_execution_start'){toolCalls++;if(e.toolName==='diagram_inspect')inspections++;log({kind:'tool-start',tool:e.toolName})}
        if(e.type==='thinking_level_changed')log({kind:'thinking-level',level:e.level});
        if(e.type==='tool_execution_end'&&e.toolName==='diagram_inspect'&&!e.isError){const t=e.result?.content?.find(c=>c.type==='text')?.text;try{const th=JSON.parse(t).thinking;if(th)log({kind:'thinking-note',...th})}catch{}}
        if(e.type==='tool_execution_end')log({kind:'tool-end',tool:e.toolName,isError:e.isError,contentTypes:e.result?.content?.map(c=>c.type),error:e.isError?e.result?.content?.filter(c=>c.type==='text').map(c=>c.text).join(' ').slice(0,300):undefined});
        if(e.type==='message_end'&&e.message?.role==='assistant'){
          const contents=e.message.content||[];
          log({kind:'assistant',text:contents.filter(c=>c.type==='text').map(c=>c.text).join(' ').slice(0,600),usage:e.message.usage?{input:e.message.usage.input,output:e.message.usage.output,cacheRead:e.message.usage.cacheRead,cacheWrite:e.message.usage.cacheWrite}:undefined,stopReason:e.message.stopReason,errorMessage:e.message.errorMessage?String(e.message.errorMessage).slice(0,300):undefined});
        }
        if(e.type==='agent_end'||e.type==='agent_settled'){
          log({kind:e.type});
          const act=tracker.onEvent(e.type);
          if(act.finish)finish(act.finish);
          else if(act.armGraceMs)graceTimer=setTimeout(()=>{const reason=tracker.onGraceTimeout();if(reason)finish(reason)},act.armGraceMs);
        }
      }
    });
    child.stderr.on('data',c=>{const s=c.toString('utf8');if(s.trim())log({kind:'stderr',text:s.slice(0,400)})});
    child.on('error',err=>{log({kind:'agent-error',text:String(err.message)});finish('SPAWN_ERROR')});
    child.on('exit',(code,signal)=>finish(`EXIT_${code}_${signal}`));
    child.stdin.write(JSON.stringify({id:'run-1',type:'prompt',message:'/magic '+source+(magicOptions?' '+magicOptions:'')})+'\n');
  });
}

async function postProcess({runDir,source,outBase,auditFn}){
  const res={finalSvgSha256:null,finalSvgInspected:null,audit:null};
  if(!runDir||!fs.existsSync(runDir))return {...res,audit:{status:'NO-AUDIT',fail:[],notCheckable:[],error:'run directory missing'}};
  const cand=path.join(runDir,'candidate.svg');
  if(!fs.existsSync(cand))return {...res,finalSvgInspected:false,audit:{status:'NO-AUDIT',fail:[],notCheckable:[],error:'no candidate.svg'}};
  const bytes=fs.readFileSync(cand);res.finalSvgSha256=sha(bytes);
  fs.copyFileSync(cand,outBase+'.candidate.svg');
  // diagram_inspect writes candidate.<first 12 hex of SVG sha256>.<role>.png: its presence means this exact SVG was rendered for inspection.
  res.finalSvgInspected=fs.readdirSync(runDir).some(f=>f.startsWith(`candidate.${res.finalSvgSha256.slice(0,12)}.`)&&f.endsWith('.png'));
  const orig=fs.readdirSync(runDir).find(f=>f.startsWith('source.original.')&&f.endsWith('.svg'));
  try{
    const audit=await auditFn(fs.readFileSync(source),bytes,{originalSvg:orig?fs.readFileSync(path.join(runDir,orig)):undefined});
    fs.writeFileSync(outBase+'.audit.json',JSON.stringify(audit,null,2));
    res.audit=summariseAudit(audit);res.audit.originalRenderFound=!!orig;
  }catch(error){res.audit={status:'NO-AUDIT',fail:[],notCheckable:[],error:String(error?.message??error)}}
  return res;
}

async function main(){
  const o=parseArgs(process.argv.slice(2));
  const pkg=fs.realpathSync(path.resolve(o.package));
  const out=path.resolve(o.out);
  const repoRoot=fs.realpathSync(path.resolve(worktreePkg,'../..'));
  fs.mkdirSync(out,{recursive:true});
  const realOut=fs.realpathSync(out);
  if(realOut===repoRoot||realOut.startsWith(repoRoot+path.sep))throw Error('--out must be outside the repository: outputs are never committed');
  const fixtures=resolveFixtures(o.fixtures);
  const {auditAgentSvg}=await import(pathToFileURL(path.resolve(o.auditor)).href);
  const auditFn=(s,v,opts)=>auditAgentSvg(s,v,opts);
  const jobs=[];for(const f of fixtures)for(let r=1;r<=o.reps;r++){const name=path.basename(f,'.mmd');jobs.push({fixture:name,source:f,id:`${name}-r${r}`})}
  const runs=[];let rateLimited=false,next=0;
  const meta={package:pkg,auditor:path.resolve(o.auditor),fixtures:fixtures.map(f=>path.basename(f)).join(', '),reps:o.reps,concurrency:o.concurrency,model:'openai-codex gpt-5.6-sol, thinking high',magicOptions:o.magicOptions||'(none)',piBin:o.piBin,env:Object.keys(o.env).length?JSON.stringify(o.env):'(none)',startedAt:new Date().toISOString()};
  const writeSummary=()=>{
    const ordered=jobs.map(j=>runs.find(r=>r.id===j.id)).filter(Boolean);
    const summary={meta,...aggregate(ordered),runs:ordered};
    fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2));
    fs.writeFileSync(path.join(out,'summary.md'),renderMarkdown(summary,{meta}));
  };
  async function worker(){
    while(true){
      const job=jobs[next++];if(!job)return;
      if(rateLimited){runs.push({id:job.id,fixture:job.fixture,doneReason:'SKIPPED_RATE_LIMIT',rateLimited:false,toolCalls:0,inspections:0,inputTokens:0,outputTokens:0});writeSummary();continue}
      const base=path.join(out,job.id),eventFile=base+'.jsonl';fs.rmSync(eventFile,{force:true});
      console.error(`[bench] start ${job.id}`);
      const events=await runPi({pkg,source:job.source,eventFile,magicOptions:o.magicOptions,piBin:o.piBin,extraEnv:o.env,timeoutMs:o.timeoutMin*60_000});
      const r=reduceEvents(events);
      if(events.some(eventIsRateLimit)){rateLimited=true;console.error(`[bench] rate-limit text seen in ${job.id}: no further runs will start`)}
      const post=await postProcess({runDir:r.runDir,source:job.source,outBase:base,auditFn});
      runs.push({id:job.id,fixture:job.fixture,...r,...post});
      console.error(`[bench] done ${job.id} ${r.doneReason} ${(r.elapsedMs/1000).toFixed(0)}s out=${r.outputTokens} audit=${post.audit?.status}`);
      writeSummary();
    }
  }
  await Promise.all(Array.from({length:Math.min(o.concurrency,jobs.length)},worker));
  meta.finishedAt=new Date().toISOString();writeSummary();
  console.log(path.join(out,'summary.md'));
}
main().catch(e=>{console.error(e.message);process.exit(1)});
